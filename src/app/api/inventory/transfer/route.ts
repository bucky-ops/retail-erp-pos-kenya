import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** POST /api/inventory/transfer - move stock between stores. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { productId, fromStoreId, toStoreId, qty } = body;

  if (!productId || !fromStoreId || !toStoreId || !qty || qty <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid transfer payload" }, { status: 400 });
  }
  if (fromStoreId === toStoreId) {
    return NextResponse.json({ ok: false, error: "Source and destination are the same" }, { status: 400 });
  }

  const source = await db.stockLevel.findUnique({
    where: { productId_storeId: { productId, storeId: fromStoreId } },
  });
  if (!source || source.qty < qty) {
    return NextResponse.json({ ok: false, error: `Insufficient stock at source (have ${source?.qty ?? 0})` }, { status: 400 });
  }

  await db.stockLevel.update({
    where: { productId_storeId: { productId, storeId: fromStoreId } },
    data: { qty: { decrement: qty } },
  });
  await db.stockLevel.upsert({
    where: { productId_storeId: { productId, storeId: toStoreId } },
    update: { qty: { increment: qty }, receivedAt: new Date() }, // arriving goods are a fresh batch at the destination
    create: { productId, storeId: toStoreId, qty },
  });

  const transfer = await db.stockTransfer.create({
    data: { productId, fromStoreId, toStoreId, qty },
  });

  const product = await db.product.findUnique({ where: { id: productId } });
  const fromStore = await db.store.findUnique({ where: { id: fromStoreId } });
  const toStore = await db.store.findUnique({ where: { id: toStoreId } });

  // Notify in chat
  const channel = await db.chatChannel.findFirst({ where: { name: "stock-alerts" } });
  if (channel) {
    await db.chatMessage.create({
      data: {
        channelId: channel.id, author: "System Bot", initials: "SB",
        content: `📦 Transfer completed: ${qty} × ${product?.name} from ${fromStore?.name} → ${toStore?.name}.`,
        docLink: JSON.stringify({
          title: `Stock Transfer STK-${String(transfer.id).padStart(4, "0")}`,
          sub: `${product?.name} ×${qty} • ${fromStore?.name} → ${toStore?.name} • View`,
          kind: "stock",
        }),
      },
    });
    await db.chatChannel.update({ where: { id: channel.id }, data: { unread: { increment: 1 } } });
  }

  return NextResponse.json({ ok: true, transfer });
}
