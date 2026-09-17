import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emitLive } from "@/lib/live-emit";

export const dynamic = "force-dynamic";

/**
 * POST /api/inventory/adjust — stock adjustment (recount / damages / receipts / loss).
 * body: { productId, storeId, delta (±), reason }
 * Updates the stock level and notifies #stock-alerts in Raven chat.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { productId, storeId } = body;
  const delta = Number(body.delta);
  const reason = String(body.reason ?? "Recount");

  if (!productId || !storeId || !Number.isFinite(delta) || delta === 0) {
    return NextResponse.json({ ok: false, error: "productId, storeId and a non-zero delta are required" }, { status: 400 });
  }

  const level = await db.stockLevel.findUnique({
    where: { productId_storeId: { productId: Number(productId), storeId: Number(storeId) } },
  });
  if (!level) return NextResponse.json({ ok: false, error: "Stock record not found" }, { status: 404 });

  const newQty = level.qty + delta;
  if (newQty < 0) {
    return NextResponse.json({ ok: false, error: `Adjustment would take stock negative (have ${level.qty})` }, { status: 400 });
  }

  const updated = await db.stockLevel.update({
    where: { productId_storeId: { productId: Number(productId), storeId: Number(storeId) } },
    data: {
      qty: newQty,
      // Inbound stock resets the batch age — the Stock Aging report values the
      // current batch from receivedAt, so fresh goods must land as fresh.
      ...(delta > 0 ? { receivedAt: new Date() } : {}),
    },
  });

  const [product, store] = await Promise.all([
    db.product.findUnique({ where: { id: Number(productId) } }),
    db.store.findUnique({ where: { id: Number(storeId) } }),
  ]);

  // audit + chat notification
  const channel = await db.chatChannel.findFirst({ where: { name: "stock-alerts" } });
  if (channel) {
    const note = `📝 Stock adjustment: ${delta > 0 ? "+" : ""}${delta} × ${product?.name} at ${store?.name} (${reason}). New qty: ${newQty}.`;
    await db.chatMessage.create({
      data: {
        channelId: channel.id,
        author: "System Bot",
        initials: "SB",
        content: note,
      },
    });
    await db.chatChannel.update({ where: { id: channel.id }, data: { unread: { increment: 1 } } });
    emitLive("chat:new", {
      channelId: channel.id, channelName: channel.name, id: 0,
      author: "System Bot", initials: "SB", content: note,
      createdAt: new Date().toISOString(),
    });
  }

  // Live low-stock alert when an adjustment leaves the item at/below reorder.
  if (product && store && newQty <= level.reorderPoint) {
    emitLive("stock:low", {
      productName: product.name, emoji: product.emoji,
      storeName: store.name, qty: newQty, reorderPoint: level.reorderPoint,
    });
  }

  return NextResponse.json({ ok: true, level: updated, product: product?.name, store: store?.name });
}
