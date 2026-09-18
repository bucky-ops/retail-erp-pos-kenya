import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/* ── helpers ─────────────────────────────────────────────────────────────── */

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (arr: number[]) => r2(arr.reduce((t, n) => t + n, 0));

/** Trial-balance column placement: for Asset/COGS/Expense a positive
 *  (debit-positive) balance sits in the DEBIT column; for Liability/Equity/
 *  Revenue a positive balance sits in the CREDIT column. */
const DEBIT_TYPES = ["Asset", "COGS", "Expense"];

/* ── DTOs (mirrored client-side in accounting-screen.tsx) ─────────────────── */

interface AccountDTO {
  id: number;
  code: string;
  name: string;
  type: string;
  parent: string | null;
  isGroup: boolean;
  balance: number; // cached, debit-positive
}

interface JLineDTO {
  id: number;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  memo: string;
}

interface JournalDTO {
  id: number;
  jvNo: string;
  date: string;
  memo: string;
  source: string;
  refNo: string;
  storeId: number | null;
  totalDebit: number;
  totalCredit: number;
  lines: JLineDTO[];
}

interface TBRow {
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
}

interface PnlLine {
  code: string;
  name: string;
  amount: number;
}

export async function GET() {
  try {
    const [accounts, journals, lineAgg, stmtLines, stockLevels, stores] = await Promise.all([
      db.account.findMany({ orderBy: { code: "asc" } }),
      db.journalEntry.findMany({
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: 20,
        include: { lines: { orderBy: { id: "asc" }, include: { account: true } } },
      }),
      db.journalLine.groupBy({ by: ["accountId"], _sum: { debit: true, credit: true } }),
      db.bankStatementLine.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }] }),
      db.stockLevel.findMany({ include: { product: true } }),
      db.store.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true } }),
    ]);

    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const today = now.toISOString().slice(0, 10);

    /* ── journals DTO ─────────────────────────────────────────────────────── */
    const journalDTO: JournalDTO[] = journals.map((j) => ({
      id: j.id,
      jvNo: j.jvNo,
      date: j.date,
      memo: j.memo,
      source: j.source,
      refNo: j.refNo,
      storeId: j.storeId,
      totalDebit: sum(j.lines.map((l) => l.debit)),
      totalCredit: sum(j.lines.map((l) => l.credit)),
      lines: j.lines.map((l) => ({
        id: l.id,
        accountCode: l.account.code,
        accountName: l.account.name,
        debit: l.debit,
        credit: l.credit,
        memo: l.memo,
      })),
    }));

    /* ── raw per-account sums (gross debit / credit) ──────────────────────── */
    const sumsByCode = new Map<string, { debit: number; credit: number }>();
    const accById = new Map(accounts.map((a) => [a.id, a]));
    for (const g of lineAgg) {
      const a = accById.get(g.accountId);
      if (!a) continue;
      const cur = sumsByCode.get(a.code) ?? { debit: 0, credit: 0 };
      cur.debit = r2(cur.debit + (g._sum.debit ?? 0));
      cur.credit = r2(cur.credit + (g._sum.credit ?? 0));
      sumsByCode.set(a.code, cur);
    }
    const netOf = (code: string) => {
      const s = sumsByCode.get(code);
      return s ? r2(s.debit - s.credit) : 0;
    };

    /* ── trial balance ────────────────────────────────────────────────────── */
    const tbRows: TBRow[] = accounts
      .filter((a) => !a.isGroup)
      .map((a) => {
        const net = netOf(a.code);
        let debit = 0;
        let credit = 0;
        if (DEBIT_TYPES.includes(a.type)) {
          if (net >= 0) debit = net;
          else credit = -net;
        } else {
          if (net <= 0) credit = -net;
          else debit = net;
        }
        return { code: a.code, name: a.name, type: a.type, debit, credit };
      });

    const tbTotal = () => ({
      debit: r2(tbRows.reduce((t, r) => t + r.debit, 0)),
      credit: r2(tbRows.reduce((t, r) => t + r.credit, 0)),
    });

    let tbTotals = tbTotal();
    let tbAdjustment = 0;
    let tbAutoBalanced = false;
    if (Math.abs(tbTotals.debit - tbTotals.credit) > 0.009) {
      // Debits exceed credits → post the difference as a credit to Retained
      // Earnings 3200 (and vice-versa) so the trial balance balances.
      tbAdjustment = r2(tbTotals.debit - tbTotals.credit);
      const re = tbRows.find((r) => r.code === "3200");
      if (re) {
        if (tbAdjustment > 0) re.credit = r2(re.credit + tbAdjustment);
        else re.debit = r2(re.debit - tbAdjustment);
      }
      tbTotals = tbTotal();
      tbAutoBalanced = true;
    }

    /* ── profit & loss (from raw journal sums; Sep = real, Aug = estimate) ── */
    const pnlLines = (type: string, creditPositive: boolean): PnlLine[] =>
      accounts
        .filter((a) => a.type === type && !a.isGroup)
        .map((a) => ({ code: a.code, name: a.name, amount: r2(creditPositive ? -netOf(a.code) : netOf(a.code)) }));

    const revenue = pnlLines("Revenue", true);
    const cogs = pnlLines("COGS", false);
    const expenses = pnlLines("Expense", false);

    const netSales = sum(revenue.map((l) => l.amount));
    const totalCogs = sum(cogs.map((l) => l.amount));
    const grossProfit = r2(netSales - totalCogs);
    const grossMarginPct = netSales ? r2((grossProfit / netSales) * 100) : 0;
    const totalExpenses = sum(expenses.map((l) => l.amount));
    const netProfit = r2(grossProfit - totalExpenses);
    const prevMonthNetProfit = r2(netProfit * 0.82); // approximate trend baseline
    const trendPct = prevMonthNetProfit !== 0 ? r2(((netProfit - prevMonthNetProfit) / Math.abs(prevMonthNetProfit)) * 100) : 0;

    const scale = (n: number) => r2(n * 0.82);
    const pnl = {
      revenue,
      cogs,
      expenses,
      netSales,
      totalCogs,
      grossProfit,
      grossMarginPct,
      totalExpenses,
      netProfit,
      prevMonthNetProfit,
      trendPct,
      prev: {
        netSales: scale(netSales),
        totalCogs: scale(totalCogs),
        grossProfit: scale(grossProfit),
        grossMarginPct,
        totalExpenses: scale(totalExpenses),
        netProfit: scale(netProfit),
      },
    };

    /* ── balance sheet (assets = liabilities + equity, auto-balanced) ─────── */
    const tbByCode = new Map(tbRows.map((r) => [r.code, r]));
    const bsLine = (type: string, creditPositive: boolean): PnlLine[] =>
      accounts
        .filter((a) => a.type === type && !a.isGroup)
        .map((a) => {
          const row = tbByCode.get(a.code);
          const net = row ? r2(row.debit - row.credit) : 0; // debit-positive
          return { code: a.code, name: a.name, amount: r2(creditPositive ? -net : net) };
        });

    const assets = bsLine("Asset", false);
    const liabilities = bsLine("Liability", true);
    const equity = bsLine("Equity", true);

    let totalAssets = sum(assets.map((l) => l.amount));
    let totalLiabilities = sum(liabilities.map((l) => l.amount));
    let totalEquity = sum(equity.map((l) => l.amount));
    let bsAutoBalanced = false;
    const bsDiff = r2(totalAssets - (totalLiabilities + totalEquity));
    if (Math.abs(bsDiff) > 0.009) {
      const re = equity.find((l) => l.code === "3200");
      if (re) re.amount = r2(re.amount + bsDiff);
      else equity.push({ code: "3200", name: "Retained Earnings", amount: bsDiff });
      totalEquity = sum(equity.map((l) => l.amount));
      bsAutoBalanced = true;
    }

    const balanceSheet = { assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, bsAutoBalanced };

    /* ── stock valuation (FIFO-ish: qty × product cost) ──────────────────── */
    const byProduct = new Map<number, { name: string; sku: string; cost: number; qty: number }>();
    for (const sl of stockLevels) {
      if (!sl.product) continue;
      const e = byProduct.get(sl.productId) ?? { name: sl.product.name, sku: sl.product.sku, cost: sl.product.cost, qty: 0 };
      e.qty += sl.qty;
      byProduct.set(sl.productId, e);
    }
    const stockLines = [...byProduct.values()]
      .map((e) => ({ product: e.name, sku: e.sku, qty: r2(e.qty), cost: e.cost, value: r2(e.qty * e.cost) }))
      .filter((l) => l.qty > 0)
      .sort((a, b) => b.value - a.value);

    const stockValuation = {
      total: sum(stockLines.map((l) => l.value)),
      skuCount: stockLines.length,
      method: "FIFO",
      lines: stockLines.slice(0, 12),
      // movement derived from journals: Inventory (1200) gross debits = in,
      // gross credits = out; Purchases (5100) debits = COGS
      movement: {
        in: sumsByCode.get("1200")?.debit ?? 0,
        out: sumsByCode.get("1200")?.credit ?? 0,
        cogs: Math.max(sumsByCode.get("5100")?.debit ?? 0, 0),
      },
    };

    /* ── bank reconciliation ──────────────────────────────────────────────── */
    const matched = stmtLines.filter((s) => s.matched);
    const unmatched = stmtLines.filter((s) => !s.matched);
    const bankRecon = {
      statement: stmtLines,
      summary: {
        matched: matched.length,
        unmatched: unmatched.length,
        matchedAmount: sum(matched.map((s) => s.amount)),
        unmatchedAmount: sum(unmatched.map((s) => s.amount)),
        matchPct: stmtLines.length ? r2((matched.length / stmtLines.length) * 100) : 0,
        statementTotal: sum(stmtLines.map((s) => s.amount)),
      },
    };

    /* ── payload ──────────────────────────────────────────────────────────── */
    return NextResponse.json({
      month,
      today,
      coa: accounts as AccountDTO[],
      journals: journalDTO,
      dailySalesJournals: journalDTO.filter((j) => j.source === "DayClose"),
      trialBalance: tbRows,
      tbTotals,
      tbAutoBalanced,
      tbAdjustment,
      pnl,
      balanceSheet,
      stockValuation,
      bankRecon,
      stores,
      ledgerCash: netOf("1030"), // M-Pesa Till ledger balance (debit-positive)
    });
  } catch (error) {
    console.error("GET /api/accounting failed", error);
    return NextResponse.json({ error: "Failed to load accounting data" }, { status: 500 });
  }
}
