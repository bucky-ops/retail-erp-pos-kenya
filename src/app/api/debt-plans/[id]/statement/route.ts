import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/debt-plans/[id]/statement — everything the printable debtor
 * statement needs: customer + plan, credit invoices, payment ledger and
 * account summary. The UI renders this as an A4 statement (print → PDF).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const plan = await db.debtPlan.findUnique({
    where: { id: Number(id) },
    include: { customer: true },
  });
  if (!plan) return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });

  // All credit-sale invoices for this customer (the debts the statement covers).
  const invoices = await db.sale.findMany({
    where: { customerId: plan.customerId, paymentMethod: "Credit Sale" },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  // Payment ledger for this plan (oldest first for statement reading order).
  const payments = await db.debtPayment.findMany({
    where: { debtPlanId: plan.id },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  const invoicedTotal = invoices.reduce((a, s) => a + s.total, 0);
  const paidTotal = payments.reduce((a, p) => a + p.amount, 0);
  const creditLimit = plan.customer.creditLimit;
  const debtBalance = plan.customer.debtBalance;

  // Oldest invoice age, for the aging line on the statement.
  const now = Date.now();
  const oldestInvoiceAgeDays = invoices.length
    ? Math.max(
        0,
        ...invoices.map((s) => Math.floor((now - new Date(s.createdAt).getTime()) / 864e5))
      )
    : 0;

  return NextResponse.json({
    ok: true,
    customer: {
      id: plan.customer.id,
      name: plan.customer.name,
      phone: plan.customer.phone,
      email: plan.customer.email,
      tier: plan.customer.tier,
    },
    plan: {
      id: plan.id,
      invoiceNo: plan.invoiceNo,
      installmentType: plan.installmentType,
      installmentAmount: plan.installmentAmount,
      nextDueDate: plan.nextDueDate.toISOString(),
      status: plan.status,
      overdueDays: plan.overdueDays,
      balance: plan.totalDebt,
    },
    invoices: invoices.map((s) => ({
      id: s.id,
      receiptNo: s.receiptNo,
      createdAt: s.createdAt.toISOString(),
      total: s.total,
      status: s.kraStatus,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method,
      note: p.note,
      createdAt: p.createdAt.toISOString(),
    })),
    summary: {
      invoicedTotal,
      paidTotal,
      balance: plan.totalDebt,
      creditLimit,
      availableCredit: Math.max(0, creditLimit - debtBalance),
      oldestInvoiceAgeDays,
      generatedAt: new Date().toISOString(),
    },
  });
}
