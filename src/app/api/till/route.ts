import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET  /api/till?storeId=N — current open till session + live totals (X-report data)
 *                          + the last 5 closed shifts for the Z-report history list.
 * POST /api/till — { action, storeId, ... }
 *   action: "open"      { openingFloat }            → opens a shift for the store
 *   action: "x-report"  {}                          → live totals snapshot (drawer stays open)
 *   action: "close"     { countedCash, note? }      → Z-report: closes shift, computes variance
 *
 * X-Report = mid-shift reading (drawer stays in). Z-Report = end-of-shift close that
 * reconciles counted cash vs expected (opening float + cash sales) and locks the shift.
 */

/** Aggregates completed sales for a store between two timestamps into report totals. */
async function buildReport(storeId: number, from: Date, to: Date, openingFloat: number) {
  const sales = await db.sale.findMany({
    where: { storeId, createdAt: { gte: from, lte: to }, status: "Completed" },
    include: { items: true, customer: true },
    orderBy: { createdAt: "asc" },
  });

  const byMethod: Record<string, { total: number; count: number }> = {};
  for (const s of sales) {
    byMethod[s.paymentMethod] = byMethod[s.paymentMethod] ?? { total: 0, count: 0 };
    byMethod[s.paymentMethod].total += s.total;
    byMethod[s.paymentMethod].count += 1;
  }

  const cash = byMethod["Cash"]?.total ?? 0;
  const gross = sales.reduce((a, s) => a + s.subtotal, 0);
  const discounts = sales.reduce((a, s) => a + s.discount, 0);
  const vat = sales.reduce((a, s) => a + s.vat, 0);
  const total = sales.reduce((a, s) => a + s.total, 0);
  const units = sales.reduce((a, s) => a + s.items.reduce((x, i) => x + i.qty, 0), 0);
  const pointsRedeemed = sales.reduce((a, s) => a + s.pointsRedeemed, 0);
  const pointsEarned = sales.reduce((a, s) => a + s.pointsEarned, 0);
  const creditSales = sales.filter((s) => s.paymentMethod === "Credit Sale");

  return {
    from,
    to,
    receipts: sales.length,
    units,
    gross,
    discounts,
    vat,
    total,
    avgBasket: sales.length ? total / sales.length : 0,
    byMethod,
    cash,
    expectedCash: openingFloat + cash,
    openingFloat,
    pointsRedeemed,
    pointsEarned,
    creditCount: creditSales.length,
    creditTotal: creditSales.reduce((a, s) => a + s.total, 0),
    recentSales: sales.slice(-8).reverse().map((s) => ({
      id: s.id,
      receiptNo: s.receiptNo,
      total: s.total,
      paymentMethod: s.paymentMethod,
      staffName: s.staffName,
      customer: s.customer?.name ?? "Walk-in",
      createdAt: s.createdAt,
    })),
  };
}

export async function GET(req: NextRequest) {
  const storeId = Number(req.nextUrl.searchParams.get("storeId") ?? 1);
  if (!storeId) return NextResponse.json({ error: "storeId required" }, { status: 400 });

  const session = await db.tillSession.findFirst({
    where: { storeId, status: "Open" },
    orderBy: { openedAt: "desc" },
  });

  const report = session
    ? await buildReport(storeId, session.openedAt, new Date(), session.openingFloat)
    : null;

  const history = await db.tillSession.findMany({
    where: { storeId, status: "Closed" },
    orderBy: { closedAt: "desc" },
    take: 5,
  });

  return NextResponse.json({ session, report, history });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    action: "open" | "x-report" | "close";
    storeId: number;
    openedBy?: string;
    openingFloat?: number;
    countedCash?: number;
    note?: string;
  };

  const { action, storeId } = body;
  if (!storeId) return NextResponse.json({ error: "storeId required" }, { status: 400 });

  if (action === "open") {
    // One open shift per store — refuse a second one.
    const existing = await db.tillSession.findFirst({ where: { storeId, status: "Open" } });
    if (existing) return NextResponse.json({ error: "Till is already open for this store." }, { status: 409 });

    const session = await db.tillSession.create({
      data: {
        storeId,
        openedBy: body.openedBy ?? "Counter 1",
        openingFloat: Math.max(0, Number(body.openingFloat) || 0),
        status: "Open",
      },
    });
    return NextResponse.json({ ok: true, session });
  }

  const session = await db.tillSession.findFirst({
    where: { storeId, status: "Open" },
    orderBy: { openedAt: "desc" },
  });
  if (!session) return NextResponse.json({ error: "No open till session for this store." }, { status: 404 });

  if (action === "x-report") {
    const report = await buildReport(storeId, session.openedAt, new Date(), session.openingFloat);
    return NextResponse.json({ ok: true, type: "X", session, report });
  }

  if (action === "close") {
    const countedCash = Number(body.countedCash);
    if (!Number.isFinite(countedCash) || countedCash < 0)
      return NextResponse.json({ error: "Counted cash must be a positive number." }, { status: 400 });

    const now = new Date();
    const report = await buildReport(storeId, session.openedAt, now, session.openingFloat);

    const closed = await db.tillSession.update({
      where: { id: session.id },
      data: {
        status: "Closed",
        closedAt: now,
        expectedCash: report.expectedCash,
        countedCash,
        variance: countedCash - report.expectedCash,
        note: body.note?.slice(0, 300) ?? null,
      },
    });

    return NextResponse.json({ ok: true, type: "Z", session: closed, report: { ...report, to: now } });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
