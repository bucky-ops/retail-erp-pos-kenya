import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/dashboard?storeId= - owner KPIs, live feed, staff, trend. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("storeId");
  const scope = storeId ? { storeId: Number(storeId) } : {};

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 864e5);

  const [todaySales, weekSales, staff, lowStock, feedRaw, totalCustomers, debtorsRaw, paySplitRaw] =
    await Promise.all([
      db.sale.aggregate({ where: { ...scope, createdAt: { gte: startOfDay } }, _sum: { total: true }, _count: true }),
      db.sale.findMany({ where: { ...scope, createdAt: { gte: weekAgo } }, select: { total: true, createdAt: true } }),
      db.staff.findMany({ where: { onShift: true, ...(storeId ? { storeId: Number(storeId) } : {}) } }),
      db.stockLevel.findMany({
        where: { ...(storeId ? { storeId: Number(storeId) } : {}), qty: { lte: 10 } },
        include: { product: true, store: true },
        orderBy: { qty: "asc" },
        take: 8,
      }),
      db.sale.findMany({ where: scope, include: { customer: true, store: true }, orderBy: { createdAt: "desc" }, take: 6 }),
      db.customer.count(),
      db.customer.findMany({ where: { debtBalance: { gt: 0 } }, select: { debtBalance: true, name: true, phone: true, tier: true } }),
      db.sale.groupBy({ by: ["paymentMethod"], where: { ...scope, createdAt: { gte: weekAgo } }, _sum: { total: true } }),
    ]);

  // 7-day trend
  const trend: { day: string; sales: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.now() - i * 864e5);
    const dayStart = new Date(day).setHours(0, 0, 0, 0);
    const dayEnd = dayStart + 864e5;
    const total = weekSales
      .filter((s) => new Date(s.createdAt).getTime() >= dayStart && new Date(s.createdAt).getTime() < dayEnd)
      .reduce((a, s) => a + s.total, 0);
    trend.push({ day: day.toLocaleString("en", { weekday: "short" }), sales: Math.round(total) });
  }

  // payment split
  const payTotal = paySplitRaw.reduce((a, p) => a + (p._sum.total ?? 0), 0) || 1;
  const paySplit = paySplitRaw.map((p) => ({
    method: p.paymentMethod,
    total: p._sum.total ?? 0,
    pct: Math.round(((p._sum.total ?? 0) / payTotal) * 100),
  }));

  // store comparison (this week)
  const stores = await db.store.findMany();
  const salesByStore = await Promise.all(
    stores.map(async (st) => {
      const agg = await db.sale.aggregate({
        where: { storeId: st.id, createdAt: { gte: weekAgo } },
        _sum: { total: true },
      });
      return { store: st.name, storeId: st.id, total: agg._sum.total ?? 0 };
    })
  );
  const storeTotal = salesByStore.reduce((a, s) => a + s.total, 0) || 1;
  const storeRows = salesByStore.map((s) => ({
    ...s,
    pct: Math.round((s.total / storeTotal) * 100),
  }));

  return NextResponse.json({
    kpis: {
      todaySales: todaySales._sum.total ?? 0,
      todayCount: todaySales._count,
      weekSales: Math.round(weekSales.reduce((a, s) => a + s.total, 0)),
      debtorsTotal: Math.round(debtorsRaw.reduce((a, d) => a + d.debtBalance, 0)),
      debtorsCount: debtorsRaw.length,
      customers: totalCustomers,
      lowStockCount: await db.stockLevel.count({
        where: { ...(storeId ? { storeId: Number(storeId) } : {}), qty: { lte: 10 } },
      }),
    },
    feed: feedRaw.map((s) => ({
      receipt: s.receiptNo,
      customer: s.customer?.name ?? "Walk-in",
      tier: s.customer?.tier ?? null,
      store: s.store.name,
      amount: s.total,
      pay: s.paymentMethod,
      kra: s.kraStatus,
      time: new Date(s.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    })),
    staff: staff.map((s) => ({ name: s.name, role: s.role, color: s.color })),
    lowStock: lowStock.map((s) => ({
      name: s.product.name, emoji: s.product.emoji, sku: s.product.sku,
      qty: s.qty, store: s.store.name, reorderPoint: s.reorderPoint,
    })),
    trend,
    paySplit,
    salesByStore: storeRows,
    debtors: debtorsRaw.slice(0, 5),
  });
}
