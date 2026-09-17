import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/debt-plans/[id]
 * actions: update settings | recordPayment (reduce debt, reschedule) | remind (SMS now)
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const plan = await db.debtPlan.findUnique({ where: { id: Number(id) }, include: { customer: true } });
  if (!plan) return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });

  if (body.action === "recordPayment") {
    const amount = Number(body.amount);
    if (!amount || amount <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid payment amount" }, { status: 400 });
    }
    const remaining = Math.max(0, plan.totalDebt - amount);
    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + (plan.installmentType === "Weekly" ? 7 : 30));

    const updated = await db.debtPlan.update({
      where: { id: plan.id },
      data: {
        totalDebt: remaining,
        nextDueDate: nextDue,
        overdueDays: 0,
        status: remaining <= 0 ? "Completed" : "Active",
      },
    });
    // reduce customer debt balance
    const paid = Math.min(amount, plan.customer.debtBalance);
    await db.customer.update({
      where: { id: plan.customerId },
      data: { debtBalance: { decrement: paid } },
    });
    // payment ledger row — powers the printable debtor statement
    await db.debtPayment.create({
      data: {
        debtPlanId: plan.id,
        customerId: plan.customerId,
        amount,
        method: body.method ?? "Cash",
        note: body.note?.slice(0, 200) ?? null,
      },
    });
    // payment SMS receipt
    await db.smsLog.create({
      data: {
        customerId: plan.customerId, phone: plan.customer.phone,
        message: `Payment of KES ${amount.toLocaleString()} received. Remaining balance: KES ${remaining.toLocaleString()}. Asante ${plan.customer.name}!`,
        type: "Receipt", status: "Delivered", cost: 1,
      },
    });
    return NextResponse.json({ ok: true, plan: updated });
  }

  if (body.action === "remind") {
    await db.smsLog.create({
      data: {
        customerId: plan.customerId, phone: plan.customer.phone,
        message: `Reminder: ${plan.customer.name}, you have KES ${Math.round(plan.totalDebt).toLocaleString()} due. Next installment KES ${plan.installmentAmount.toLocaleString()} (${plan.installmentType}). - DukaFlow`,
        type: "DebtReminder", status: "Delivered", cost: 1,
      },
    });
    return NextResponse.json({ ok: true, reminded: true });
  }

  // plain field updates
  const updated = await db.debtPlan.update({
    where: { id: plan.id },
    data: {
      ...(body.installmentAmount !== undefined ? { installmentAmount: Number(body.installmentAmount) } : {}),
      ...(body.installmentType ? { installmentType: body.installmentType } : {}),
      ...(body.autoReminderSms !== undefined ? { autoReminderSms: !!body.autoReminderSms } : {}),
      ...(body.autoBlockPosOverdue !== undefined ? { autoBlockPosOverdue: !!body.autoBlockPosOverdue } : {}),
      ...(body.status ? { status: body.status } : {}),
    },
  });
  return NextResponse.json({ ok: true, plan: updated });
}

/** DELETE /api/debt-plans/[id] */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.debtPlan.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
