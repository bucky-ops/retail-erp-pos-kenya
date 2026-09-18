import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET  /api/day-close — today's DayClose (lazily created from live POS sales when absent),
 *                       last 14 day closes, on-shift staff (approvers) and today's tender mix.
 * POST /api/day-close — { action, ... }
 *   action: "count"   { cashCounted, mpesaCounted }  → persist drawer counts + live variance
 *   action: "approve" { approvedBy }                 → record who signed off a big variance
 *   action: "close"   { closingCash?, note? }        → freeze Z report + auto-post sales journal
 *
 * Close is guarded: drawer counts required; |variance| > KES 100 requires an approval.
 * The close transaction also posts a balanced double-entry journal (Debit cash/M-Pesa/bank,
 * Credit VAT + revenue, COGS vs inventory) and increments each touched Account.balance.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local (server) calendar date — business days roll over at local midnight. */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const startOfLocalDay = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
};

/** "Cash" tender match (contains "Cash"). */
const isCash = (m: string) => m.includes("Cash");

/** M-Pesa family: "M-Pesa", "M-Pesa Till", "M-Pesa Paybill", plus legacy "Till"/"Paybill". */
const isMpesa = (m: string) => m.includes("M-Pesa") || m === "Till" || m === "Paybill";

interface DayCloseDTO {
  id: number;
  zNo: string;
  storeId: number;
  storeName: string;
  businessDate: string;
  status: string;
  salesTotal: number;
  receipts: number;
  cashSystem: number;
  cashCounted: number | null;
  mpesaSystem: number;
  mpesaCounted: number | null;
  cardSystem: number;
  variance: number;
  approvedBy: string;
  staffOnDuty: string;
  openingCash: number;
  closingCash: number | null;
  note: string;
  openedAt: string;
  closedAt: string | null;
}

type DayCloseRow = {
  id: number; zNo: string; storeId: number; businessDate: string; status: string;
  salesTotal: number; receipts: number; cashSystem: number; cashCounted: number | null;
  mpesaSystem: number; mpesaCounted: number | null; cardSystem: number; variance: number;
  approvedBy: string; staffOnDuty: string; openingCash: number; closingCash: number | null;
  note: string; openedAt: Date; closedAt: Date | null;
  store: { name: string } | null;
};

const serialize = (dc: DayCloseRow): DayCloseDTO => ({
  id: dc.id,
  zNo: dc.zNo,
  storeId: dc.storeId,
  storeName: dc.store?.name ?? "Store",
  businessDate: dc.businessDate,
  status: dc.status,
  salesTotal: r2(dc.salesTotal),
  receipts: dc.receipts,
  cashSystem: r2(dc.cashSystem),
  cashCounted: dc.cashCounted == null ? null : r2(dc.cashCounted),
  mpesaSystem: r2(dc.mpesaSystem),
  mpesaCounted: dc.mpesaCounted == null ? null : r2(dc.mpesaCounted),
  cardSystem: r2(dc.cardSystem),
  variance: r2(dc.variance),
  approvedBy: dc.approvedBy,
  staffOnDuty: dc.staffOnDuty,
  openingCash: r2(dc.openingCash),
  closingCash: dc.closingCash == null ? null : r2(dc.closingCash),
  note: dc.note,
  openedAt: dc.openedAt.toISOString(),
  closedAt: dc.closedAt ? dc.closedAt.toISOString() : null,
});

const dayCloseInclude = { store: { select: { name: true } } } as const;

/** Store key for the Z number: "Thika Road" → "THIKA". */
const storeKey = (name: string) => (name.split(/[\s\-]+/)[0] ?? "STORE").toUpperCase();

/**
 * Returns today's DayClose row. If none exists for today's business date, one is created
 * lazily, computing system totals from today's real Sales grouped by payment method.
 * cardSystem absorbs every non-cash / non-M-Pesa tender (Card, Gift Card, Loyalty, Credit)
 * so cash + mpesa + card always reconciles to salesTotal (keeps the journal balanced).
 */
async function ensureToday(store: { id: number; name: string }) {
  const today = localToday();
  const existing = await db.dayClose.findFirst({
    where: { businessDate: today },
    orderBy: { id: "desc" },
    include: dayCloseInclude,
  });
  if (existing) return existing as DayCloseRow;

  const sales = await db.sale.findMany({
    where: { storeId: store.id, createdAt: { gte: startOfLocalDay() } },
    select: { total: true, paymentMethod: true },
  });
  const salesTotal = r2(sales.reduce((a, s) => a + s.total, 0));
  const cashSystem = r2(sales.filter((s) => isCash(s.paymentMethod)).reduce((a, s) => a + s.total, 0));
  const mpesaSystem = r2(sales.filter((s) => isMpesa(s.paymentMethod)).reduce((a, s) => a + s.total, 0));
  const cardSystem = r2(salesTotal - cashSystem - mpesaSystem);

  const staff = await db.staff.findMany({ where: { onShift: true }, select: { name: true } });
  const staffOnDuty = staff.map((s) => s.name).join(", ") || "Counter 1";

  const zNo = `Z-${today.replace(/-/g, "")}-${storeKey(store.name)}`;
  try {
    const created = await db.dayClose.create({
      data: {
        zNo,
        storeId: store.id,
        businessDate: today,
        status: "Open",
        salesTotal,
        receipts: sales.length,
        cashSystem,
        mpesaSystem,
        cardSystem,
        variance: 0,
        approvedBy: "",
        staffOnDuty,
        openingCash: 15000,
        openedAt: new Date(),
      },
      include: dayCloseInclude,
    });
    return created as DayCloseRow;
  } catch {
    // Unique zNo collision (created concurrently) — re-read whichever row won.
    const again = await db.dayClose.findFirst({
      where: { businessDate: today },
      orderBy: { id: "desc" },
      include: dayCloseInclude,
    });
    if (again) return again as DayCloseRow;
    throw new Error("Could not open today's day-close record.");
  }
}

/** GET → { today, history[14], staffOnDuty[], breakdown[] } */
export async function GET() {
  const store = (await db.store.findFirst({ where: { isMain: true } })) ?? (await db.store.findFirst());
  if (!store) return NextResponse.json({ today: null, history: [], staffOnDuty: [], breakdown: [] });

  const todayRow = await ensureToday(store);

  // Live tender mix for today (POS feed) — powers the payment-method breakdown bar.
  const sales = await db.sale.findMany({
    where: { storeId: store.id, createdAt: { gte: startOfLocalDay() } },
    select: { total: true, paymentMethod: true },
  });
  const grouped = new Map<string, { total: number; count: number }>();
  for (const s of sales) {
    const g = grouped.get(s.paymentMethod) ?? { total: 0, count: 0 };
    g.total += s.total;
    g.count += 1;
    grouped.set(s.paymentMethod, g);
  }
  const breakdown = [...grouped.entries()]
    .map(([method, v]) => ({ method, total: r2(v.total), count: v.count }))
    .sort((a, b) => b.total - a.total);

  const history = await db.dayClose.findMany({
    orderBy: [{ businessDate: "desc" }, { id: "desc" }],
    take: 14,
    include: dayCloseInclude,
  });

  const staff = await db.staff.findMany({ where: { onShift: true }, orderBy: { name: "asc" }, select: { name: true } });

  return NextResponse.json({
    today: serialize(todayRow),
    history: history.map(serialize),
    staffOnDuty: staff.map((s) => s.name),
    breakdown,
  });
}

/** POST → per-action results. Every action returns updated state or a clear 400 error. */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    action?: "count" | "approve" | "close";
    cashCounted?: number;
    mpesaCounted?: number;
    approvedBy?: string;
    closingCash?: number;
    note?: string;
  };

  const { action } = body;
  if (!action || !["count", "approve", "close"].includes(action))
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const store = (await db.store.findFirst({ where: { isMain: true } })) ?? (await db.store.findFirst());
  if (!store) return NextResponse.json({ error: "No store configured" }, { status: 400 });

  const dc = await ensureToday(store);

  if (dc.status === "Closed")
    return NextResponse.json({ error: "Day already closed" }, { status: 400 });

  if (action === "count") {
    const cash = Number(body.cashCounted);
    const mpesa = Number(body.mpesaCounted);
    if (!Number.isFinite(cash) || cash < 0 || !Number.isFinite(mpesa) || mpesa < 0)
      return NextResponse.json(
        { error: "Enter counted totals for both the cash drawer and M-Pesa (positive numbers)." },
        { status: 400 }
      );
    const variance = r2(cash + mpesa - dc.cashSystem - dc.mpesaSystem);
    const updated = await db.dayClose.update({
      where: { id: dc.id },
      data: { cashCounted: r2(cash), mpesaCounted: r2(mpesa), variance },
      include: dayCloseInclude,
    });
    return NextResponse.json({ ok: true, today: serialize(updated) });
  }

  if (action === "approve") {
    const approvedBy = (body.approvedBy ?? "").trim();
    if (!approvedBy)
      return NextResponse.json({ error: "Select who approved the variance." }, { status: 400 });
    const updated = await db.dayClose.update({
      where: { id: dc.id },
      data: { approvedBy },
      include: dayCloseInclude,
    });
    return NextResponse.json({ ok: true, today: serialize(updated) });
  }

  // ── action === "close" ────────────────────────────────────────────────
  if (dc.cashCounted == null || dc.mpesaCounted == null)
    return NextResponse.json(
      { error: "Count the cash and M-Pesa drawers before closing the day." },
      { status: 400 }
    );
  if (Math.abs(dc.variance) > 100 && !dc.approvedBy.trim())
    return NextResponse.json(
      {
        error: `Variance of KES ${Math.abs(r2(dc.variance)).toLocaleString("en-KE")} exceeds the KES 100 tolerance — record an approval before closing.`,
      },
      { status: 400 }
    );

  const closingCash =
    Number.isFinite(Number(body.closingCash)) && Number(body.closingCash) >= 0
      ? r2(Number(body.closingCash))
      : r2(dc.cashCounted);
  const note = (body.note ?? "").slice(0, 300);

  try {
    const result = await db.$transaction(async (tx) => {
      const closed = await tx.dayClose.update({
        where: { id: dc.id },
        data: { status: "Closed", closedAt: new Date(), closingCash, note },
      });

      // ── Auto-post the daily sales journal (single balanced entry) ──
      const vat = Math.round(closed.salesTotal * (16 / 116));
      const net = r2(closed.salesTotal - vat);
      const rev4100 = Math.round(net * 0.6);
      const rev4200 = r2(net - rev4100);
      const cogs = Math.round(net * 0.64);
      const settled = r2(closed.cashSystem + closed.mpesaSystem + closed.cardSystem);
      const unsettled = r2(closed.salesTotal - settled); // credit / gift-card sales not yet settled

      const lines: { code: string; debit?: number; credit?: number; memo: string }[] = [
        { code: "1010", debit: r2(closed.cashSystem), memo: "Cash sales" },
        { code: "1030", debit: r2(closed.mpesaSystem), memo: "M-Pesa sales" },
        { code: "1100", debit: r2(closed.cardSystem), memo: "Card & other settled tenders" },
        { code: "2200", credit: vat, memo: "VAT 16% collected" },
        { code: "4100", credit: rev4100, memo: "Sales — Hardware" },
        { code: "4200", credit: rev4200, memo: "Sales — Cement & Building" },
        { code: "5100", debit: cogs, memo: "COGS (64% of net sales)" },
        { code: "1200", credit: cogs, memo: "Inventory relief" },
      ];
      if (unsettled > 0.009)
        lines.splice(3, 0, { code: "1300", debit: unsettled, memo: "Credit & gift-card sales pending settlement" });
      if (unsettled < -0.009)
        lines.splice(3, 0, { code: "4300", credit: r2(-unsettled), memo: "Tender overage" });

      // Next JV number = max numeric suffix + 1 (JV-0006 style)
      const entries = await tx.journalEntry.findMany({ select: { jvNo: true } });
      let max = 0;
      for (const j of entries) {
        const m = /(\d+)$/.exec(j.jvNo);
        if (m) max = Math.max(max, Number(m[1]));
      }
      const jvNo = `JV-${String(max + 1).padStart(4, "0")}`;

      const accounts = await tx.account.findMany({ where: { code: { in: lines.map((l) => l.code) } } });
      const byCode = new Map(accounts.map((a) => [a.code, a]));
      for (const l of lines)
        if (!byCode.has(l.code)) throw new Error(`Account ${l.code} is missing from the chart of accounts.`);

      await tx.journalEntry.create({
        data: {
          jvNo,
          date: closed.businessDate,
          memo: `Daily sales — ${closed.zNo}`,
          source: "DayClose",
          refNo: closed.zNo,
          storeId: closed.storeId,
          lines: {
            create: lines.map((l) => ({
              accountId: byCode.get(l.code)!.id,
              debit: l.debit ?? 0,
              credit: l.credit ?? 0,
              memo: l.memo,
            })),
          },
        },
      });

      // Cached account balances (debit-positive)
      for (const l of lines) {
        const delta = r2((l.debit ?? 0) - (l.credit ?? 0));
        await tx.account.update({ where: { code: l.code }, data: { balance: { increment: delta } } });
      }

      return { zNo: closed.zNo, jvNo };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not close the day.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
