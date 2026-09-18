import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emitLive } from "@/lib/live-emit";

export const dynamic = "force-dynamic";

/**
 * DukaFlow - single stock-take session lifecycle.
 *
 * GET /api/stock-take/[id]
 *   → full session with product-labelled items for the counting UI.
 *
 * PATCH /api/stock-take/[id]
 *   { action: "count",  itemId, countedQty, countedBy? }  → record a shelf count
 *   { action: "cancel" }                                   → abort the session
 *   { action: "approve" }                                  → apply variances
 *
 * Approve applies every counted variance as a REAL stock adjustment in one
 * transaction: increments/decrements StockLevel, stamps fresh receivedAt on
 * inbound lines (stock aging), posts a value-variance digest to #stock-alerts
 * and emits `stocktake:approved` on the live bus.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await db.stockTake.findUnique({
    where: { id: Number(id) },
    include: {
      store: { select: { id: true, name: true, location: true } },
      items: {
        orderBy: { id: "asc" },
        include: { product: { select: { id: true, name: true, sku: true, emoji: true, unit: true, category: true, price: true, barcode: true } } },
      },
    },
  });
  if (!session) return NextResponse.json({ ok: false, error: "Session not found" }, { status: 404 });
  return NextResponse.json(session);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionId = Number(id);
    const body = (await req.json()) as {
      action: "count" | "cancel" | "approve";
      itemId?: number;
      countedQty?: number;
      countedBy?: string;
    };

    const session = await db.stockTake.findUnique({ where: { id: sessionId }, include: { store: true } });
    if (!session) return NextResponse.json({ ok: false, error: "Session not found" }, { status: 404 });

    // -- Count a single line --------------------------------------
    if (body.action === "count") {
      if (session.status !== "Counting" && session.status !== "Review") {
        return NextResponse.json({ ok: false, error: "Session is closed" }, { status: 409 });
      }
      const itemId = Number(body.itemId);
      const countedQty = Number(body.countedQty);
      if (!itemId || !Number.isFinite(countedQty) || countedQty < 0) {
        return NextResponse.json({ ok: false, error: "itemId and a non-negative countedQty are required" }, { status: 400 });
      }
      const item = await db.stockTakeItem.findUnique({ where: { id: itemId }, include: { product: true } });
      if (!item || item.stockTakeId !== sessionId) {
        return NextResponse.json({ ok: false, error: "Count line not found in this session" }, { status: 404 });
      }
      const updated = await db.stockTakeItem.update({
        where: { id: itemId },
        data: {
          countedQty,
          counted: true,
          countedAt: new Date(),
          countedBy: String(body.countedBy ?? session.startedBy),
        },
      });
      const countedSoFar = await db.stockTakeItem.count({ where: { stockTakeId: sessionId, counted: true } });
      return NextResponse.json({
        ok: true,
        item: updated,
        countedItems: countedSoFar,
        variance: countedQty - item.systemQty,
        varianceValue: (countedQty - item.systemQty) * item.unitCost,
      });
    }

    // -- Cancel (no stock touched) --------------------------------
    if (body.action === "cancel") {
      if (session.status === "Approved") {
        return NextResponse.json({ ok: false, error: "Approved sessions cannot be cancelled" }, { status: 409 });
      }
      await db.stockTake.update({ where: { id: sessionId }, data: { status: "Cancelled" } });
      return NextResponse.json({ ok: true, status: "Cancelled" });
    }

    // -- Approve: apply variances to live stock -------------------
    if (body.action === "approve") {
      if (session.status === "Approved") {
        return NextResponse.json({ ok: false, error: "Session already approved" }, { status: 409 });
      }
      const counted = await db.stockTakeItem.findMany({
        where: { stockTakeId: sessionId, counted: true },
        include: { product: true },
      });
      if (counted.length === 0) {
        return NextResponse.json({ ok: false, error: "Nothing has been counted yet" }, { status: 400 });
      }

      const applied: { productId: number; name: string; delta: number; value: number }[] = [];

      await db.$transaction(async (tx) => {
        for (const item of counted) {
          const delta = (item.countedQty ?? item.systemQty) - item.systemQty;
          if (delta === 0) continue;
          const level = await tx.stockLevel.findUnique({
            where: { productId_storeId: { productId: item.productId, storeId: session.storeId } },
          });
          if (!level) continue;
          const newQty = level.qty + delta;
          if (newQty < 0) continue; // defensive - snapshot should prevent this
          await tx.stockLevel.update({
            where: { id: level.id },
            data: {
              qty: newQty,
              // Surplus goods are "new" stock for aging purposes.
              ...(delta > 0 ? { receivedAt: new Date() } : {}),
            },
          });
          applied.push({ productId: item.productId, name: item.product.name, delta, value: delta * item.unitCost });
        }
        await tx.stockTake.update({
          where: { id: sessionId },
          data: { status: "Approved", approvedAt: new Date() },
        });
      });

      const shortageValue = applied.filter((a) => a.delta < 0).reduce((s, a) => s + a.value, 0);
      const surplusValue = applied.filter((a) => a.delta > 0).reduce((s, a) => s + a.value, 0);
      const netValue = shortageValue + surplusValue; // surplus is +, shortage is −

      // Digest to #stock-alerts
      const channel = await db.chatChannel.findFirst({ where: { name: "stock-alerts" } });
      if (channel) {
        const lines = applied.slice(0, 6).map((a) => `  • ${a.delta > 0 ? "+" : ""}${Math.round(a.delta)} × ${a.name} (KES ${Math.round(a.value).toLocaleString()})`);
        const extra = applied.length > 6 ? `\n  • …and ${applied.length - 6} more lines` : "";
        const msg = `✅ ${session.stNo} approved - ${applied.length} variance lines applied at ${session.store.name}.\n${lines.join("\n")}${extra}\nNet variance: KES ${Math.round(netValue).toLocaleString()} (shortage KES ${Math.round(shortageValue).toLocaleString()} / surplus KES ${Math.round(surplusValue).toLocaleString()}).`;
        await db.chatMessage.create({ data: { channelId: channel.id, author: "Stock Bot", initials: "SB", content: msg } });
        await db.chatChannel.update({ where: { id: channel.id }, data: { unread: { increment: 1 } } });
        emitLive("chat:new", { channelId: channel.id, channelName: channel.name, id: 0, author: "Stock Bot", initials: "SB", content: msg, createdAt: new Date().toISOString() });
      }

      emitLive("stocktake:approved", { stNo: session.stNo, store: session.store.name, lines: applied.length, netValue });

      return NextResponse.json({ ok: true, status: "Approved", applied, shortageValue, surplusValue, netValue });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("stock-take PATCH failed", err);
    return NextResponse.json({ ok: false, error: "Stock-take action failed" }, { status: 500 });
  }
}
