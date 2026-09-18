import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emitLive } from "@/lib/live-emit";

export const dynamic = "force-dynamic";

/**
 * DukaFlow - Stock take / cycle count sessions.
 *
 * GET  /api/stock-take            → list sessions (with store + item progress)
 * POST /api/stock-take            → open a new session
 *      body: { storeId, category?: "All" | <category>, startedBy?, note? }
 *      Snapshots every stock line in scope (systemQty + unitCost) so later
 *      sales during the count don't skew the variance math.
 */
export async function GET() {
  const sessions = await db.stockTake.findMany({
    orderBy: { startedAt: "desc" },
    take: 30,
    include: {
      store: { select: { id: true, name: true } },
      items: { select: { counted: true, countedQty: true, systemQty: true, unitCost: true } },
    },
  });

  // roll-up per session: progress + net value variance (only counted lines)
  const withStats = sessions.map((s) => {
    const counted = s.items.filter((i) => i.counted);
    const varianceValue = counted.reduce(
      (sum, i) => sum + ((i.countedQty ?? i.systemQty) - i.systemQty) * i.unitCost,
      0
    );
    const shortage = counted.filter((i) => (i.countedQty ?? 0) < i.systemQty).length;
    const surplus = counted.filter((i) => (i.countedQty ?? 0) > i.systemQty).length;
    return {
      id: s.id,
      stNo: s.stNo,
      status: s.status,
      category: s.category,
      startedBy: s.startedBy,
      note: s.note,
      startedAt: s.startedAt,
      approvedAt: s.approvedAt,
      store: s.store,
      totalItems: s.items.length,
      countedItems: counted.length,
      varianceValue,
      shortage,
      surplus,
    };
  });

  return NextResponse.json(withStats);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const storeId = Number(body.storeId);
  const category = String(body.category ?? "All");
  const startedBy = String(body.startedBy ?? "Owner");
  const note = String(body.note ?? "");

  if (!storeId) {
    return NextResponse.json({ ok: false, error: "storeId is required" }, { status: 400 });
  }

  // Refuse to open a second live session for the same store (ERP hygiene).
  const open = await db.stockTake.findFirst({
    where: { storeId, status: { in: ["Counting", "Review"] } },
  });
  if (open) {
    return NextResponse.json(
      { ok: false, error: `${open.stNo} is still open for this store - approve or cancel it first.` },
      { status: 409 }
    );
  }

  const store = await db.store.findUnique({ where: { id: storeId } });
  if (!store) return NextResponse.json({ ok: false, error: "Store not found" }, { status: 404 });

  const levels = await db.stockLevel.findMany({
    where: { storeId, ...(category !== "All" ? { product: { category, active: true } } : { product: { active: true } }) },
    include: { product: true },
    orderBy: { productId: "asc" },
  });

  if (levels.length === 0) {
    return NextResponse.json({ ok: false, error: "No stock lines in scope for this store/category" }, { status: 400 });
  }

  const seq = (await db.stockTake.count()) + 1;
  const stNo = `ST-${String(seq).padStart(4, "0")}`;

  const session = await db.stockTake.create({
    data: {
      stNo,
      storeId,
      category,
      startedBy,
      note,
      items: {
        create: levels.map((l) => ({
          productId: l.productId,
          systemQty: l.qty,
          unitCost: l.product.cost,
        })),
      },
    },
  });

  // Audit line in Raven so the whole team knows a count is running.
  const channel = await db.chatChannel.findFirst({ where: { name: "stock-alerts" } });
  if (channel) {
    const msg = `📋 ${stNo} opened: cycle count of ${levels.length} products at ${store.name}${category !== "All" ? ` (${category})` : ""} by ${startedBy}. POS sales stay live - variances are computed from the snapshot.`;
    await db.chatMessage.create({ data: { channelId: channel.id, author: "Stock Bot", initials: "SB", content: msg } });
    await db.chatChannel.update({ where: { id: channel.id }, data: { unread: { increment: 1 } } });
    emitLive("chat:new", { channelId: channel.id, channelName: channel.name, id: 0, author: "Stock Bot", initials: "SB", content: msg, createdAt: new Date().toISOString() });
  }

  emitLive("stocktake:new", { stNo, store: store.name, items: levels.length });

  return NextResponse.json({ ok: true, id: session.id, stNo, items: levels.length });
}
