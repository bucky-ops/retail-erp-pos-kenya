import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Debtor statement email - mock mailer (audited in Messages → SmsLog
 * channel "Email", type "Statement"), mirroring the KRA e-invoice email flow.
 *
 * GET  /api/debt-plans/[id]/statement/email          → preview (no send)
 * POST /api/debt-plans/[id]/statement/email { to? }  → send; a typed address
 *                                                      is saved on the customer
 *                                                      for future statements.
 */

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const fmtDay = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const built = await buildStatementEmail(Number(id));
  if (!built) return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    subject: built.subject,
    body: built.body,
    to: built.customerEmail,
    customerName: built.plan.customer.name,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const planId = Number(id);
  let to = "";
  try {
    const b = (await req.json()) as { to?: string };
    to = (b.to ?? "").trim();
  } catch {
    /* empty body is fine - fall back to the email on file */
  }

  const built = await buildStatementEmail(planId);
  if (!built) return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });

  const recipient = to || built.customerEmail;
  if (!recipient) {
    return NextResponse.json(
      { ok: false, error: "No email address - enter one, or save an email on the customer first." },
      { status: 400 }
    );
  }

  // Mock mailer → auditable message log (same channel the real provider would use).
  await db.smsLog.create({
    data: {
      customerId: built.plan.customerId,
      phone: recipient,
      message: built.body,
      channel: "Email",
      type: "Statement",
      status: "Delivered",
      cost: 0,
    },
  });

  // Persist a typed address so future statements auto-address themselves.
  if (to && to !== built.customerEmail) {
    await db.customer.update({ where: { id: built.plan.customerId }, data: { email: to } });
  }

  return NextResponse.json({ ok: true, to: recipient, planNo: built.plan.invoiceNo ?? `PLAN-${built.plan.id}` });
}

/** Loads plan + ledger and renders the statement email body in one call. */
async function buildStatementEmail(planId: number) {
  const plan = await db.debtPlan.findUnique({
    where: { id: planId },
    include: {
      customer: { select: { name: true, phone: true, email: true, tier: true } },
      payments: { orderBy: { createdAt: "asc" }, take: 200 },
    },
  });
  if (!plan) return null;

  const invoices = await db.sale.findMany({
    where: { customerId: plan.customerId, paymentMethod: "Credit Sale" },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { receiptNo: true, createdAt: true, total: true },
  });

  const settings = await db.settings.findFirst();
  const companyName = settings?.companyName ?? "DukaFlow Ltd";

  const invoicedTotal = invoices.reduce((a, s) => a + s.total, 0);
  const paidTotal = plan.payments.reduce((a, p) => a + p.amount, 0);

  const invoiceLines = invoices.length
    ? invoices
        .map((s) => `  • ${s.receiptNo} - ${fmtDay(s.createdAt)} - ${fmtKES(s.total)}`)
        .join("\n")
    : "  • (no credit invoices on record)";
  const paymentLines = plan.payments.length
    ? plan.payments
        .map((p) => `  • ${fmtDay(p.createdAt)} - ${p.method}${p.note ? ` (${p.note})` : ""} - −${fmtKES(p.amount)}`)
        .join("\n")
    : "  • (no payments recorded yet)";

  const subject = `${companyName} - Account Statement ${plan.customer.name} (balance ${fmtKES(plan.totalDebt)})`;
  const body = [
    `Habari ${plan.customer.name},`,
    "",
    `Here is your account statement from ${companyName}. Please review the balance below - paying on time keeps your credit line open and your loyalty tier growing.`,
    "",
    `Statement date:   ${fmtDay(new Date())}`,
    `Account:          ${plan.customer.name}${plan.customer.phone ? ` (${plan.customer.phone})` : ""}`,
    `Plan:             ${plan.installmentType.toLowerCase()} installments of ${fmtKES(plan.installmentAmount)}`,
    `Next due:         ${fmtDay(plan.nextDueDate)}${plan.overdueDays > 0 ? `  ⚠ ${plan.overdueDays} days overdue` : ""}`,
    "",
    "Credit invoices",
    invoiceLines,
    "",
    "Payments received",
    paymentLines,
    "",
    `Invoiced:   ${fmtKES(invoicedTotal)}`,
    `Paid:       −${fmtKES(paidTotal)}`,
    `BALANCE:    ${fmtKES(plan.totalDebt)}`,
    "",
    plan.autoReminderSms
      ? "You will receive a reminder SMS a few days before each installment is due."
      : "",
    plan.autoBlockPosOverdue && plan.overdueDays > 0
      ? "⚠ Note: new credit sales are paused while the account is overdue."
      : "",
    "",
    "Pay via M-Pesa Buy Goods or at any branch - karibu tena!",
    `${companyName} • accounts@dukaflow.co.ke • +254 700 123 456`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { plan, subject, body, customerEmail: plan.customer.email || "" };
}
