import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/customers/[id] - 360° customer view. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const customerId = Number(id);

  const [customer, sales, debtPlans, giftCards, smsLogs] = await Promise.all([
    db.customer.findUnique({ where: { id: customerId } }),
    db.sale.findMany({
      where: { customerId },
      include: { items: true, store: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    db.debtPlan.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } }),
    db.giftCard.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } }),
    db.smsLog.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Spend chart - last 6 months buckets
  const months: { month: string; spend: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    months.push({ month: d.toLocaleString("en", { month: "short" }), spend: 0 });
  }
  for (const s of sales) {
    const diff =
      (new Date().getFullYear() - new Date(s.createdAt).getFullYear()) * 12 +
      new Date().getMonth() - new Date(s.createdAt).getMonth();
    if (diff >= 0 && diff < 6) months[5 - diff].spend += s.total;
  }

  return NextResponse.json({
    customer,
    sales,
    debtPlans,
    giftCards,
    smsLogs,
    spendByMonth: months,
    stats: {
      visits: sales.length,
      avgBasket: sales.length ? Math.round(sales.reduce((a, s) => a + s.total, 0) / sales.length) : 0,
      lifetimeValue: customer.totalSpent,
    },
  });
}

/** PATCH /api/customers/[id] - edit tier / credit limit / notes / points. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const customer = await db.customer.update({
    where: { id: Number(id) },
    data: {
      ...(body.tier ? { tier: body.tier } : {}),
      ...(body.creditLimit !== undefined ? { creditLimit: Number(body.creditLimit) } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.loyaltyPoints !== undefined ? { loyaltyPoints: Number(body.loyaltyPoints) } : {}),
      ...(body.debtBalance !== undefined ? { debtBalance: Number(body.debtBalance) } : {}),
    },
  });
  return NextResponse.json(customer);
}
