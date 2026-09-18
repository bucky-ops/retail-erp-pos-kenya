import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/report - scheduled report email (mock mailer).
 *
 * Mirrors a Frappe scheduler hook that emails the owner their sales report:
 *   - Daily   → covers the previous day
 *   - Weekly  → covers the previous 7 days (Monday 08:00 EAT)
 *   - Monthly → covers the previous 30 days (1st 08:00 EAT)
 *
 * Due-check: a report is due when lastSentAt is older than the frequency
 * window (or force=1 - used by the "Send test now" button in Settings /
 * the Reports schedule dialog). Every send is logged to SmsLog with
 * channel="Email" so the owner can audit the mail history in Messages.
 *
 * Body/query: ?force=1 to bypass the due-check (test send).
 */
async function runScheduledReport(force = false) {
  const settings = await db.settings.findUnique({ where: { id: 1 } });
  if (!settings) return NextResponse.json({ ok: false, error: "Settings missing" }, { status: 500 });

  if (!settings.reportScheduleEnabled) {
    return NextResponse.json({ ok: false, reason: "disabled", message: "Scheduled reports are switched off." });
  }

  const freq = settings.reportScheduleFrequency; // Daily | Weekly | Monthly
  const windowDays = freq === "Daily" ? 1 : freq === "Monthly" ? 30 : 7;

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - windowDays * 864e5);

  // ── Due check (skipped for force/test sends) ─────────────
  if (!force && settings.reportScheduleLastSentAt) {
    const last = new Date(settings.reportScheduleLastSentAt).getTime();
    const elapsedDays = (periodEnd.getTime() - last) / 864e5;
    if (elapsedDays < windowDays) {
      const nextDue = new Date(last + windowDays * 864e5);
      return NextResponse.json({
        ok: false,
        reason: "not-due",
        message: `Next ${freq.toLowerCase()} report due ${nextDue.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })} 08:00 EAT.`,
        nextDue,
      });
    }
  }

  // ── Build the report summary from real sales ─────────────
  const sales = await db.sale.findMany({
    where: { createdAt: { gte: periodStart, lte: periodEnd }, status: "Completed" },
    include: { items: { include: { product: true } }, store: true },
  });

  const revenue = sales.reduce((a, s) => a + s.total, 0);
  const discounts = sales.reduce((a, s) => a + s.discount, 0);
  const vat = sales.reduce((a, s) => a + s.vat, 0);
  const avg = sales.length ? revenue / sales.length : 0;

  const byMethod: Record<string, number> = {};
  for (const s of sales) byMethod[s.paymentMethod] = (byMethod[s.paymentMethod] ?? 0) + s.total;

  // Top 3 products by revenue in the period
  const byProduct: Record<string, { qty: number; revenue: number }> = {};
  for (const s of sales) {
    for (const it of s.items) {
      const name = it.product?.name ?? "Item";
      byProduct[name] = byProduct[name] ?? { qty: 0, revenue: 0 };
      byProduct[name].qty += it.qty;
      byProduct[name].revenue += it.qty * it.unitPrice;
    }
  }
  const topProducts = Object.entries(byProduct)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 3);

  // Per-store split
  const byStore: Record<string, number> = {};
  for (const s of sales) byStore[s.store?.name ?? "Unknown"] = (byStore[s.store?.name ?? "Unknown"] ?? 0) + s.total;

  const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
  const rangeLabel = `${periodStart.toLocaleDateString("en-KE", { day: "numeric", month: "short" })} → ${periodEnd.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}`;

  const lines = [
    `📊 ${settings.companyName} - ${freq} Sales Report (${rangeLabel})`,
    `Receipts: ${sales.length} • Revenue: ${fmtKES(revenue)} • Avg basket: ${fmtKES(avg)}`,
    `Discounts given: ${fmtKES(discounts)} • VAT collected: ${fmtKES(vat)}`,
    ...topProducts.map(([name, p], i) => `${i + 1}. ${name} - ${p.qty} sold • ${fmtKES(p.revenue)}`),
    Object.keys(byStore).length > 1
      ? `Stores: ${Object.entries(byStore).map(([st, rev]) => `${st} ${fmtKES(rev)}`).join(" • ")}`
      : "",
    `Payments: ${Object.entries(byMethod).sort((a, b) => b[1] - a[1]).map(([m, v]) => `${m} ${fmtKES(v)}`).join(" • ") || "No sales"}`,
    `- sent automatically by DukaFlow (${freq} schedule, 08:00 EAT)`,
  ].filter(Boolean);

  const message = lines.join("\n");

  // ── Log the mock email (auditable in Messages → log) ─────
  await db.smsLog.create({
    data: {
      phone: settings.reportScheduleEmail,
      message,
      channel: "Email",
      type: "ReportEmail",
      status: "Delivered",
      cost: 0,
    },
  });

  await db.settings.update({ where: { id: 1 }, data: { reportScheduleLastSentAt: new Date() } });

  return NextResponse.json({
    ok: true,
    sent: true,
    frequency: freq,
    email: settings.reportScheduleEmail,
    periodStart,
    periodEnd,
    summary: {
      receipts: sales.length,
      revenue,
      avgBasket: avg,
      discounts,
      vat,
      byMethod,
      byStore,
      topProducts: topProducts.map(([name, p]) => ({ name, qty: p.qty, revenue: p.revenue })),
    },
    message,
  });
}

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  return runScheduledReport(force);
}

export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  return runScheduledReport(force);
}
