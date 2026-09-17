import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function computeOverdue(p: { nextDueDate: Date; status: string }): number {
  if (p.status !== "Active") return 0;
  const days = Math.floor((Date.now() - new Date(p.nextDueDate).getTime()) / 864e5);
  return Math.max(0, days);
}

/** GET /api/debt-plans — debtors with plans + aging. */
export async function GET() {
  const plans = await db.debtPlan.findMany({
    include: { customer: true },
    orderBy: [{ overdueDays: "desc" }, { nextDueDate: "asc" }],
  });

  const rows = plans.map((p) => ({
    id: p.id,
    customerId: p.customerId,
    customerName: p.customer.name,
    customerPhone: p.customer.phone,
    tier: p.customer.tier,
    invoiceNo: p.invoiceNo,
    totalDebt: p.totalDebt,
    installmentType: p.installmentType,
    installmentAmount: p.installmentAmount,
    nextDueDate: p.nextDueDate.toISOString(),
    status: p.status,
    autoReminderSms: p.autoReminderSms,
    autoBlockPosOverdue: p.autoBlockPosOverdue,
    overdueDays: Math.max(p.overdueDays, computeOverdue(p)),
  }));

  const overdue = rows.filter((r) => r.overdueDays > 0);
  return NextResponse.json({
    plans: rows,
    summary: {
      toCollect: rows.reduce((a, r) => a + r.totalDebt, 0),
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((a, r) => a + r.totalDebt, 0),
      aging: {
        d0_30: rows.filter((r) => r.overdueDays > 0 && r.overdueDays <= 30).reduce((a, r) => a + r.totalDebt, 0),
        d31_60: rows.filter((r) => r.overdueDays > 30 && r.overdueDays <= 60).reduce((a, r) => a + r.totalDebt, 0),
        d60plus: rows.filter((r) => r.overdueDays > 60).reduce((a, r) => a + r.totalDebt, 0),
      },
    },
  });
}

/** POST /api/debt-plans — create a payment plan for a customer. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.customerId || !body.totalDebt) {
    return NextResponse.json({ ok: false, error: "Customer and debt amount required" }, { status: 400 });
  }

  const customer = await db.customer.findUnique({ where: { id: Number(body.customerId) } });
  if (!customer) return NextResponse.json({ ok: false, error: "Customer not found" }, { status: 404 });

  const totalDebt = Number(body.totalDebt);
  const installmentType = body.installmentType ?? "Weekly";
  const weeks = Number(body.weeks ?? 4);
  const installmentAmount =
    Number(body.installmentAmount) ||
    Math.ceil((totalDebt / weeks) / 100) * 100;
  const nextDueDate = new Date();
  nextDueDate.setDate(nextDueDate.getDate() + (installmentType === "Weekly" ? 7 : 30));

  const plan = await db.debtPlan.create({
    data: {
      customerId: customer.id,
      invoiceNo: body.invoiceNo ?? null,
      totalDebt,
      installmentType,
      installmentAmount,
      nextDueDate,
      autoReminderSms: body.autoReminderSms ?? true,
      autoBlockPosOverdue: body.autoBlockPosOverdue ?? true,
    },
  });

  return NextResponse.json({ ok: true, plan });
}
