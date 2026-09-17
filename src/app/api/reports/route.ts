import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/reports — datasets for the 8 report cards. */
export async function GET() {
  const weekAgo = new Date(Date.now() - 7 * 864e5);

  const [salesByStore, salesByStaff, paySplit, kraByStatus, topProducts, debtorAging, loyalty] =
    await Promise.all([
      db.sale.groupBy({ by: ["storeId"], where: { createdAt: { gte: weekAgo } }, _sum: { total: true }, _count: true }),
      db.sale.groupBy({ by: ["staffName"], where: { createdAt: { gte: weekAgo } }, _sum: { total: true }, _count: true }),
      db.sale.groupBy({ by: ["paymentMethod"], where: { createdAt: { gte: weekAgo } }, _sum: { total: true } }),
      db.sale.groupBy({ by: ["kraStatus"], _count: true }),
      db.saleItem.groupBy({ by: ["productId"], _sum: { qty: true, total: true }, orderBy: { _sum: { total: "desc" } }, take: 5 }),
      db.debtPlan.findMany({ select: { totalDebt: true, overdueDays: true, status: true } }),
      db.sale.aggregate({ _sum: { pointsEarned: true, pointsRedeemed: true } }),
    ]);

  const stores = await db.store.findMany();
  const products = topProducts.length
    ? await db.product.findMany({ where: { id: { in: topProducts.map((t) => t.productId ?? 0) } } })
    : [];

  // Daily sales for P&L-ish trend (last 7 days)
  const sales7 = await db.sale.findMany({
    where: { createdAt: { gte: weekAgo } },
    select: { total: true, subtotal: true, createdAt: true },
  });
  const daily: { day: string; revenue: number; profit: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.now() - i * 864e5);
    const s = new Date(day).setHours(0, 0, 0, 0);
    const rows = sales7.filter((r) => {
      const t = new Date(r.createdAt).getTime();
      return t >= s && t < s + 864e5;
    });
    daily.push({
      day: day.toLocaleString("en", { weekday: "short" }),
      revenue: Math.round(rows.reduce((a, r) => a + r.total, 0)),
      profit: Math.round(rows.reduce((a, r) => a + r.total * 0.18, 0)), // est. 18% margin
    });
  }

  const aging = {
    current: debtorAging.filter((d) => d.overdueDays <= 0).reduce((a, d) => a + d.totalDebt, 0),
    d0_30: debtorAging.filter((d) => d.overdueDays > 0 && d.overdueDays <= 30).reduce((a, d) => a + d.totalDebt, 0),
    d31_60: debtorAging.filter((d) => d.overdueDays > 30 && d.overdueDays <= 60).reduce((a, d) => a + d.totalDebt, 0),
    d60plus: debtorAging.filter((d) => d.overdueDays > 60).reduce((a, d) => a + d.totalDebt, 0),
  };

  return NextResponse.json({
    salesByStore: salesByStore.map((s) => ({
      store: stores.find((st) => st.id === s.storeId)?.name ?? `Store ${s.storeId}`,
      total: s._sum.total ?? 0, count: s._count,
    })),
    salesByStaff: salesByStaff.map((s) => ({ staff: s.staffName, total: s._sum.total ?? 0, count: s._count })),
    paySplit: paySplit.map((p) => ({ method: p.paymentMethod, total: p._sum.total ?? 0 })),
    kra: kraByStatus.map((k) => ({ status: k.kraStatus, count: k._count })),
    topProducts: topProducts.map((t) => ({
      name: products.find((p) => p.id === t.productId)?.name ?? `Product ${t.productId}`,
      emoji: products.find((p) => p.id === t.productId)?.emoji ?? "📦",
      qty: t._sum.qty ?? 0,
      total: t._sum.total ?? 0,
    })),
    debtorAging: aging,
    loyalty: {
      earned: loyalty._sum.pointsEarned ?? 0,
      redeemed: loyalty._sum.pointsRedeemed ?? 0,
    },
    daily,
    generatedAt: new Date().toISOString(),
  });
}
