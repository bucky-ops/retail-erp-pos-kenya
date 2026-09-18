import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/daily - the store's daily automation jobs.
 * Mirrors a Frappe scheduler hook:
 *   1. Recompute overdueDays for all Active debt plans
 *   2. Send Birthday SMS to customers whose birthday is today (deduped per day)
 *   3. Send Debt reminder SMS 1 day before each plan's next due date (opt-out via autoReminderSms, deduped)
 *   4. Stamp settings.lastDailyJobsAt
 * Trigger from the Settings → Daily Jobs card, or wire to any external cron.
 */
async function runDailyJobs() {
  const settings = await db.settings.findUnique({ where: { id: 1 } });
  if (!settings) return NextResponse.json({ ok: false, error: "Settings missing" }, { status: 500 });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 864e5);

  // ── 1. Recompute overdue days ────────────────────────────
  const plans = await db.debtPlan.findMany({ where: { status: "Active" }, include: { customer: true } });
  let overdueUpdated = 0;
  for (const p of plans) {
    const days = Math.max(0, Math.floor((Date.now() - new Date(p.nextDueDate).getTime()) / 864e5));
    if (days !== p.overdueDays) {
      await db.debtPlan.update({ where: { id: p.id }, data: { overdueDays: days } });
      overdueUpdated++;
    }
  }

  // ── 2. Birthday SMS (dedupe per day) ─────────────────────
  const birthdayCustomers = await db.customer.findMany({
    where: { birthday: { gte: todayStart, lt: todayEnd } },
  });
  const todayLogs = await db.smsLog.findMany({
    where: { createdAt: { gte: todayStart }, type: { in: ["Birthday", "DebtReminder"] } },
    select: { customerId: true, type: true, phone: true },
  });
  const alreadySent = new Set(todayLogs.map((l) => `${l.type}:${l.customerId ?? l.phone}`));

  let birthdaySent = 0;
  for (const c of birthdayCustomers) {
    if (alreadySent.has(`Birthday:${c.id}`)) continue;
    await db.smsLog.create({
      data: {
        customerId: c.id,
        phone: c.phone,
        message: `Happy Birthday ${c.name.split(" ")[0]}! 🎉 As a ${c.tier} member enjoy ${c.tier === "Gold" ? "10%" : c.tier === "Silver" ? "5%" : "special"} off today at DukaFlow. Karibu!`,
        type: "Birthday",
        status: "Delivered",
        cost: 1,
      },
    });
    birthdaySent++;
  }

  // ── 3. Debt reminders - plans due tomorrow, opt-out respected ──
  const tomorrowStart = new Date(todayStart.getTime() + 864e5);
  const tomorrowEnd = new Date(todayStart.getTime() + 2 * 864e5);
  const dueTomorrow = plans.filter(
    (p) =>
      p.autoReminderSms &&
      new Date(p.nextDueDate) >= tomorrowStart &&
      new Date(p.nextDueDate) < tomorrowEnd
  );
  let debtRemindersSent = 0;
  for (const p of dueTomorrow) {
    if (alreadySent.has(`DebtReminder:${p.customerId}`)) continue;
    await db.smsLog.create({
      data: {
        customerId: p.customerId,
        phone: p.customer.phone,
        message: `Reminder: ${p.customer.name}, your ${p.installmentType.toLowerCase()} installment of KES ${Math.round(p.installmentAmount).toLocaleString()} is due tomorrow (${new Date(p.nextDueDate).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}). Balance KES ${Math.round(p.totalDebt).toLocaleString()}. - DukaFlow`,
        type: "DebtReminder",
        status: "Delivered",
        cost: 1,
      },
    });
    debtRemindersSent++;
  }

  // ── 4. Daily expenses digest - today's petty cash + bills ──
  // Owner's morning digest: what the business spent today, by category,
  // logged as an Email-type entry in SmsLog (mock mailer).
  const todayExpenses = await db.expense.findMany({
    where: { spentAt: { gte: todayStart, lt: todayEnd } },
    include: { store: { select: { name: true } } },
  });
  const expenseTotal = todayExpenses.reduce((s, e) => s + e.amount, 0);
  const byCategory = new Map<string, number>();
  for (const e of todayExpenses) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
  const categorySummary = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => `${cat}: KES ${Math.round(amt).toLocaleString()}`)
    .join(" • ");
  let expenseDigestLogged = false;
  if (todayExpenses.length > 0) {
    // Dedupe per day: only log if no expense digest exists for today yet.
    const existingDigest = await db.smsLog.findFirst({
      where: { createdAt: { gte: todayStart, lt: todayEnd }, type: "ExpenseDigest" },
    });
    if (!existingDigest) {
      await db.smsLog.create({
        data: {
          phone: "owner@dukaflow.co.ke",
          message: `Daily expense digest: ${todayExpenses.length} entries totaling KES ${Math.round(expenseTotal).toLocaleString()}. ${categorySummary}.`,
          type: "ExpenseDigest",
          channel: "Email",
          status: "Delivered",
          cost: 0,
        },
      });
      expenseDigestLogged = true;
    }
  }

  await db.settings.update({ where: { id: 1 }, data: { lastDailyJobsAt: new Date() } });

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    overdueUpdated,
    birthdaySent,
    debtRemindersSent,
    birthdayCandidates: birthdayCustomers.length,
    reminderCandidates: dueTomorrow.length,
    expenses: { count: todayExpenses.length, total: expenseTotal, digestLogged: expenseDigestLogged },
  });
}

export async function GET() {
  return runDailyJobs();
}

export async function POST() {
  return runDailyJobs();
}
