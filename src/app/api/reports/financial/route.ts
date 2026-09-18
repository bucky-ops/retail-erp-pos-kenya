import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPayload } from "@/lib/receipt";

export const dynamic = "force-dynamic";

/**
 * Financial + ledger reports with verification hash (the printed QR encodes
 * /verify/{hash}):
 *   kind=general-ledger [&from=&to=&accountId=]
 *   kind=trial-balance
 *   kind=balance-sheet
 *   kind=debtors-ledger [&customerId=]   (per customer + ALL)
 *   kind=creditors-ledger [&supplierId=] (per supplier + ALL)
 *   kind=stock-ledger [&storeId=]
 *   kind=mpesa-recon
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind") ?? "general-ledger";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const accountId = Number(sp.get("accountId") ?? 0);
  const customerId = Number(sp.get("customerId") ?? 0);
  const supplierId = Number(sp.get("supplierId") ?? 0);
  const storeId = Number(sp.get("storeId") ?? 0);

  const dateFilter = (d: string) => ({
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  });

  try {
    if (kind === "general-ledger") {
      const entries = await db.journalEntry.findMany({
        where: from || to ? { date: dateFilter(from) } : undefined,
        include: { lines: { include: { account: true }, orderBy: { id: "asc" } } },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      });
      const rows: {
        date: string; jvNo: string; accountCode: string; accountName: string;
        debit: number; credit: number; memo: string; refNo: string;
      }[] = [];
      for (const e of entries) {
        for (const l of e.lines) {
          if (accountId && l.accountId !== accountId) continue;
          rows.push({
            date: e.date, jvNo: e.jvNo,
            accountCode: l.account.code, accountName: l.account.name,
            debit: r2(l.debit), credit: r2(l.credit), memo: l.memo || e.memo, refNo: e.refNo,
          });
        }
      }
      const totals = {
        debit: r2(rows.reduce((s, r) => s + r.debit, 0)),
        credit: r2(rows.reduce((s, r) => s + r.credit, 0)),
      };
      const hash = hashPayload({ kind, rows, totals });
      return NextResponse.json({ ok: true, kind, title: "General Ledger", rows, totals, hash, generatedAt: new Date().toISOString() });
    }

    if (kind === "trial-balance" || kind === "balance-sheet") {
      const accounts = await db.account.findMany({ orderBy: { code: "asc" } });
      const agg = await db.journalLine.groupBy({ by: ["accountId"], _sum: { debit: true, credit: true } });
      const balMap = new Map(agg.map((a) => [a.accountId, r2((a._sum.debit ?? 0) - (a._sum.credit ?? 0))]));
      const DEBIT_TYPES = ["Asset", "COGS", "Expense"];
      const rows = accounts
        .filter((a) => !a.isGroup)
        .map((a) => {
          const bal = balMap.get(a.id) ?? a.balance ?? 0;
          const debit = DEBIT_TYPES.includes(a.type) ? Math.max(0, bal) : Math.max(0, -bal);
          const credit = DEBIT_TYPES.includes(a.type) ? Math.max(0, -bal) : Math.max(0, bal);
          return { code: a.code, name: a.name, type: a.type, debit: r2(debit), credit: r2(credit) };
        })
        .filter((r) => r.debit !== 0 || r.credit !== 0);
      const totals = {
        debit: r2(rows.reduce((s, r) => s + r.debit, 0)),
        credit: r2(rows.reduce((s, r) => s + r.credit, 0)),
      };
      let extra: Record<string, unknown> = {};
      if (kind === "balance-sheet") {
        const assets = rows.filter((r) => r.type === "Asset");
        const liabilities = rows.filter((r) => r.type === "Liability");
        const equity = rows.filter((r) => r.type === "Equity");
        const revenue = r2(rows.filter((r) => r.type === "Revenue").reduce((s, r) => s + r.credit - r.debit, 0));
        const cogs = r2(rows.filter((r) => r.type === "COGS").reduce((s, r) => s + r.debit - r.credit, 0));
        const expenses = r2(rows.filter((r) => r.type === "Expense").reduce((s, r) => s + r.debit - r.credit, 0));
        const profit = r2(revenue - cogs - expenses);
        extra = {
          sections: {
            assets: assets.map((r) => ({ ...r, balance: r2(r.debit - r.credit) })),
            liabilities: liabilities.map((r) => ({ ...r, balance: r2(r.credit - r.debit) })),
            equity: equity.map((r) => ({ ...r, balance: r2(r.credit - r.debit) })),
          },
          retainedProfit: profit,
          totalAssets: r2(assets.reduce((s, r) => s + r.debit - r.credit, 0)),
          totalLiabilities: r2(liabilities.reduce((s, r) => s + r.credit - r.debit, 0)),
          totalEquity: r2(equity.reduce((s, r) => s + r.credit - r.debit, 0) + profit),
        };
      }
      const hash = hashPayload({ kind, rows, totals, extra });
      return NextResponse.json({
        ok: true, kind,
        title: kind === "trial-balance" ? "Trial Balance" : "Balance Sheet",
        rows, totals, ...extra, hash, generatedAt: new Date().toISOString(),
      });
    }

    if (kind === "debtors-ledger") {
      const customers = await db.customer.findMany({
        where: customerId ? { id: customerId } : undefined,
        include: { debtPlans: { include: { payments: true } } },
        orderBy: { name: "asc" },
      });
      const rows = customers.map((c) => {
        const plans = c.debtPlans.map((p) => {
          const paid = r2(p.payments.reduce((s, x) => s + x.amount, 0));
          return {
            invoiceNo: p.invoiceNo ?? `PLAN-${p.id}`,
            totalDebt: r2(p.totalDebt), paid, outstanding: r2(p.totalDebt - paid),
            status: p.status, overdueDays: p.overdueDays, nextDueDate: p.nextDueDate,
            payments: p.payments.map((x) => ({ amount: r2(x.amount), method: x.method, createdAt: x.createdAt, note: x.note })),
          };
        });
        const outstanding = r2(plans.reduce((s, p) => s + p.outstanding, 0));
        return {
          customerId: c.id, name: c.name, phone: c.phone, tier: c.tier,
          debtBalance: r2(c.debtBalance), ledgerOutstanding: outstanding,
          creditLimit: r2(c.creditLimit), plans,
        };
      });
      const totals = {
        systemDebt: r2(rows.reduce((s, r) => s + r.debtBalance, 0)),
        ledgerOutstanding: r2(rows.reduce((s, r) => s + r.ledgerOutstanding, 0)),
      };
      const hash = hashPayload({ kind, rows, totals });
      return NextResponse.json({ ok: true, kind, title: "Debtors Ledger", rows, totals, hash, generatedAt: new Date().toISOString() });
    }

    if (kind === "creditors-ledger") {
      const suppliers = await db.supplier.findMany({
        where: supplierId ? { id: supplierId } : undefined,
        include: { purchaseOrders: true },
        orderBy: { name: "asc" },
      });
      const rows = suppliers.map((s) => {
        const totalOrdered = r2(s.purchaseOrders.reduce((t, p) => t + p.total, 0));
        const open = s.purchaseOrders.filter((p) => p.status !== "Received" && p.status !== "Paid");
        return {
          supplierId: s.id, name: s.name, contact: s.email, phone: s.phone,
          category: s.category,
          totalOrdered,
          payable: r2(open.reduce((t, p) => t + p.total, 0)),
          openOrders: open.length,
          orders: s.purchaseOrders.map((p) => ({ poNo: p.poNo, total: r2(p.total), status: p.status, createdAt: p.orderedAt })),
        };
      });
      const totals = { payable: r2(rows.reduce((s, r) => s + r.payable, 0)) };
      const hash = hashPayload({ kind, rows, totals });
      return NextResponse.json({ ok: true, kind, title: "Creditors Ledger", rows, totals, hash, generatedAt: new Date().toISOString() });
    }

    if (kind === "stock-ledger") {
      const levels = await db.stockLevel.findMany({
        where: storeId ? { storeId } : undefined,
        include: { product: true, store: true },
        orderBy: [{ storeId: "asc" }, { productId: "asc" }],
      });
      const moves = await db.stockTransfer.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      const rows = levels.map((l) => ({
        store: l.store.name, sku: l.product.sku, name: l.product.name,
        category: l.product.category, qty: l.qty, unit: l.product.unit,
        reorderPoint: l.reorderPoint, value: r2(l.qty * l.product.cost),
        receivedAt: l.receivedAt,
        low: l.qty <= l.reorderPoint,
      }));
      const transfers = moves.map((m) => ({
        product: `#${m.productId}`, from: m.fromStoreId, to: m.toStoreId,
        qty: m.qty, status: m.status, createdAt: m.createdAt,
      }));
      const totals = { totalValue: r2(rows.reduce((s, r) => s + r.value, 0)), lines: rows.length };
      const hash = hashPayload({ kind, rows, totals });
      return NextResponse.json({ ok: true, kind, title: "Stock Ledger", rows, transfers, totals, hash, generatedAt: new Date().toISOString() });
    }

    if (kind === "mpesa-recon") {
      const stmt = await db.bankStatementLine.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }] });
      const mpesaSales = await db.sale.findMany({
        where: { paymentMethod: { contains: "M-Pesa" } },
        orderBy: { createdAt: "desc" },
        take: 300,
        select: { receiptNo: true, total: true, paymentMethod: true, createdAt: true, staffName: true },
      });
      const matched = stmt.filter((s) => s.matched);
      const unmatched = stmt.filter((s) => !s.matched);
      const rows = {
        statement: stmt.map((s) => ({
          date: s.date, till: s.till, ref: s.ref, description: s.description,
          amount: r2(s.amount), matched: s.matched, matchRef: s.matchRef,
        })),
        sales: mpesaSales.map((s) => ({
          receiptNo: s.receiptNo, total: r2(s.total), method: s.paymentMethod,
          createdAt: s.createdAt, staffName: s.staffName,
        })),
      };
      const totals = {
        statementIn: r2(stmt.filter((s) => s.amount > 0).reduce((s, r) => s + r.amount, 0)),
        statementOut: r2(stmt.filter((s) => s.amount < 0).reduce((s, r) => s + r.amount, 0)),
        matchedCount: matched.length,
        unmatchedCount: unmatched.length,
        systemMpesa: r2(mpesaSales.reduce((s, r) => s + r.total, 0)),
      };
      const hash = hashPayload({ kind, rows, totals });
      return NextResponse.json({ ok: true, kind, title: "M-Pesa Reconciliation", rows, totals, hash, generatedAt: new Date().toISOString() });
    }

    return NextResponse.json({ ok: false, error: `Unknown kind ${kind}` }, { status: 400 });
  } catch (err) {
    console.error("financial report", kind, err);
    return NextResponse.json({ ok: false, error: "Report failed" }, { status: 500 });
  }
}
