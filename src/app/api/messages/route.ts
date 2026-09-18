import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/messages - SMS/WhatsApp log + campaign stats. */
export async function GET() {
  const logs = await db.smsLog.findMany({
    include: { customer: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const [customers, goldCount, debtCount, birthdayCount, weekCount] = await Promise.all([
    db.customer.count(),
    db.customer.count({ where: { tier: "Gold" } }),
    db.customer.count({ where: { debtBalance: { gt: 0 } } }),
    db.customer.count({
      where: {
        birthday: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
          lt: new Date(new Date().setHours(23, 59, 59, 999)),
        },
      },
    }),
    db.customer.count({
      where: { sales: { some: { createdAt: { gte: new Date(Date.now() - 7 * 864e5) } } } },
    }),
  ]);

  // campaign-style grouping by type
  const byType = new Map<string, { count: number; cost: number; last: Date }>();
  for (const l of logs) {
    const cur = byType.get(l.type) ?? { count: 0, cost: 0, last: l.createdAt };
    cur.count += 1;
    cur.cost += l.cost;
    if (l.createdAt > cur.last) cur.last = l.createdAt;
    byType.set(l.type, cur);
  }

  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id, customerId: l.customerId, customerName: l.customer?.name ?? null,
      phone: l.phone, message: l.message, channel: l.channel, type: l.type,
      status: l.status, cost: l.cost, createdAt: l.createdAt.toISOString(),
    })),
    audiences: {
      all: customers,
      gold: goldCount,
      hasDebt: debtCount,
      birthdayToday: birthdayCount,
      boughtLast7: weekCount,
    },
    stats: {
      totalSent: logs.length,
      totalCost: logs.reduce((a, l) => a + l.cost, 0),
      byType: Array.from(byType.entries()).map(([type, v]) => ({
        type, count: v.count, cost: v.cost, last: v.last.toISOString(),
      })),
    },
  });
}
