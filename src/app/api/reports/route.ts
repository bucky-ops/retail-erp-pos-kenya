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

  /* stock aging — REAL: bucket every StockLevel row by the age of its current
     batch (receivedAt), valued at qty × product cost, with the heaviest items
     per bucket for the drill-down table. */
  const stockLevels = await db.stockLevel.findMany({
    include: { product: { select: { name: true, emoji: true, cost: true } }, store: { select: { name: true } } },
  });
  const bucketDefs: { bucket: string; from: number; to: number | null; color: string }[] = [
    { bucket: "0–30 days", from: 0, to: 30, color: "#00C853" },
    { bucket: "31–60 days", from: 31, to: 60, color: "#FFAB00" },
    { bucket: "61–90 days", from: 61, to: 90, color: "#FF5630" },
    { bucket: "90+ days", from: 91, to: null, color: "#B71C1C" },
  ];
  const nowMs = Date.now();
  type AgingBucket = {
    bucket: string; from: number; to: number | null; color: string;
    value: number; qty: number; items: number;
    topItems: { name: string; emoji: string; qty: number; value: number; ageDays: number; store: string }[];
  };
  const stockAging = {
    totalValue: 0,
    buckets: bucketDefs.map((b) => ({ ...b, value: 0, qty: 0, items: 0, topItems: [] as AgingBucket["topItems"] })),
  };
  for (const lv of stockLevels) {
    if (lv.qty <= 0) continue; // nothing on the shelf to age
    const ageDays = Math.max(0, Math.floor((nowMs - new Date(lv.receivedAt).getTime()) / 864e5));
    const b = stockAging.buckets.find((x) => ageDays >= x.from && (x.to === null || ageDays <= x.to)) ?? stockAging.buckets[3];
    const value = lv.qty * lv.product.cost;
    b.value += value;
    b.qty += lv.qty;
    b.items += 1;
    stockAging.totalValue += value;
    if (b.topItems.length < 5 || b.topItems.some((t) => t.value < value)) {
      b.topItems.push({
        name: lv.product.name,
        emoji: lv.product.emoji,
        qty: lv.qty,
        value: Math.round(value),
        ageDays,
        store: lv.store.name,
      });
      b.topItems.sort((a, x) => x.value - a.value);
      b.topItems = b.topItems.slice(0, 5);
    }
  }
  for (const b of stockAging.buckets) {
    b.value = Math.round(b.value);
    b.qty = Math.round(b.qty);
  }

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
    stockAging,
    generatedAt: new Date().toISOString(),
  });
}
