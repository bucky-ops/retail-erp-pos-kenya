"use client";

import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronDown,
  FileText,
  HandCoins,
  Landmark,
  Link2,
  ListTree,
  Lock,
  PackageMinus,
  Printer,
  RefreshCw,
  Scale,
  ShoppingCart,
  Smartphone,
  TrendingUp,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { KES, SaleDto } from "@/types";
import { ScreenHeader, KpiCard, Panel, EmptyState, TableSkeleton } from "@/components/df/shared";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { canSeeMargin } from "@/lib/roles";
import {
  ReceiptDocData,
  ReceiptLine,
  ReceiptTotalsRow,
  exportCsv,
  fmtDate as fmtDateTime,
  hashPayload,
  kes,
} from "@/lib/receipt";
import { ReceiptDocument } from "@/components/df/receipt-document";
import { printReceiptDocs } from "@/services/receiptService";
import {
  CompanyProfile,
  ReportPrint,
  ReportTable,
  ReportToolbar,
  printReportStandalone,
  useCompanyProfile,
} from "@/components/df/report-print";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";

/* == contracts (mirror of /api/accounting payload) ========================== */

interface AccountDTO {
  id: number;
  code: string;
  name: string;
  type: string;
  parent: string | null;
  isGroup: boolean;
  balance: number;
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

interface StmtLine {
  id: number;
  date: string;
  till: string;
  ref: string;
  description: string;
  amount: number;
  matched: boolean;
  matchRef: string;
}

interface AccPayload {
  month: string;
  today: string;
  coa: AccountDTO[];
  journals: JournalDTO[];
  dailySalesJournals: JournalDTO[];
  trialBalance: TBRow[];
  tbTotals: { debit: number; credit: number };
  tbAutoBalanced: boolean;
  tbAdjustment: number;
  pnl: {
    revenue: PnlLine[];
    cogs: PnlLine[];
    expenses: PnlLine[];
    netSales: number;
    totalCogs: number;
    grossProfit: number;
    grossMarginPct: number;
    totalExpenses: number;
    netProfit: number;
    prevMonthNetProfit: number;
    trendPct: number;
    prev: { netSales: number; totalCogs: number; grossProfit: number; grossMarginPct: number; totalExpenses: number; netProfit: number };
  };
  balanceSheet: {
    assets: PnlLine[];
    liabilities: PnlLine[];
    equity: PnlLine[];
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    bsAutoBalanced: boolean;
  };
  stockValuation: {
    total: number;
    skuCount: number;
    method: string;
    lines: { product: string; sku: string; qty: number; cost: number; value: number }[];
    movement: { in: number; out: number; cogs: number };
  };
  bankRecon: {
    statement: StmtLine[];
    summary: { matched: number; unmatched: number; matchedAmount: number; unmatchedAmount: number; matchPct: number; statementTotal: number };
  };
  stores: { id: number; name: string }[];
  ledgerCash: number;
}

/* -- financial report contracts (/api/reports/financial) -------------------- */

type FinKind = "general-ledger" | "debtors-ledger" | "creditors-ledger" | "stock-ledger" | "mpesa-recon";

interface FinResp {
  ok: boolean;
  kind: string;
  title: string;
  rows: unknown[];
  totals: Record<string, number>;
  hash: string;
  generatedAt: string;
}

interface FinGlRow {
  date: string;
  jvNo: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  memo: string;
  refNo: string;
}

interface FinDebtorRow {
  customerId: number;
  name: string;
  phone: string;
  tier: string;
  debtBalance: number;
  ledgerOutstanding: number;
  creditLimit: number;
  plans: { invoiceNo: string; totalDebt: number; paid: number; outstanding: number; status: string; overdueDays: number }[];
}

interface FinCreditorRow {
  supplierId: number;
  name: string;
  contact: string;
  phone: string;
  category: string;
  totalOrdered: number;
  payable: number;
  openOrders: number;
}

interface FinStockRow {
  store: string;
  sku: string;
  name: string;
  category: string;
  qty: number;
  unit: string;
  reorderPoint: number;
  value: number;
  low: boolean;
}

interface FinMpesaStmtRow {
  date: string;
  till: string;
  ref: string;
  description: string;
  amount: number;
  matched: boolean;
  matchRef: string;
}

interface FinMpesaSaleRow {
  receiptNo: string;
  total: number;
  method: string;
  createdAt: string;
  staffName: string;
}

interface FinMatrix {
  cols: string[];
  rows: (string | number)[][];
  foot?: (string | number)[];
  extra?: { heading: string; cols: string[]; rows: (string | number)[][] };
  summary?: (string | number)[][];
}

/* -- document source contracts (existing endpoints only) -------------------- */

interface POListItem {
  id: number;
  poNo: string;
  status: string;
  total: number;
  note: string;
  orderedAt: string;
  storeName: string;
  supplierName: string;
  items: { id: number; qty: number; unitCost: number; product: { name: string; sku: string; unit: string } }[];
}

interface ExpListItem {
  id: number;
  storeName: string;
  category: string;
  note: string;
  amount: number;
  paidVia: string;
  refNo: string | null;
  staffName: string;
  spentAt: string;
}

interface PayrollRow {
  id: number;
  employeeId: number;
  employeeName: string;
  idNo: string;
  dept: string;
  role: string;
  period: string;
  basic: number;
  houseAllowance: number;
  transport: number;
  overtime: number;
  gross: number;
  nssf: number;
  shif: number;
  housingLevy: number;
  paye: number;
  helb: number;
  net: number;
  status: string;
}

interface DebtPlanRow {
  id: number;
  customerName: string;
  customerPhone: string;
  invoiceNo: string | null;
  totalDebt: number;
  installmentType: string;
  installmentAmount: number;
  nextDueDate: string;
  status: string;
  overdueDays: number;
}

interface StockTakeRow {
  id: number;
  stNo: string;
  status: string;
  category: string;
  startedBy: string;
  note: string;
  startedAt: string;
  store: { id: number; name: string } | null;
  totalItems: number;
  countedItems: number;
  varianceValue: number;
  shortage: number;
  surplus: number;
}

/* == helpers ================================================================ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
};

const fmtMonth = (m: string) => {
  const [y, mm] = m.split("-");
  return `${MONTHS[Number(mm) - 1] ?? mm} ${y}`;
};

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

const SCROLL = "max-h-[560px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#DFE1E6] [&::-webkit-scrollbar-track]:bg-transparent";

/** Type → chip colours + group left-border colour. */
const TYPE_STYLE: Record<string, { chip: string; border: string }> = {
  Asset: { chip: "bg-[#E8F5E9] text-[#1B7A2E]", border: "#00C853" },
  Liability: { chip: "bg-[#FFF8E1] text-[#B8860B]", border: "#FFAB00" },
  Equity: { chip: "bg-[#F4F5F7] text-[#172B4D]", border: "#172B4D" },
  Revenue: { chip: "bg-[#E9F2FF] text-[#0052CC]", border: "#0052CC" },
  COGS: { chip: "bg-[#FFF3E0] text-[#B25E00]", border: "#FF8B00" },
  Expense: { chip: "bg-[#FFEBEE] text-[#FF5630]", border: "#FF5630" },
};

function TypeChip({ type }: { type: string }) {
  const s = TYPE_STYLE[type] ?? { chip: "bg-[#F4F5F7] text-[#6B778C]", border: "#DFE1E6" };
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", s.chip)}>{type}</span>;
}

/** Journal source badge - DayClose blue, Manual gray, Payroll purple, Inventory amber. */
function SourceBadge({ source }: { source: string }) {
  const map: Record<string, string> = {
    DayClose: "bg-[#E9F2FF] text-[#0052CC]",
    Manual: "bg-[#F4F5F7] text-[#6B778C]",
    Payroll: "bg-[#EAE6FF] text-[#6554C0]",
    Inventory: "bg-[#FFF8E1] text-[#B8860B]",
  };
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", map[source] ?? map.Manual)}>{source}</span>;
}

/** Cached debit-positive balance rendered with Dr/Cr suffix. */
function DrCr({ balance }: { balance: number }) {
  return (
    <span className="tabular-nums">
      {balance >= 0 ? (
        <>
          {KES(balance)} <span className="text-[10px] font-bold text-[#1B7A2E]">Dr</span>
        </>
      ) : (
        <>
          {KES(-balance)} <span className="text-[10px] font-bold text-[#FF5630]">Cr</span>
        </>
      )}
    </span>
  );
}

/** Right-aligned money cell; zero renders as a dash. */
function Money({ v, className }: { v: number; className?: string }) {
  return (
    <span className={cn("tabular-nums", v === 0 && "text-[#C1C7D0]", className)}>{v === 0 ? "-" : KES(v)}</span>
  );
}

/** Management-only lock card for margin statements (P&L / Balance Sheet). */
function ManagementLock({ what }: { what: string }) {
  return (
    <Panel>
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F4F5F7] text-[#6B778C]">
          <Lock className="h-6 w-6" />
        </div>
        <div>
          <p className="font-display text-[15px] font-bold text-[#172B4D]">Management only</p>
          <p className="mx-auto mt-1 max-w-sm text-[12px] text-[#6B778C]">
            {what} is restricted to Owner, Manager and Accountant roles. Ask an owner or manager to open this report.
          </p>
        </div>
      </div>
    </Panel>
  );
}

/* == receipt document builders (Print buttons) ============================== */

function docCommon(profile: CompanyProfile) {
  return {
    company: profile.companyName,
    logoUrl: profile.logoUrl,
    storeAddress: profile.companyAddress,
    storePhone: profile.companyPhone,
    tillNo: profile.tillNo,
    kraPin: profile.kraPin,
    footerMessage: profile.receiptFooterMessage,
  };
}

function journalDoc(j: JournalDTO, profile: CompanyProfile, userName: string, storeName?: string): ReceiptDocData {
  const diff = Math.round((j.totalDebit - j.totalCredit) * 100) / 100;
  const balanced = Math.abs(diff) < 0.01;
  const lines: ReceiptLine[] = j.lines.map((l, i) => {
    const amt = l.debit > 0 ? l.debit : l.credit;
    return {
      no: i + 1,
      name: `${l.accountCode} ${l.accountName}${l.memo ? ` - ${l.memo}` : ""}`,
      qty: 1,
      unit: "",
      unitPrice: amt,
      discount: 0,
      total: amt,
    };
  });
  return {
    kind: "JOURNAL",
    docNo: j.jvNo,
    date: fmtDate(j.date),
    servedBy: userName,
    storeName,
    ...docCommon(profile),
    lines,
    totals: [
      { label: "Total debit", value: kes(j.totalDebit) },
      { label: "Total credit", value: kes(j.totalCredit) },
    ],
    grandTotal: kes(j.totalDebit),
    extraBlocks: [
      {
        heading: "Entry details",
        rows: [
          { label: "Memo", value: j.memo || "-" },
          { label: "Source", value: j.source },
          { label: "Ref", value: j.refNo || "-" },
          { label: "Status", value: balanced ? "Balanced" : `Out by KES ${Math.abs(diff).toFixed(2)}` },
        ],
      },
    ],
    qrText: j.jvNo,
  };
}

function purchaseInvoiceDoc(po: POListItem, profile: CompanyProfile, userName: string): ReceiptDocData {
  const lines: ReceiptLine[] = po.items.map((it, i) => ({
    no: i + 1,
    name: `${it.product.name}${it.product.sku ? ` (${it.product.sku})` : ""}`,
    qty: it.qty,
    unit: it.product.unit || "pc",
    unitPrice: it.unitCost,
    discount: 0,
    total: Math.round(it.qty * it.unitCost * 100) / 100,
  }));
  return {
    kind: "PURCHASE_INVOICE",
    docNo: po.poNo,
    date: fmtDateTime(po.orderedAt),
    servedBy: userName,
    storeName: po.storeName,
    ...docCommon(profile),
    lines,
    totals: [{ label: "Lines", value: String(lines.length) }],
    grandTotal: kes(po.total),
    extraBlocks: [
      {
        heading: "Supplier & order",
        rows: [
          { label: "Supplier", value: po.supplierName },
          { label: "Status", value: po.status },
          { label: "Store", value: po.storeName },
          ...(po.note ? [{ label: "Note", value: po.note }] : []),
        ],
      },
    ],
    qrText: po.poNo,
  };
}

function salesInvoiceDoc(s: SaleDto, profile: CompanyProfile, userName: string): ReceiptDocData {
  const lines: ReceiptLine[] = s.items.map((it, i) => ({
    no: i + 1,
    name: it.name,
    qty: it.qty,
    unit: "pc",
    unitPrice: it.unitPrice,
    discount: it.discount,
    total: it.total,
  }));
  return {
    kind: "INVOICE",
    docNo: s.receiptNo,
    date: fmtDateTime(s.createdAt),
    servedBy: s.staffName || userName,
    customerName: s.customerName ?? "Walk-in customer",
    storeName: s.storeName,
    cuInvoiceNumber: s.cuInvoiceNumber ?? undefined,
    etimsEnabled: s.kraStatus === "Verified",
    ...docCommon(profile),
    lines,
    totals: [
      { label: "Subtotal", value: kes(s.subtotal) },
      ...(s.discount ? [{ label: "Discount", value: `- ${kes(s.discount)}` }] : []),
      { label: "VAT 16%", value: kes(s.vat) },
    ],
    grandTotal: kes(s.total),
    paymentLines: [{ method: s.paymentMethod, amount: kes(s.total) }],
    qrText: s.receiptNo,
  };
}

function expenseClaimDoc(e: ExpListItem, profile: CompanyProfile, userName: string): ReceiptDocData {
  return {
    kind: "EXPENSE_CLAIM",
    docNo: e.refNo || `EXP-${String(e.id).padStart(4, "0")}`,
    date: fmtDateTime(e.spentAt),
    servedBy: e.staffName || userName,
    storeName: e.storeName,
    ...docCommon(profile),
    lines: [
      {
        no: 1,
        name: `${e.category}${e.note ? ` - ${e.note}` : ""}`,
        qty: 1,
        unit: "",
        unitPrice: e.amount,
        discount: 0,
        total: e.amount,
      },
    ],
    totals: [
      { label: "Paid via", value: e.paidVia },
      { label: "Claimed by", value: e.staffName || "-" },
    ],
    grandTotal: kes(e.amount),
    extraBlocks: [
      {
        heading: "Claim details",
        rows: [
          { label: "Category", value: e.category },
          { label: "Store", value: e.storeName },
          { label: "Ref", value: e.refNo || "-" },
        ],
      },
    ],
    qrText: `EXP-${String(e.id).padStart(4, "0")}`,
  };
}

function payslipDoc(r: PayrollRow, profile: CompanyProfile, userName: string): ReceiptDocData {
  const earnings: { name: string; amt: number }[] = [
    { name: "Basic salary", amt: r.basic },
    { name: "House allowance", amt: r.houseAllowance },
    { name: "Transport allowance", amt: r.transport },
    ...(r.overtime ? [{ name: "Overtime", amt: r.overtime }] : []),
  ];
  const lines: ReceiptLine[] = earnings.map((e, i) => ({
    no: i + 1,
    name: e.name,
    qty: 1,
    unit: "",
    unitPrice: e.amt,
    discount: 0,
    total: e.amt,
  }));
  const totals: ReceiptTotalsRow[] = [];
  const pushDed = (label: string, v: number) => {
    if (v > 0) totals.push({ label, value: `- ${kes(v)}` });
  };
  pushDed("NSSF", r.nssf);
  pushDed("SHIF", r.shif);
  pushDed("Housing levy", r.housingLevy);
  pushDed("PAYE", r.paye);
  pushDed("HELB", r.helb);
  totals.push({ label: "Gross pay", value: kes(r.gross), bold: true });
  return {
    kind: "PAYSLIP",
    docNo: `PS-${r.period}-${String(r.employeeId).padStart(3, "0")}`,
    date: fmtDateTime(new Date()),
    servedBy: userName,
    ...docCommon(profile),
    lines,
    totals,
    grandTotal: kes(r.net),
    extraBlocks: [
      {
        heading: "Employee",
        rows: [
          { label: "Name", value: r.employeeName },
          { label: "ID No", value: r.idNo || "-" },
          { label: "Department", value: r.dept || "-" },
          { label: "Period", value: r.period },
          { label: "Status", value: r.status },
        ],
      },
    ],
    qrText: `PS-${r.period}-${String(r.employeeId).padStart(3, "0")}`,
  };
}

function paymentEntryDoc(p: DebtPlanRow, profile: CompanyProfile, userName: string): ReceiptDocData {
  const docNo = p.invoiceNo ?? `PLAN-${String(p.id).padStart(4, "0")}`;
  return {
    kind: "PAYMENT_ENTRY",
    docNo,
    date: fmtDateTime(new Date()),
    servedBy: userName,
    customerName: p.customerName,
    ...docCommon(profile),
    lines: [
      {
        no: 1,
        name: `Debt repayment - ${p.installmentType.toLowerCase()} installment`,
        qty: 1,
        unit: "",
        unitPrice: p.installmentAmount,
        discount: 0,
        total: p.installmentAmount,
      },
    ],
    totals: [
      { label: "Plan total debt", value: kes(p.totalDebt) },
      { label: "Next due", value: fmtDate(p.nextDueDate.slice(0, 10)) },
      { label: "Overdue days", value: String(p.overdueDays) },
    ],
    grandTotal: kes(p.installmentAmount),
    extraBlocks: [
      {
        heading: "Payment entry",
        rows: [
          { label: "Customer", value: p.customerName },
          { label: "Phone", value: p.customerPhone || "-" },
          { label: "Plan status", value: p.status },
        ],
      },
    ],
    qrText: docNo,
  };
}

function stockEntryDoc(t: StockTakeRow, profile: CompanyProfile, userName: string): ReceiptDocData {
  return {
    kind: "STOCK_ENTRY",
    docNo: t.stNo,
    date: fmtDateTime(t.startedAt),
    servedBy: t.startedBy || userName,
    storeName: t.store?.name,
    ...docCommon(profile),
    lines: [
      {
        no: 1,
        name: `Cycle count - ${t.category} (${t.countedItems}/${t.totalItems} counted)`,
        qty: t.totalItems,
        unit: "items",
        unitPrice: t.totalItems ? Math.round((t.varianceValue / t.totalItems) * 100) / 100 : 0,
        discount: 0,
        total: t.varianceValue,
      },
    ],
    totals: [
      { label: "Shortage lines", value: String(t.shortage) },
      { label: "Surplus lines", value: String(t.surplus) },
      { label: "Variance value", value: kes(t.varianceValue), bold: true },
    ],
    grandTotal: kes(t.varianceValue),
    extraBlocks: [
      {
        heading: "Count details",
        rows: [
          { label: "Status", value: t.status },
          { label: "Started by", value: t.startedBy },
          { label: "Scope", value: t.category },
          ...(t.note ? [{ label: "Note", value: t.note }] : []),
        ],
      },
    ],
    qrText: t.stNo,
  };
}

/* == Chart of Accounts tab ================================================== */

function CoaTab({ coa }: { coa: AccountDTO[] }) {
  const [closed, setClosed] = useState<Set<string>>(new Set()); // collapsed groups
  const groups = useMemo(() => coa.filter((a) => a.isGroup), [coa]);
  const childrenOf = useCallback((code: string) => coa.filter((a) => a.parent === code), [coa]);

  const toggle = (code: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <Panel padding={false}>
      <div className={cn("p-4 md:p-6", SCROLL)}>
        <div className="mb-3 flex items-center gap-2 text-[12px] text-[#6B778C]">
          <ListTree className="h-4 w-4" />
          {coa.filter((a) => !a.isGroup).length} posting accounts in {groups.length} groups - tap a group to fold
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[560px] space-y-1">
            {groups.map((g) => {
              const kids = childrenOf(g.code);
              const open = !closed.has(g.code);
              const s = TYPE_STYLE[g.type] ?? { border: "#DFE1E6" };
              return (
                <div key={g.code}>
                  <button
                    onClick={() => toggle(g.code)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 rounded-lg border-l-4 py-2 pl-2 pr-3 text-left transition-colors hover:bg-[#F4F5F7]"
                    style={{ borderColor: s.border }}
                  >
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-[#6B778C] transition-transform", !open && "-rotate-90")} />
                    <span className="font-mono text-[12px] font-semibold text-[#6B778C]">{g.code}</span>
                    <span className="text-[13px] font-bold uppercase tracking-wide text-[#172B4D]">{g.name}</span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-[11px] text-[#6B778C]">{kids.length} accounts</span>
                      <TypeChip type={g.type} />
                    </span>
                  </button>
                  {open && (
                    <div className="ml-5 border-l border-dashed border-[#DFE1E6] pl-3">
                      {kids.map((a) => (
                        <div key={a.code} className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-[#F4F5F7]/70">
                          <span className="w-10 font-mono text-[12px] text-[#6B778C]">{a.code}</span>
                          <span className="text-[13px] text-[#172B4D]">{a.name}</span>
                          <TypeChip type={a.type} />
                          <span className="ml-auto text-[12px] font-semibold text-[#172B4D]">
                            <DrCr balance={a.balance} />
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* == Journal card (shared by GL + Daily Sales Journals) ===================== */

function JournalCard({
  j,
  open,
  onToggle,
  storeName,
  onPrint,
}: {
  j: JournalDTO;
  open: boolean;
  onToggle: (id: number) => void;
  storeName?: string;
  onPrint?: (j: JournalDTO) => void;
}) {
  const diff = Math.round((j.totalDebit - j.totalCredit) * 100) / 100;
  const balanced = Math.abs(diff) < 0.01;
  return (
    <Collapsible open={open} onOpenChange={() => onToggle(j.id)}>
      <div className="overflow-hidden rounded-2xl border border-[#DFE1E6] bg-white shadow-sm transition-shadow hover:shadow-md">
        <div className="flex w-full items-stretch">
          <CollapsibleTrigger asChild>
            <button className="flex flex-1 flex-wrap items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-[#F4F5F7]/60">
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-[#6B778C] transition-transform", open && "rotate-180")} />
              <span className="font-mono text-[13px] font-bold text-[#172B4D]">{j.jvNo}</span>
              <SourceBadge source={j.source} />
              <span className="text-[12px] text-[#6B778C]">{fmtDate(j.date)}</span>
              {storeName && <span className="hidden text-[11px] text-[#6B778C] sm:inline">• {storeName}</span>}
              <span className="ml-auto flex items-center gap-2 text-[11px] tabular-nums text-[#6B778C]">
                Dr {KES(j.totalDebit, true)} / Cr {KES(j.totalCredit, true)}
                {!balanced && <span className="rounded-full bg-[#FFEBEE] px-2 py-0.5 font-bold text-[#FF5630]">Out {KES(Math.abs(diff))}</span>}
              </span>
            </button>
          </CollapsibleTrigger>
          {onPrint ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onPrint(j)}
              aria-label={`Print ${j.jvNo}`}
              title={`Print ${j.jvNo}`}
              className="mr-2 h-8 w-8 shrink-0 self-center text-[#0052CC] hover:bg-[#E9F2FF] hover:text-[#0052CC]"
            >
              <Printer className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        <CollapsibleContent>
          <div className="border-t border-[#DFE1E6] px-4 pb-4 pt-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-medium text-[#172B4D]">{j.memo}</p>
              {j.refNo && <Badge variant="outline" className="border-[#DFE1E6] font-mono text-[10px] text-[#6B778C]">{j.refNo}</Badge>}
              {onPrint && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-7 border-[#C9CFDA] px-2 text-[11px] font-bold text-[#0052CC] hover:bg-[#E9F2FF] hover:text-[#0052CC]"
                  onClick={() => onPrint(j)}
                >
                  <Printer className="h-3 w-3" /> Print JV
                </Button>
              )}
            </div>
            <div className="overflow-x-auto rounded-xl border border-[#DFE1E6]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#F4F5F7]/70">
                    <TableHead className="h-8 text-[11px]">Account</TableHead>
                    <TableHead className="h-8 text-right text-[11px]">Debit</TableHead>
                    <TableHead className="h-8 text-right text-[11px]">Credit</TableHead>
                    <TableHead className="h-8 text-[11px]">Memo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {j.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="py-1.5 text-[12px]">
                        <span className="font-mono text-[11px] text-[#6B778C]">{l.accountCode}</span> - {l.accountName}
                      </TableCell>
                      <TableCell className="py-1.5 text-right text-[12px]">
                        <Money v={l.debit} className="font-medium text-[#172B4D]" />
                      </TableCell>
                      <TableCell className="py-1.5 text-right text-[12px]">
                        <Money v={l.credit} className="font-medium text-[#172B4D]" />
                      </TableCell>
                      <TableCell className="py-1.5 text-[11px] text-[#6B778C]">{l.memo || "-"}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-[#DFE1E6] bg-[#F4F5F7]/50">
                    <TableCell className="py-2 text-[12px] font-bold text-[#172B4D]">Totals</TableCell>
                    <TableCell className="py-2 text-right text-[12px] font-bold tabular-nums text-[#172B4D]">{KES(j.totalDebit)}</TableCell>
                    <TableCell className="py-2 text-right text-[12px] font-bold tabular-nums text-[#172B4D]">{KES(j.totalCredit)}</TableCell>
                    <TableCell className="py-2">
                      {balanced ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[10px] font-bold text-[#1B7A2E]">
                          <CheckCircle2 className="h-3 w-3" /> Balanced
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#FFEBEE] px-2 py-0.5 text-[10px] font-bold text-[#FF5630]">
                          <XCircle className="h-3 w-3" /> Diff {KES(Math.abs(diff))}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/* == General Ledger tab ===================================================== */

function GeneralLedgerTab({
  journals,
  stores,
  onPrint,
}: {
  journals: JournalDTO[];
  stores: { id: number; name: string }[];
  onPrint?: (j: JournalDTO) => void;
}) {
  const [storeFilter, setStoreFilter] = useState("all");
  const [open, setOpen] = useState<Set<number>>(new Set());

  const filtered = useMemo(
    () => (storeFilter === "all" ? journals : journals.filter((j) => String(j.storeId) === storeFilter)),
    [journals, storeFilter]
  );
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const storeName = (id: number | null) => stores.find((s) => s.id === id)?.name;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={storeFilter} onValueChange={setStoreFilter}>
          <SelectTrigger className="w-[190px] bg-white" aria-label="Filter by store">
            <SelectValue placeholder="All stores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stores</SelectItem>
            {stores.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[12px] text-[#6B778C]">
          {filtered.length} entr{filtered.length === 1 ? "y" : "ies"} • latest 20 posted journals
        </span>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={<BookOpen className="h-5 w-5" />} title="No journal entries" sub="No journals match this store filter yet." />
      ) : (
        <div className={cn("space-y-2 pr-1", SCROLL)}>
          {filtered.map((j) => (
            <JournalCard key={j.id} j={j} open={open.has(j.id)} onToggle={toggle} storeName={storeName(j.storeId)} onPrint={onPrint} />
          ))}
        </div>
      )}
    </div>
  );
}

/* == Daily Sales Journals tab =============================================== */

function DailyJournalsTab({
  entries,
  today,
  stores,
  onPrint,
}: {
  entries: JournalDTO[];
  today: string;
  stores: { id: number; name: string }[];
  onPrint?: (j: JournalDTO) => void;
}) {
  const [open, setOpen] = useState<Set<number>>(new Set(entries.map((e) => e.id)));
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const totalDr = entries.reduce((t, j) => t + j.totalDebit, 0);
  const totalCr = entries.reduce((t, j) => t + j.totalCredit, 0);
  const hasToday = entries.some((j) => j.date === today);
  const storeName = (id: number | null) => stores.find((s) => s.id === id)?.name;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#E9F2FF] px-4 py-3 text-[13px] font-medium text-[#0052CC]">
        <Zap className="h-4 w-4 shrink-0" />
        <span>Auto-posted from Z reports - every Day Close writes a balanced sales journal.</span>
        <span className="ml-auto tabular-nums">
          Total Dr {KES(totalDr, true)} • Cr {KES(totalCr, true)}
        </span>
      </div>
      {!hasToday && (
        <Alert className="border-[#FFD591] bg-[#FFF8E1] text-[#172B4D]">
          <AlertTriangle className="h-4 w-4 !text-[#B8860B]" />
          <AlertTitle>Today not closed yet - no journal for today</AlertTitle>
          <AlertDescription className="text-[#6B778C]">
            Run the Day Close workflow to freeze today&apos;s Z report and auto-post its sales journal (Z report → JV).
          </AlertDescription>
        </Alert>
      )}
      {entries.length === 0 ? (
        <EmptyState icon={<Zap className="h-5 w-5" />} title="No Day Close journals yet" sub="Journals appear here automatically after each day is closed." />
      ) : (
        <div className={cn("space-y-2 pr-1", SCROLL)}>
          {entries.map((j) => (
            <JournalCard key={j.id} j={j} open={open.has(j.id)} onToggle={toggle} storeName={storeName(j.storeId)} onPrint={onPrint} />
          ))}
        </div>
      )}
    </div>
  );
}

/* == Stock Accounts tab ===================================================== */

function StockAccountsTab({ stock }: { stock: AccPayload["stockValuation"] }) {
  const kpis = [
    { icon: <Boxes className="h-4 w-4" />, label: "Inventory on hand (FIFO)", value: KES(stock.total), sub: `${stock.skuCount} SKUs counted`, bg: "#FFF8E1", fg: "#B8860B" },
    { icon: <PackageMinus className="h-4 w-4" />, label: "COGS this month (5100 Purchases)", value: KES(stock.movement.cogs), sub: "Posted from day-close journals", bg: "#FFF3E0", fg: "#B25E00" },
    { icon: <ArrowUpFromLine className="h-4 w-4" />, label: "Stock out this period (1200 credits)", value: KES(stock.movement.out), sub: "Matched by COGS postings", bg: "#FFEBEE", fg: "#FF5630" },
  ];
  const movement = [
    { icon: <ArrowDownToLine className="h-3.5 w-3.5 text-[#1B7A2E]" />, label: "Stock In - Inventory debits (1200)", amount: stock.movement.in, color: "text-[#1B7A2E]" },
    { icon: <ArrowUpFromLine className="h-3.5 w-3.5 text-[#FF5630]" />, label: "Stock Out - Inventory credits (1200)", amount: stock.movement.out, color: "text-[#FF5630]" },
    { icon: <PackageMinus className="h-3.5 w-3.5 text-[#B25E00]" />, label: "COGS - Purchases debits (5100)", amount: stock.movement.cogs, color: "text-[#B25E00]" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {kpis.map((k) => (
          <KpiCard key={k.label} icon={k.icon} label={k.label} value={k.value} sub={k.sub} iconBg={k.bg} iconColor={k.fg} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" padding={false}>
          <div className="flex flex-wrap items-center gap-2 px-4 pt-4 md:px-6 md:pt-6">
            <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Top products by value</h3>
            <Badge className="bg-[#E9F2FF] text-[#0052CC] hover:bg-[#E9F2FF]">Method: {stock.method}</Badge>
            <span className="ml-auto text-[11px] text-[#6B778C]">top 12 of {stock.skuCount}</span>
          </div>
          <div className={cn("mt-3 px-4 pb-4 md:px-6 md:pb-6", SCROLL)}>
            <div className="overflow-x-auto rounded-xl border border-[#DFE1E6]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#F4F5F7]/70">
                    <TableHead className="h-8 text-[11px]">Product</TableHead>
                    <TableHead className="h-8 text-[11px]">SKU</TableHead>
                    <TableHead className="h-8 text-right text-[11px]">Qty</TableHead>
                    <TableHead className="h-8 text-right text-[11px]">Unit cost</TableHead>
                    <TableHead className="h-8 text-right text-[11px]">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stock.lines.map((l) => (
                    <TableRow key={l.sku}>
                      <TableCell className="py-1.5 text-[12px] font-medium text-[#172B4D]">{l.product}</TableCell>
                      <TableCell className="py-1.5 font-mono text-[11px] text-[#6B778C]">{l.sku}</TableCell>
                      <TableCell className="py-1.5 text-right text-[12px] tabular-nums">{l.qty.toLocaleString("en-KE")}</TableCell>
                      <TableCell className="py-1.5 text-right text-[12px] tabular-nums text-[#6B778C]">{KES(l.cost)}</TableCell>
                      <TableCell className="py-1.5 text-right text-[12px] font-semibold tabular-nums text-[#172B4D]">{KES(l.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </Panel>
        <Panel>
          <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Stock movement</h3>
          <p className="mt-0.5 text-[11px] text-[#6B778C]">Derived from journal lines on 1200 / 5100</p>
          <div className="mt-3 space-y-2">
            {movement.map((m) => (
              <div key={m.label} className="flex items-center gap-2 rounded-xl border border-[#DFE1E6] bg-[#F4F5F7]/50 px-3 py-2.5">
                {m.icon}
                <div className="min-w-0">
                  <p className="truncate text-[11px] text-[#6B778C]">{m.label}</p>
                  <p className={cn("text-[14px] font-bold tabular-nums", m.color)}>{KES(m.amount)}</p>
                </div>
              </div>
            ))}
          </div>
          <Separator className="my-3" />
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-[#6B778C]">Net into inventory</span>
            <span className="font-bold tabular-nums text-[#172B4D]">{KES(stock.movement.in - stock.movement.out)}</span>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* == Trial Balance tab (with print + export) ================================ */

function TrialBalanceTab({
  rows,
  totals,
  autoBalanced,
  adjustment,
  today,
}: {
  rows: TBRow[];
  totals: { debit: number; credit: number };
  autoBalanced: boolean;
  adjustment: number;
  today: string;
}) {
  const profile = useCompanyProfile();
  const userName = useApp((s) => s.user?.name);
  const [printOpen, setPrintOpen] = useState(false);
  const balanced = Math.abs(totals.debit - totals.credit) < 0.01;
  const diff = Math.round((totals.debit - totals.credit) * 100) / 100;
  const hash = useMemo(() => hashPayload({ kind: "trial-balance", rows, totals }), [rows, totals]);

  const doPrint = () => {
    setPrintOpen(true);
    void printReportStandalone("a4");
  };

  const doExport = () => {
    exportCsv(
      "trial-balance",
      [
        ["Code", "Account", "Type", "Debit (KES)", "Credit (KES)"],
        ...rows.map((r) => [r.code, r.name, r.type, r.debit, r.credit]),
        ["", "Totals", "", totals.debit, totals.credit],
      ],
      "Trial Balance"
    );
    toast({ title: "Export ready", description: "Trial balance saved as CSV - opens in Excel." });
  };

  const printRows: (string | number)[][] = rows.map((r) => [r.code, r.name, r.type, r.debit, r.credit]);

  return (
    <Panel padding={false}>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 md:px-6 md:pt-6">
        <Scale className="h-4 w-4 text-[#0052CC]" />
        <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Trial Balance</h3>
        <span className="text-[12px] text-[#6B778C]">As of {fmtDate(today)}</span>
        {balanced ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F5E9] px-2.5 py-1 text-[11px] font-bold text-[#1B7A2E]">
            <CheckCircle2 className="h-3.5 w-3.5" /> Balanced ✓
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#FFEBEE] px-2.5 py-1 text-[11px] font-bold text-[#FF5630]">
            <XCircle className="h-3.5 w-3.5" /> Out by {KES(Math.abs(diff))}
          </span>
        )}
      </div>
      <div className="px-4 pt-3 md:px-6">
        <ReportToolbar hash={hash} onPrint={doPrint} onExport={doExport}>
          <span className="text-[11px] text-[#6B778C]">{rows.length} posting accounts</span>
        </ReportToolbar>
      </div>
      {autoBalanced && (
        <div className="mx-4 mt-3 rounded-xl border border-[#FFD591] bg-[#FFF8E1] px-3 py-2 text-[12px] text-[#8B6D00] md:mx-6">
          Auto-balanced - difference of {KES(Math.abs(adjustment))} posted to Retained Earnings (3200).
        </div>
      )}
      <div className={cn("mt-3 px-4 pb-4 md:px-6 md:pb-6", SCROLL)}>
        <div className="overflow-x-auto rounded-xl border border-[#DFE1E6]">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F4F5F7]/70">
                <TableHead className="h-8 text-[11px]">Code</TableHead>
                <TableHead className="h-8 text-[11px]">Account</TableHead>
                <TableHead className="h-8 text-[11px]">Type</TableHead>
                <TableHead className="h-8 text-right text-[11px]">Debit</TableHead>
                <TableHead className="h-8 text-right text-[11px]">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.code}>
                  <TableCell className="py-1.5 font-mono text-[12px] text-[#6B778C]">{r.code}</TableCell>
                  <TableCell className="py-1.5 text-[12px] font-medium text-[#172B4D]">{r.name}</TableCell>
                  <TableCell className="py-1.5">
                    <TypeChip type={r.type} />
                  </TableCell>
                  <TableCell className="py-1.5 text-right text-[12px]">
                    <Money v={r.debit} />
                  </TableCell>
                  <TableCell className="py-1.5 text-right text-[12px]">
                    <Money v={r.credit} />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-[#DFE1E6] bg-[#F4F5F7]">
                <TableCell colSpan={3} className="py-2.5 text-[12px] font-bold uppercase tracking-wide text-[#172B4D]">
                  Totals
                </TableCell>
                <TableCell className="py-2.5 text-right text-[13px] font-bold tabular-nums text-[#172B4D]">{KES(totals.debit)}</TableCell>
                <TableCell className="py-2.5 text-right text-[13px] font-bold tabular-nums text-[#172B4D]">{KES(totals.credit)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {printOpen && (
        <div className="hidden print:block">
          <ReportPrint
            title="Trial Balance"
            company={profile}
            generatedBy={userName ?? undefined}
            generatedAt={new Date()}
            filters={[`As of ${fmtDate(today)}`]}
            hash={hash}
          >
            <ReportTable
              head={["Code", "Account", "Type", "Debit (KES)", "Credit (KES)"]}
              rows={printRows}
              foot={["", "Totals", "", totals.debit, totals.credit]}
            />
            {autoBalanced ? (
              <p className="mt-2 text-[10px] text-[#6B778C]">
                Auto-balanced - difference of KES {Math.abs(adjustment).toFixed(2)} posted to Retained Earnings (3200).
              </p>
            ) : null}
          </ReportPrint>
        </div>
      )}
    </Panel>
  );
}

/* == Profit & Loss tab (with print + export) ================================ */

/** One labelled money line of the P&L statement (module level). */
function PnlRow({ label, value, bold, indent, tone }: { label: string; value: number; bold?: boolean; indent?: boolean; tone?: "green" | "red" }) {
  return (
    <div className={cn("flex items-center justify-between py-1.5", bold && "border-t border-[#DFE1E6] pt-2.5 font-bold text-[#172B4D]")}>
      <span className={cn("text-[13px]", indent && "pl-4 text-[12px] text-[#6B778C]", bold && "pl-0")}>{label}</span>
      <span className={cn("tabular-nums", bold ? "text-[14px]" : "text-[13px] text-[#172B4D]", tone === "green" && "text-[#1B7A2E]", tone === "red" && "text-[#FF5630]")}>{KES(value)}</span>
    </div>
  );
}

function PnlTab({ pnl, month }: { pnl: AccPayload["pnl"]; month: string }) {
  const profile = useCompanyProfile();
  const userName = useApp((s) => s.user?.name);
  const [printOpen, setPrintOpen] = useState(false);
  const [sel, setSel] = useState(month);
  const isCurrent = sel === month;
  const prevMonth = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, [month]);
  const s82 = (l: PnlLine): PnlLine => ({ ...l, amount: Math.round(l.amount * 0.82) });
  const view = isCurrent
    ? { revenue: pnl.revenue, cogs: pnl.cogs, expenses: pnl.expenses, netSales: pnl.netSales, totalCogs: pnl.totalCogs, grossProfit: pnl.grossProfit, grossMarginPct: pnl.grossMarginPct, totalExpenses: pnl.totalExpenses, netProfit: pnl.netProfit }
    : { revenue: pnl.revenue.map(s82), cogs: pnl.cogs.map(s82), expenses: pnl.expenses.map(s82), netSales: pnl.prev.netSales, totalCogs: pnl.prev.totalCogs, grossProfit: pnl.prev.grossProfit, grossMarginPct: pnl.prev.grossMarginPct, totalExpenses: pnl.prev.totalExpenses, netProfit: pnl.prev.netProfit };
  const maxExpense = Math.max(...view.expenses.map((e) => e.amount), 1);
  const bars = view.expenses.filter((e) => e.amount > 0);
  const trend = pnl.trendPct;

  const printRows: (string | number)[][] = [
    ...view.revenue.map((l) => [l.code, l.name, l.amount] as (string | number)[]),
    ["", "NET SALES", view.netSales],
    ...view.cogs.map((l) => [l.code, l.name, l.amount] as (string | number)[]),
    ["", "TOTAL COGS", view.totalCogs],
    ["", "GROSS PROFIT", view.grossProfit],
    ...view.expenses.map((l) => [l.code, l.name, l.amount] as (string | number)[]),
    ["", "TOTAL EXPENSES", view.totalExpenses],
  ];
  const printFilters = [
    `Period: ${fmtMonth(sel)}`,
    isCurrent ? "Basis: posted journals (actual)" : "Basis: estimated at 82% of current run-rate",
  ];
  const hash = hashPayload({ kind: "pnl", month: sel, rows: printRows, netProfit: view.netProfit });

  const doPrint = () => {
    setPrintOpen(true);
    void printReportStandalone("a4");
  };

  const doExport = () => {
    exportCsv(
      "profit-and-loss",
      [["Code", "Line", "Amount (KES)"], ...printRows, ["", "NET PROFIT", view.netProfit]],
      "Profit & Loss"
    );
    toast({ title: "Export ready", description: `P&L for ${fmtMonth(sel)} saved as CSV - opens in Excel.` });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={sel} onValueChange={setSel}>
          <SelectTrigger className="w-[170px] bg-white" aria-label="Statement month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={month}>{fmtMonth(month)}</SelectItem>
            <SelectItem value={prevMonth}>{fmtMonth(prevMonth)} (est.)</SelectItem>
          </SelectContent>
        </Select>
        {!isCurrent && <Badge className="bg-[#FFF8E1] text-[#B8860B] hover:bg-[#FFF8E1]">Estimated - 82% of Sep run-rate</Badge>}
      </div>
      <ReportToolbar hash={hash} onPrint={doPrint} onExport={doExport}>
        <span className="text-[12px] text-[#6B778C]">Statement month: {fmtMonth(sel)}</span>
      </ReportToolbar>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Panel className="lg:col-span-3">
          <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Profit &amp; Loss - {fmtMonth(sel)}</h3>
          <p className="text-[11px] text-[#6B778C]">Accrual statement from posted journals (VAT-exclusive)</p>
          <div className="mt-4 space-y-0.5">
            <p className="pt-1 text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Revenue</p>
            {view.revenue.map((l) => (
              <PnlRow key={l.code} label={`${l.code} ${l.name}`} value={l.amount} indent />
            ))}
            <PnlRow label="Net Sales" value={view.netSales} bold />
            <p className="pt-2 text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Cost of Goods Sold</p>
            {view.cogs.map((l) => (
              <PnlRow key={l.code} label={`${l.code} ${l.name}`} value={l.amount} indent />
            ))}
            <PnlRow label="Total COGS" value={view.totalCogs} bold />
            <div className="mt-2 flex items-center justify-between border-t-2 border-[#172B4D] py-2.5">
              <span className="text-[14px] font-bold text-[#172B4D]">Gross Profit</span>
              <span className="flex items-center gap-2">
                <span className="rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[10px] font-bold text-[#1B7A2E]">{view.grossMarginPct}% margin</span>
                <span className="text-[15px] font-bold tabular-nums text-[#172B4D]">{KES(view.grossProfit)}</span>
              </span>
            </div>
            <p className="pt-2 text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Operating Expenses</p>
            {view.expenses.map((l) => (
              <PnlRow key={l.code} label={`${l.code} ${l.name}`} value={l.amount} indent />
            ))}
            <PnlRow label="Total Expenses" value={view.totalExpenses} bold />
            <div className="mt-2 flex items-center justify-between border-t-2 border-[#172B4D] py-3">
              <span className="font-display text-[15px] font-bold text-[#172B4D]">Net Profit</span>
              <span className={cn("text-[18px] font-bold tabular-nums", view.netProfit >= 0 ? "text-[#1B7A2E]" : "text-[#FF5630]")}>{KES(view.netProfit)}</span>
            </div>
            {isCurrent ? (
              <div className="flex items-center gap-2 rounded-xl bg-[#F4F5F7] px-3 py-2 text-[12px]">
                <span className="text-[#6B778C]">vs {fmtMonth(prevMonth)}:</span>
                <span className={cn("inline-flex items-center gap-1 font-bold", trend >= 0 ? "text-[#1B7A2E]" : "text-[#FF5630]")}>
                  {trend >= 0 ? "▲" : "▼"} {trend >= 0 ? "+" : ""}
                  {trend.toFixed(1)}%
                </span>
                <span className="text-[11px] text-[#6B778C]">(Aug estimated at 82% of Sep)</span>
              </div>
            ) : (
              <p className="rounded-xl bg-[#F4F5F7] px-3 py-2 text-[12px] text-[#6B778C]">Approximate prior month - used for trend comparison only.</p>
            )}
          </div>
        </Panel>
        <Panel className="lg:col-span-2">
          <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Expense breakdown</h3>
          <p className="text-[11px] text-[#6B778C]">{fmtMonth(sel)} • share of max expense line</p>
          <div className="mt-4 space-y-3">
            {bars.length === 0 && <p className="text-[12px] text-[#6B778C]">No expenses posted for this period.</p>}
            {bars.map((e) => (
              <div key={e.code}>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="text-[#172B4D]">
                    <span className="font-mono text-[11px] text-[#6B778C]">{e.code}</span> {e.name}
                  </span>
                  <span className="font-semibold tabular-nums text-[#172B4D]">{KES(e.amount, true)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#F4F5F7]">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max((e.amount / maxExpense) * 100, 4)}%`, background: "#FF5630" }}
                  />
                </div>
              </div>
            ))}
          </div>
          <Separator className="my-4" />
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-[#6B778C]">Total expenses</span>
            <span className="font-bold tabular-nums text-[#172B4D]">{KES(view.totalExpenses)}</span>
          </div>
        </Panel>
      </div>

      {printOpen && (
        <div className="hidden print:block">
          <ReportPrint
            title={`Profit & Loss - ${fmtMonth(sel)}`}
            company={profile}
            generatedBy={userName ?? undefined}
            generatedAt={new Date()}
            filters={printFilters}
            hash={hash}
          >
            <ReportTable head={["Code", "Line", "Amount (KES)"]} rows={printRows} foot={["", "NET PROFIT", view.netProfit]} />
          </ReportPrint>
        </div>
      )}
    </div>
  );
}

/* == Balance Sheet tab (with print + export) ================================ */

/** A titled block of balance-sheet lines with a total footer (module level). */
function BsSection({ title, rows, total }: { title: string; rows: PnlLine[]; total: number }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">{title}</p>
      <div className="mt-1 space-y-0.5">
        {rows.map((l) => (
          <div key={l.code} className="flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors hover:bg-[#F4F5F7]/70">
            <span className="text-[13px] text-[#172B4D]">
              <span className="mr-2 font-mono text-[11px] text-[#6B778C]">{l.code}</span>
              {l.name}
            </span>
            <span className="text-[13px] tabular-nums text-[#172B4D]">{l.amount === 0 ? <span className="text-[#C1C7D0]">-</span> : KES(l.amount)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-[#DFE1E6] pt-2">
        <span className="text-[12px] font-bold uppercase tracking-wide text-[#6B778C]">Total {title}</span>
        <span className="text-[14px] font-bold tabular-nums text-[#172B4D]">{KES(total)}</span>
      </div>
    </div>
  );
}

function BalanceSheetTab({ bs }: { bs: AccPayload["balanceSheet"] }) {
  const profile = useCompanyProfile();
  const userName = useApp((s) => s.user?.name);
  const [printOpen, setPrintOpen] = useState(false);
  const le = Math.round((bs.totalLiabilities + bs.totalEquity) * 100) / 100;
  const balanced = Math.abs(bs.totalAssets - le) < 0.01;
  const CURRENT_CODES = new Set(["1010", "1020", "1030", "1100", "1300", "1400"]);
  const currentAssets = bs.assets.filter((a) => CURRENT_CODES.has(a.code)).reduce((t, a) => t + a.amount, 0);
  const hash = useMemo(
    () =>
      hashPayload({
        kind: "balance-sheet",
        assets: bs.assets,
        liabilities: bs.liabilities,
        equity: bs.equity,
        totals: [bs.totalAssets, bs.totalLiabilities, bs.totalEquity],
      }),
    [bs]
  );

  const doPrint = () => {
    setPrintOpen(true);
    void printReportStandalone("a4");
  };

  const doExport = () => {
    const sec = (label: string, lines: PnlLine[], total: number): (string | number)[][] => [
      [label],
      ["Code", "Account", "Amount (KES)"],
      ...lines.map((l) => [l.code, l.name, l.amount]),
      ["", `Total ${label.toLowerCase()}`, total],
      [],
    ];
    exportCsv(
      "balance-sheet",
      [
        ...sec("Assets", bs.assets, bs.totalAssets),
        ...sec("Liabilities", bs.liabilities, bs.totalLiabilities),
        ...sec("Equity", bs.equity, bs.totalEquity),
      ],
      "Balance Sheet"
    );
    toast({ title: "Export ready", description: "Balance sheet saved as CSV - opens in Excel." });
  };

  const bsTable = (label: string, rows: PnlLine[], total: number) => (
    <div className="mt-3">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">{label}</p>
      <ReportTable
        head={["Code", "Account", "Amount (KES)"]}
        rows={rows.map((l) => [l.code, l.name, l.amount])}
        foot={["", `Total ${label.toLowerCase()}`, total]}
      />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {balanced ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F5E9] px-3 py-1.5 text-[12px] font-bold text-[#1B7A2E]">
            <CheckCircle2 className="h-4 w-4" /> Balanced ✓ {KES(bs.totalAssets)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#FFEBEE] px-3 py-1.5 text-[12px] font-bold text-[#FF5630]">
            <XCircle className="h-4 w-4" /> Out by {KES(Math.abs(bs.totalAssets - le))}
          </span>
        )}
        {bs.bsAutoBalanced && (
          <span className="rounded-full border border-[#FFD591] bg-[#FFF8E1] px-3 py-1.5 text-[11px] font-semibold text-[#8B6D00]">
            Net result carried into Retained Earnings (3200) to balance
          </span>
        )}
      </div>
      <ReportToolbar hash={hash} onPrint={doPrint} onExport={doExport}>
        <span className="text-[12px] text-[#6B778C]">As at today - accrual basis from posted journals</span>
      </ReportToolbar>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <div className="mb-3 flex items-center gap-2">
            <Boxes className="h-4 w-4 text-[#00C853]" />
            <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Assets</h3>
          </div>
          <BsSection title="Assets" rows={bs.assets} total={bs.totalAssets} />
          <div className="mt-3 rounded-xl bg-[#E8F5E9]/60 px-3 py-2 text-[12px]">
            <span className="font-semibold text-[#1B7A2E]">Current assets: {KES(currentAssets)}</span>
            <span className="text-[#6B778C]"> - cash, tills, bank, debtors &amp; VAT input</span>
          </div>
        </Panel>
        <div className="space-y-4">
          <Panel>
            <div className="mb-3 flex items-center gap-2">
              <Landmark className="h-4 w-4 text-[#FFAB00]" />
              <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Liabilities</h3>
            </div>
            <BsSection title="Liabilities" rows={bs.liabilities} total={bs.totalLiabilities} />
          </Panel>
          <Panel>
            <div className="mb-3 flex items-center gap-2">
              <Scale className="h-4 w-4 text-[#172B4D]" />
              <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Equity</h3>
            </div>
            <BsSection title="Equity" rows={bs.equity} total={bs.totalEquity} />
          </Panel>
        </div>
      </div>

      {printOpen && (
        <div className="hidden print:block">
          <ReportPrint
            title="Balance Sheet"
            company={profile}
            generatedBy={userName ?? undefined}
            generatedAt={new Date()}
            filters={["Basis: accrual (posted journals)", "All accounts"]}
            hash={hash}
          >
            {bsTable("Assets", bs.assets, bs.totalAssets)}
            {bsTable("Liabilities", bs.liabilities, bs.totalLiabilities)}
            {bsTable("Equity", bs.equity, bs.totalEquity)}
          </ReportPrint>
        </div>
      )}
    </div>
  );
}

/* == Bank Reconciliation tab ================================================ */

function BankReconTab({ recon, ledgerCash }: { recon: AccPayload["bankRecon"]; ledgerCash: number }) {
  const [demo, setDemo] = useState<Record<number, boolean>>({});
  const rows = useMemo(
    () => recon.statement.map((s) => ({ ...s, effMatched: s.matched || !!demo[s.id], isDemo: !s.matched && !!demo[s.id] })),
    [recon.statement, demo]
  );
  const summary = useMemo(() => {
    const m = rows.filter((r) => r.effMatched);
    const u = rows.filter((r) => !r.effMatched);
    const amt = (list: typeof rows) => Math.round(list.reduce((t, r) => t + r.amount, 0) * 100) / 100;
    return {
      matched: m.length,
      unmatched: u.length,
      matchedAmount: amt(m),
      unmatchedAmount: amt(u),
      matchPct: rows.length ? Math.round((m.length / rows.length) * 1000) / 10 : 0,
      statementTotal: amt(rows),
    };
  }, [rows]);

  const matchLine = (r: (typeof rows)[number]) => {
    setDemo((d) => ({ ...d, [r.id]: true }));
    toast({ title: "Demo match", description: `${r.ref} marked matched to a journal - demo only, nothing is saved.` });
  };

  const diff = Math.round((ledgerCash - summary.statementTotal) * 100) / 100;
  const stats = [
    { label: "Match rate", value: `${summary.matchPct}%`, color: "text-[#0052CC]", bg: "#E9F2FF" },
    { label: "Matched", value: KES(summary.matchedAmount), color: "text-[#1B7A2E]", bg: "#E8F5E9" },
    { label: "Unmatched lines", value: String(summary.unmatched), color: "text-[#FF5630]", bg: "#FFEBEE" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-[#DFE1E6] bg-white p-4 shadow-sm" style={{ background: `linear-gradient(180deg, ${s.bg}33 0%, #ffffff 55%)` }}>
            <p className={cn("font-display text-lg font-bold tabular-nums", s.color)}>{s.value}</p>
            <p className="mt-0.5 text-[12px] text-[#6B778C]">{s.label}</p>
          </div>
        ))}
      </div>
      <Panel padding={false}>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-4 md:px-6 md:pt-6">
          <Landmark className="h-4 w-4 text-[#0052CC]" />
          <h3 className="font-display text-[15px] font-bold text-[#172B4D]">M-Pesa Till statement</h3>
          <span className="text-[11px] text-[#6B778C]">{recon.statement[0]?.till ?? "-"}</span>
          <span className="ml-auto text-[11px] text-[#6B778C]">newest first</span>
        </div>
        <div className={cn("mt-3 px-4 pb-4 md:px-6 md:pb-6", SCROLL)}>
          <div className="overflow-x-auto rounded-xl border border-[#DFE1E6]">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F4F5F7]/70">
                  <TableHead className="h-8 text-[11px]">Date</TableHead>
                  <TableHead className="h-8 text-[11px]">Ref</TableHead>
                  <TableHead className="h-8 text-[11px]">Description</TableHead>
                  <TableHead className="h-8 text-right text-[11px]">Amount</TableHead>
                  <TableHead className="h-8 text-[11px]">Status</TableHead>
                  <TableHead className="h-8 text-right text-[11px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="py-1.5 text-[12px] text-[#6B778C]">{fmtDate(r.date)}</TableCell>
                    <TableCell className="py-1.5 font-mono text-[11px] text-[#6B778C]">{r.ref}</TableCell>
                    <TableCell className="py-1.5 text-[12px] text-[#172B4D]">{r.description}</TableCell>
                    <TableCell className={cn("py-1.5 text-right text-[12px] font-semibold tabular-nums", r.amount >= 0 ? "text-[#1B7A2E]" : "text-[#FF5630]")}>
                      {r.amount >= 0 ? "+" : "−"}
                      {KES(Math.abs(r.amount))}
                    </TableCell>
                    <TableCell className="py-1.5">
                      {r.effMatched ? (
                        <span className="inline-flex flex-wrap items-center gap-1">
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[10px] font-bold text-[#1B7A2E]">
                            <CheckCircle2 className="h-3 w-3" /> Matched{r.isDemo ? " • demo" : ""}
                          </span>
                          {r.matchRef && <Badge className="bg-[#E9F2FF] font-mono text-[10px] text-[#0052CC] hover:bg-[#E9F2FF]">→ {r.matchRef}</Badge>}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#FFEBEE] px-2 py-0.5 text-[10px] font-bold text-[#FF5630]">
                          <XCircle className="h-3 w-3" /> Unmatched
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-1.5 text-right">
                      {!r.effMatched && (
                        <Button size="sm" variant="outline" className="h-7 border-[#C9CFDA] px-2 text-[11px] text-[#0052CC] hover:bg-[#E9F2FF] hover:text-[#0052CC]" onClick={() => matchLine(r)}>
                          <Link2 className="h-3 w-3" /> Match to journal
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </Panel>
      <Panel>
        <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Bank balance check</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[#DFE1E6] bg-[#F4F5F7]/50 px-3 py-2.5">
            <p className="text-[11px] text-[#6B778C]">Statement total</p>
            <p className="text-[14px] font-bold tabular-nums text-[#172B4D]">{KES(summary.statementTotal)}</p>
          </div>
          <div className="rounded-xl border border-[#DFE1E6] bg-[#F4F5F7]/50 px-3 py-2.5">
            <p className="text-[11px] text-[#6B778C]">Ledger cash - 1030 M-Pesa Till</p>
            <p className="text-[14px] font-bold tabular-nums text-[#172B4D]">{KES(ledgerCash)}</p>
          </div>
          <div className="rounded-xl border border-[#FFD591] bg-[#FFF8E1] px-3 py-2.5">
            <p className="text-[11px] text-[#8B6D00]">Difference</p>
            <p className="text-[14px] font-bold tabular-nums text-[#8B6D00]">{KES(Math.abs(diff))}</p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-[#6B778C]">
          Statement covers recent M-Pesa activity only; the ledger carries the full till history - opening float plus posted sales.
        </p>
      </Panel>
    </div>
  );
}

/* == Financial reports (/api/reports/financial) ============================= */

function finMatrix(kind: FinKind, resp: FinResp): FinMatrix {
  const t = resp.totals ?? {};
  if (kind === "general-ledger") {
    const rows = (resp.rows ?? []) as FinGlRow[];
    return {
      cols: ["Date", "JV No", "Account", "Debit (KES)", "Credit (KES)", "Memo"],
      rows: rows.map((r) => [r.date, r.jvNo, `${r.accountCode} ${r.accountName}`, r.debit, r.credit, r.memo || "-"]),
      foot: ["", "Totals", "", t.debit ?? 0, t.credit ?? 0, ""],
    };
  }
  if (kind === "debtors-ledger") {
    const rows = (resp.rows ?? []) as FinDebtorRow[];
    return {
      cols: ["Customer", "Phone", "Tier", "System debt (KES)", "Ledger outstanding (KES)", "Credit limit (KES)"],
      rows: rows.map((r) => [r.name, r.phone || "-", r.tier ?? "-", r.debtBalance, r.ledgerOutstanding, r.creditLimit]),
      foot: ["Totals", "", "", t.systemDebt ?? 0, t.ledgerOutstanding ?? 0, ""],
    };
  }
  if (kind === "creditors-ledger") {
    const rows = (resp.rows ?? []) as FinCreditorRow[];
    return {
      cols: ["Supplier", "Category", "Phone", "Total ordered (KES)", "Payable (KES)", "Open orders"],
      rows: rows.map((r) => [r.name, r.category ?? "-", r.phone || "-", r.totalOrdered, r.payable, r.openOrders]),
      foot: ["Totals", "", "", "", t.payable ?? 0, ""],
    };
  }
  if (kind === "stock-ledger") {
    const rows = (resp.rows ?? []) as FinStockRow[];
    return {
      cols: ["Store", "SKU", "Product", "Qty", "Unit", "Value (KES)", "Status"],
      rows: rows.map((r) => [r.store, r.sku, r.name, r.qty, r.unit, r.value, r.low ? "Low" : "OK"]),
      foot: ["Totals", "", "", "", "", t.totalValue ?? 0, `${t.lines ?? rows.length} lines`],
    };
  }
  // mpesa-recon
  const payload = (resp.rows ?? {}) as { statement?: FinMpesaStmtRow[]; sales?: FinMpesaSaleRow[] };
  const stmt = payload.statement ?? [];
  const sales = payload.sales ?? [];
  return {
    cols: ["Date", "Till", "Ref", "Description", "Amount (KES)", "Status"],
    rows: stmt.map((s) => [
      s.date,
      s.till,
      s.ref,
      s.description,
      s.amount,
      s.matched ? `Matched${s.matchRef ? ` -> ${s.matchRef}` : ""}` : "Unmatched",
    ]),
    extra: {
      heading: "System M-Pesa sales",
      cols: ["Receipt", "Total (KES)", "Method", "When", "Staff"],
      rows: sales.map((s) => [s.receiptNo, s.total, s.method, fmtDateTime(s.createdAt), s.staffName]),
    },
    summary: [
      ["Statement money in (KES)", t.statementIn ?? 0],
      ["Statement money out (KES)", t.statementOut ?? 0],
      ["Matched lines", t.matchedCount ?? 0],
      ["Unmatched lines", t.unmatchedCount ?? 0],
      ["System M-Pesa sales total (KES)", t.systemMpesa ?? 0],
    ],
  };
}

/** Screen table for a financial matrix - money columns right aligned as KES. */
function FinDataTable({ cols, rows, foot }: { cols: string[]; rows: (string | number)[][]; foot?: (string | number)[] }) {
  const moneyIdx = useMemo(() => new Set(cols.map((c, i) => (c.includes("KES") ? i : -1)).filter((i) => i >= 0)), [cols]);
  const show = (v: string | number, i: number) => {
    if (typeof v !== "number") return String(v);
    return moneyIdx.has(i) ? KES(v) : v.toLocaleString("en-KE");
  };
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-[#F4F5F7]/70">
          {cols.map((c, i) => (
            <TableHead key={`${c}-${i}`} className={cn("h-8 text-[11px]", moneyIdx.has(i) && "text-right")}>
              {c}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            {r.map((cell, j) => (
              <TableCell key={j} className={cn("py-1.5 text-[12px] text-[#172B4D]", moneyIdx.has(j) && "text-right font-medium tabular-nums")}>
                {show(cell, j)}
              </TableCell>
            ))}
          </TableRow>
        ))}
        {foot?.length ? (
          <TableRow className="border-t-2 border-[#DFE1E6] bg-[#F4F5F7]">
            {foot.map((cell, j) => (
              <TableCell key={j} className={cn("py-2 text-[12px] font-bold tabular-nums text-[#172B4D]", moneyIdx.has(j) && "text-right")}>
                {typeof cell === "number" ? show(cell, j) : String(cell)}
              </TableCell>
            ))}
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

const FIN_ICONS: Record<FinKind, ReactNode> = {
  "general-ledger": <BookOpen className="h-4 w-4 text-[#0052CC]" />,
  "debtors-ledger": <HandCoins className="h-4 w-4 text-[#B8860B]" />,
  "creditors-ledger": <ShoppingCart className="h-4 w-4 text-[#B25E00]" />,
  "stock-ledger": <Boxes className="h-4 w-4 text-[#1B7A2E]" />,
  "mpesa-recon": <Smartphone className="h-4 w-4 text-[#0052CC]" />,
};

function FinancialReportTab({
  kind,
  accounts,
  stores,
}: {
  kind: FinKind;
  accounts: AccountDTO[];
  stores: { id: number; name: string }[];
}) {
  const profile = useCompanyProfile();
  const userName = useApp((s) => s.user?.name);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [accountId, setAccountId] = useState("all");
  const [partyId, setPartyId] = useState("all");
  const [storeId, setStoreId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<FinResp | null>(null);
  const [partyOptions, setPartyOptions] = useState<{ id: number; name: string }[]>([]);
  const [printOpen, setPrintOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ kind });
      if (kind === "general-ledger") {
        if (from) p.set("from", from);
        if (to) p.set("to", to);
        if (accountId !== "all") p.set("accountId", accountId);
      }
      if (kind === "debtors-ledger" && partyId !== "all") p.set("customerId", partyId);
      if (kind === "creditors-ledger" && partyId !== "all") p.set("supplierId", partyId);
      if (kind === "stock-ledger" && storeId !== "all") p.set("storeId", storeId);
      const d = await api.get<FinResp>(`/api/reports/financial?${p.toString()}`);
      setResp(d);
      if (kind === "debtors-ledger" && partyId === "all") {
        setPartyOptions(((d.rows ?? []) as FinDebtorRow[]).map((r) => ({ id: r.customerId, name: r.name })));
      }
      if (kind === "creditors-ledger" && partyId === "all") {
        setPartyOptions(((d.rows ?? []) as FinCreditorRow[]).map((r) => ({ id: r.supplierId, name: r.name })));
      }
    } catch (e) {
      setError(err(e));
      setResp(null);
    } finally {
      setLoading(false);
    }
  }, [kind, from, to, accountId, partyId, storeId]);

  useEffect(() => {
    // async boundary: the loader touches state, so never call it synchronously here
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const matrix = useMemo(() => (resp ? finMatrix(kind, resp) : null), [kind, resp]);

  const filters = useMemo(() => {
    const f: string[] = [];
    if (kind === "general-ledger") {
      if (from) f.push(`From ${from}`);
      if (to) f.push(`To ${to}`);
      const acc = accounts.find((a) => String(a.id) === accountId);
      f.push(accountId !== "all" && acc ? `Account: ${acc.code} ${acc.name}` : "All accounts");
    }
    if (kind === "debtors-ledger") {
      const opt = partyOptions.find((o) => String(o.id) === partyId);
      f.push(partyId !== "all" && opt ? `Customer: ${opt.name}` : "All customers");
    }
    if (kind === "creditors-ledger") {
      const opt = partyOptions.find((o) => String(o.id) === partyId);
      f.push(partyId !== "all" && opt ? `Supplier: ${opt.name}` : "All suppliers");
    }
    if (kind === "stock-ledger") {
      const st = stores.find((s) => String(s.id) === storeId);
      f.push(storeId !== "all" && st ? `Store: ${st.name}` : "All stores");
    }
    if (kind === "mpesa-recon") f.push("Scope: bank statement lines vs system M-Pesa sales");
    return f;
  }, [kind, from, to, accountId, partyId, storeId, accounts, stores, partyOptions]);

  const doPrint = () => {
    if (!resp) return;
    setPrintOpen(true);
    void printReportStandalone("a4");
  };

  const doExport = () => {
    if (!resp || !matrix) return;
    const rows: (string | number)[][] = [matrix.cols, ...matrix.rows, ...(matrix.foot?.length ? [matrix.foot] : [])];
    if (matrix.extra) rows.push([], [matrix.extra.heading], matrix.extra.cols, ...matrix.extra.rows);
    if (matrix.summary?.length) rows.push([], ["Summary", "Value"], ...matrix.summary);
    exportCsv(`${kind}-report`, rows, resp.title);
    toast({ title: "Export ready", description: `${resp.title} saved as CSV - opens in Excel.` });
  };

  const runBtn = (
    <Button
      size="sm"
      onClick={() => void load()}
      disabled={loading}
      className="h-8 bg-[#0052CC] px-3 text-[12px] font-bold text-white hover:bg-[#0041A8]"
    >
      <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Run
    </Button>
  );

  return (
    <div className="space-y-3">
      <ReportToolbar hash={resp?.hash} onPrint={resp ? doPrint : undefined} onExport={resp ? doExport : undefined}>
        {kind === "general-ledger" && (
          <>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[150px] bg-white text-[12px]" aria-label="From date" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-[150px] bg-white text-[12px]" aria-label="To date" />
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="h-8 w-[220px] bg-white text-[12px]" aria-label="Filter by account">
                <SelectValue placeholder="All accounts" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">All accounts</SelectItem>
                {accounts
                  .filter((a) => !a.isGroup)
                  .map((a) => (
                    <SelectItem key={a.code} value={String(a.id)}>
                      {a.code} {a.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {runBtn}
          </>
        )}
        {(kind === "debtors-ledger" || kind === "creditors-ledger") && (
          <>
            <Select value={partyId} onValueChange={setPartyId}>
              <SelectTrigger className="h-8 w-[220px] bg-white text-[12px]" aria-label={kind === "debtors-ledger" ? "Filter by customer" : "Filter by supplier"}>
                <SelectValue placeholder={kind === "debtors-ledger" ? "All customers" : "All suppliers"} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">{kind === "debtors-ledger" ? "All customers" : "All suppliers"}</SelectItem>
                {partyOptions.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {runBtn}
          </>
        )}
        {kind === "stock-ledger" && (
          <>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger className="h-8 w-[220px] bg-white text-[12px]" aria-label="Filter by store">
                <SelectValue placeholder="All stores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stores</SelectItem>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {runBtn}
          </>
        )}
        {kind === "mpesa-recon" && runBtn}
        {resp && <span className="text-[11px] text-[#6B778C]">Generated {fmtDateTime(resp.generatedAt)}</span>}
      </ReportToolbar>

      {error && !resp ? (
        <Panel>
          <EmptyState
            icon={<AlertTriangle className="h-5 w-5" />}
            title="Report failed to load"
            sub={error}
            action={
              <Button onClick={() => void load()} className="bg-[#0052CC] text-white hover:bg-[#0747A6]">
                Retry
              </Button>
            }
          />
        </Panel>
      ) : loading && !resp ? (
        <Panel>
          <TableSkeleton rows={8} cols={5} />
        </Panel>
      ) : resp && matrix ? (
        <Panel padding={false}>
          <div className="flex flex-wrap items-center gap-2 px-4 pt-4 md:px-6 md:pt-6">
            {FIN_ICONS[kind]}
            <h3 className="font-display text-[15px] font-bold text-[#172B4D]">{resp.title}</h3>
            <span className="text-[11px] text-[#6B778C]">
              {matrix.rows.length} lines {filters.length ? `- ${filters.join(" - ")}` : ""}
            </span>
          </div>
          <div className="mt-3 space-y-4 px-4 pb-4 md:px-6 md:pb-6">
            {kind === "mpesa-recon" && matrix.summary ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {matrix.summary.map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-[#DFE1E6] bg-[#F4F5F7]/50 px-3 py-2">
                    <p className="text-[10px] text-[#6B778C]">{String(label)}</p>
                    <p className="text-[13px] font-bold tabular-nums text-[#172B4D]">
                      {typeof value === "number" ? (String(label).includes("KES") ? KES(value) : value.toLocaleString("en-KE")) : String(value)}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
            <div className={cn("overflow-x-auto rounded-xl border border-[#DFE1E6]", SCROLL)}>
              <FinDataTable cols={matrix.cols} rows={matrix.rows} foot={matrix.foot} />
            </div>
            {matrix.extra ? (
              <div>
                <h4 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-[#6B778C]">{matrix.extra.heading}</h4>
                <div className={cn("overflow-x-auto rounded-xl border border-[#DFE1E6]", SCROLL)}>
                  <FinDataTable cols={matrix.extra.cols} rows={matrix.extra.rows} />
                </div>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {printOpen && resp && matrix ? (
        <div className="hidden print:block">
          <ReportPrint
            title={resp.title}
            company={profile}
            generatedBy={userName ?? undefined}
            generatedAt={resp.generatedAt}
            filters={filters}
            hash={resp.hash}
          >
            <ReportTable head={matrix.cols} rows={matrix.rows} foot={matrix.foot} />
            {matrix.summary ? (
              <div className="mt-4">
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Summary</p>
                <ReportTable head={["Metric", "Value"]} rows={matrix.summary} />
              </div>
            ) : null}
            {matrix.extra ? (
              <div className="mt-4">
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">{matrix.extra.heading}</p>
                <ReportTable head={matrix.extra.cols} rows={matrix.extra.rows} />
              </div>
            ) : null}
          </ReportPrint>
        </div>
      ) : null}
    </div>
  );
}

/* == Documents tab (printable Purchase Invoice, Expense Claim, Payslip,      =
     Payment Entry, Stock Entry, Sales Invoice from existing endpoints)        */

function DocSection({
  title,
  subtitle,
  icon,
  loading,
  cols,
  rows,
  onRowPrint,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  loading: boolean;
  cols: string[];
  rows: { key: string; cells: (string | number)[]; doc: ReceiptDocData }[];
  onRowPrint: (doc: ReceiptDocData) => void;
}) {
  return (
    <Panel padding={false}>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 md:px-6 md:pt-6">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#E9F2FF] text-[#0052CC]">{icon}</span>
        <div>
          <h3 className="font-display text-[14px] font-bold text-[#172B4D]">{title}</h3>
          <p className="text-[11px] text-[#6B778C]">{subtitle}</p>
        </div>
        <span className="ml-auto text-[11px] text-[#6B778C]">{loading ? "Loading..." : `${rows.length} documents`}</span>
      </div>
      <div className={cn("mt-3 px-4 pb-4 md:px-6 md:pb-6", SCROLL)}>
        {loading ? (
          <TableSkeleton rows={3} cols={Math.min(cols.length + 1, 6)} />
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-[#6B778C]">No documents available from this source yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#DFE1E6]">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F4F5F7]/70">
                  {cols.map((c) => (
                    <TableHead key={c} className={cn("h-8 text-[11px]", c.includes("(KES)") && "text-right")}>
                      {c}
                    </TableHead>
                  ))}
                  <TableHead className="h-8 text-right text-[11px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    {r.cells.map((cell, j) => (
                      <TableCell
                        key={j}
                        className={cn(
                          "py-1.5 text-[12px] text-[#172B4D]",
                          typeof cell === "number" && cols[j]?.includes("(KES)") && "text-right font-semibold tabular-nums"
                        )}
                      >
                        {typeof cell === "number" ? (cols[j]?.includes("(KES)") ? KES(cell) : cell.toLocaleString("en-KE")) : String(cell)}
                      </TableCell>
                    ))}
                    <TableCell className="py-1.5 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-[#C9CFDA] px-2 text-[11px] font-bold text-[#0052CC] hover:bg-[#E9F2FF] hover:text-[#0052CC]"
                        onClick={() => onRowPrint(r.doc)}
                        aria-label={`Print ${String(r.cells[0])}`}
                      >
                        <Printer className="h-3 w-3" /> Print
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Panel>
  );
}

function DocumentsTab({ onPrintDoc }: { onPrintDoc: (doc: ReceiptDocData) => void }) {
  const profile = useCompanyProfile();
  const userName = useApp((s) => s.user?.name) ?? "DukaFlow User";
  const [pos, setPos] = useState<POListItem[] | null>(null);
  const [sales, setSales] = useState<SaleDto[] | null>(null);
  const [exps, setExps] = useState<ExpListItem[] | null>(null);
  const [payslips, setPayslips] = useState<PayrollRow[] | null>(null);
  const [plans, setPlans] = useState<DebtPlanRow[] | null>(null);
  const [takes, setTakes] = useState<StockTakeRow[] | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // async boundary: loaders touch state, so never call them synchronously here
    const t = setTimeout(() => {
      void (async () => {
        const [rPo, rSales, rEx, rPr, rDp, rSt] = await Promise.allSettled([
          api.get<POListItem[]>("/api/purchase-orders"),
          api.get<SaleDto[]>("/api/sales?limit=15"),
          api.get<{ expenses: ExpListItem[] }>("/api/expenses?days=90"),
          api.get<{ rows: PayrollRow[] }>("/api/payroll"),
          api.get<{ plans: DebtPlanRow[] }>("/api/debt-plans"),
          api.get<StockTakeRow[]>("/api/stock-take"),
        ]);
        if (!alive) return;
        const failed: string[] = [];
        if (rPo.status === "fulfilled") setPos(rPo.value);
        else failed.push("purchase orders");
        if (rSales.status === "fulfilled") setSales(rSales.value);
        else failed.push("sales");
        if (rEx.status === "fulfilled") setExps(rEx.value.expenses);
        else failed.push("expenses");
        if (rPr.status === "fulfilled") setPayslips(rPr.value.rows);
        else failed.push("payroll");
        if (rDp.status === "fulfilled") setPlans(rDp.value.plans);
        else failed.push("debt plans");
        if (rSt.status === "fulfilled") setTakes(rSt.value);
        else failed.push("stock takes");
        setWarn(failed.length ? `Some document sources could not be loaded: ${failed.join(", ")}.` : null);
      })();
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  return (
    <div className="space-y-4">
      <Alert className="border-[#C7E3FF] bg-[#E9F2FF] text-[#172B4D]">
        <FileText className="h-4 w-4 !text-[#0052CC]" />
        <AlertTitle>Printable documents</AlertTitle>
        <AlertDescription className="text-[#6B778C]">
          Every document below prints as an A4 receipt (Purchase Invoice, Sales Invoice, Expense Claim, Payslip, Payment Entry, Stock Entry) with your company header and a scan-able QR.
        </AlertDescription>
      </Alert>
      {warn ? (
        <Alert className="border-[#FFD591] bg-[#FFF8E1] text-[#172B4D]">
          <AlertTriangle className="h-4 w-4 !text-[#B8860B]" />
          <AlertTitle>Partial load</AlertTitle>
          <AlertDescription className="text-[#6B778C]">{warn}</AlertDescription>
        </Alert>
      ) : null}

      <DocSection
        title="Sales Invoices"
        subtitle="Latest receipts from /api/sales"
        icon={<FileText className="h-4 w-4" />}
        loading={sales === null}
        cols={["Invoice", "Customer", "Items", "Total (KES)", "Payment", "KRA"]}
        rows={(sales ?? []).slice(0, 15).map((s) => ({
          key: s.receiptNo,
          cells: [s.receiptNo, s.customerName ?? "Walk-in customer", s.items.length, s.total, s.paymentMethod, s.kraStatus],
          doc: salesInvoiceDoc(s, profile, userName),
        }))}
        onRowPrint={onPrintDoc}
      />

      <DocSection
        title="Purchase Invoices"
        subtitle="Purchase orders from /api/purchase-orders"
        icon={<ShoppingCart className="h-4 w-4" />}
        loading={pos === null}
        cols={["PO No", "Supplier", "Store", "Ordered", "Total (KES)", "Status"]}
        rows={(pos ?? []).map((po) => ({
          key: po.poNo,
          cells: [po.poNo, po.supplierName, po.storeName, fmtDate(po.orderedAt.slice(0, 10)), po.total, po.status],
          doc: purchaseInvoiceDoc(po, profile, userName),
        }))}
        onRowPrint={onPrintDoc}
      />

      <DocSection
        title="Expense Claims"
        subtitle="Operating expenses from /api/expenses (last 90 days)"
        icon={<Wallet className="h-4 w-4" />}
        loading={exps === null}
        cols={["Doc No", "Category", "Note", "Store", "Paid via", "Amount (KES)"]}
        rows={(exps ?? []).map((e) => ({
          key: `exp-${e.id}`,
          cells: [e.refNo || `EXP-${String(e.id).padStart(4, "0")}`, e.category, e.note || "-", e.storeName, e.paidVia, e.amount],
          doc: expenseClaimDoc(e, profile, userName),
        }))}
        onRowPrint={onPrintDoc}
      />

      <DocSection
        title="Payslips"
        subtitle="Computed payroll from /api/payroll (current period)"
        icon={<Banknote className="h-4 w-4" />}
        loading={payslips === null}
        cols={["Doc No", "Employee", "Department", "Period", "Gross (KES)", "Net (KES)", "Status"]}
        rows={(payslips ?? []).map((r) => ({
          key: `ps-${r.period}-${r.employeeId}`,
          cells: [
            `PS-${r.period}-${String(r.employeeId).padStart(3, "0")}`,
            r.employeeName,
            r.dept || "-",
            r.period,
            r.gross,
            r.net,
            r.status,
          ],
          doc: payslipDoc(r, profile, userName),
        }))}
        onRowPrint={onPrintDoc}
      />

      <DocSection
        title="Payment Entries"
        subtitle="Debt repayment plans from /api/debt-plans"
        icon={<HandCoins className="h-4 w-4" />}
        loading={plans === null}
        cols={["Doc No", "Customer", "Installment", "Amount (KES)", "Next due", "Status"]}
        rows={(plans ?? []).map((p) => ({
          key: `plan-${p.id}`,
          cells: [
            p.invoiceNo ?? `PLAN-${String(p.id).padStart(4, "0")}`,
            p.customerName,
            p.installmentType,
            p.installmentAmount,
            fmtDate(p.nextDueDate.slice(0, 10)),
            p.status,
          ],
          doc: paymentEntryDoc(p, profile, userName),
        }))}
        onRowPrint={onPrintDoc}
      />

      <DocSection
        title="Stock Entries"
        subtitle="Cycle counts from /api/stock-take"
        icon={<Boxes className="h-4 w-4" />}
        loading={takes === null}
        cols={["Doc No", "Store", "Scope", "Counted", "Variance (KES)", "Status"]}
        rows={(takes ?? []).map((t) => ({
          key: t.stNo,
          cells: [
            t.stNo,
            t.store?.name ?? "-",
            t.category,
            `${t.countedItems}/${t.totalItems}`,
            t.varianceValue,
            t.status,
          ],
          doc: stockEntryDoc(t, profile, userName),
        }))}
        onRowPrint={onPrintDoc}
      />
    </div>
  );
}

/* == main screen ============================================================ */

export default function AccountingScreen() {
  const [data, setData] = useState<AccPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printDoc, setPrintDoc] = useState<ReceiptDocData | null>(null);

  const user = useApp((s) => s.user);
  const profile = useCompanyProfile();
  const userName = user?.name ?? "DukaFlow User";
  const canMargin = canSeeMargin(user?.role);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<AccPayload>("/api/accounting"));
    } catch (e) {
      toast({ title: "Could not load accounting", description: err(e) });
      setError(err(e));
    }
  }, []);

  useEffect(() => {
    // async boundary: the loader touches state, so never call it synchronously here
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  /** Prints the document standalone (own window, own onload - never blank). */
  const printDocNow = useCallback((doc: ReceiptDocData) => {
    void printReceiptDocs([doc], "a4");
  }, []);

  const printJournal = useCallback(
    (j: JournalDTO) => {
      const storeName = data?.stores.find((s) => s.id === j.storeId)?.name;
      printDocNow(journalDoc(j, profile, userName, storeName));
      toast({ title: `Printing ${j.jvNo}`, description: "A4 journal voucher prepared - choose your printer in the dialog." });
    },
    [data, profile, userName, printDocNow]
  );

  /* -- loading / error states ----------------------------------------------- */
  if (error && !data) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <ScreenHeader title="Accounting" subtitle="Double-entry ledger - journals, trial balance & statutory reports" />
        <EmptyState
          icon={<AlertTriangle className="h-5 w-5" />}
          title="Could not load accounting data"
          sub={error}
          action={
            <Button onClick={() => void load()} className="bg-[#0052CC] text-white hover:bg-[#0747A6]">
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const pnl = data?.pnl;
  const recon = data?.bankRecon.summary;
  const stock = data?.stockValuation;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <ScreenHeader title="Accounting" subtitle="Double-entry ledger - journals, trial balance & statutory reports" />

      {/* KPI row - margin figures are Owner / Manager / Accountant only */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Gross Profit"
          value={pnl ? (canMargin ? KES(pnl.grossProfit) : "••••") : ""}
          sub={pnl ? (canMargin ? `${pnl.grossMarginPct}% margin` : "Management only") : undefined}
          iconBg="#E8F5E9"
          iconColor="#00C853"
          loading={!pnl}
        />
        <KpiCard
          icon={<Wallet className="h-4 w-4" />}
          label="Net Profit"
          value={pnl ? (canMargin ? KES(pnl.netProfit) : "••••") : ""}
          sub={pnl ? (canMargin ? `vs Aug 2026: ${pnl.trendPct >= 0 ? "+" : ""}${pnl.trendPct.toFixed(1)}%` : "Owner / Manager / Accountant only") : undefined}
          iconBg="#E9F2FF"
          iconColor="#0052CC"
          loading={!pnl}
        />
        <KpiCard icon={<Boxes className="h-4 w-4" />} label="Stock Value (FIFO)" value={stock ? KES(stock.total) : ""} sub={stock ? `${stock.skuCount} SKUs on hand` : undefined} iconBg="#FFF8E1" iconColor="#B8860B" loading={!stock} />
        <KpiCard icon={<Landmark className="h-4 w-4" />} label="Bank Match Rate" value={recon ? `${recon.matchPct}%` : ""} sub={recon ? `${recon.matched} matched • ${recon.unmatched} to review` : undefined} iconBg="#F4F5F7" iconColor="#172B4D" loading={!recon} />
      </div>

      {!data ? (
        <Panel>
          <TableSkeleton rows={8} cols={5} />
        </Panel>
      ) : (
        <Tabs defaultValue="coa" className="gap-4">
          <TabsList className="h-auto w-full max-w-full justify-start gap-1 overflow-x-auto rounded-xl border border-[#DFE1E6] bg-white p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsTrigger value="coa" className="flex-none px-3 py-1.5 text-[12px]">Chart of Accounts</TabsTrigger>
            <TabsTrigger value="ledger" className="flex-none px-3 py-1.5 text-[12px]">General Ledger</TabsTrigger>
            <TabsTrigger value="daily" className="flex-none px-3 py-1.5 text-[12px]">Daily Sales Journals</TabsTrigger>
            <TabsTrigger value="stock" className="flex-none px-3 py-1.5 text-[12px]">Stock Accounts</TabsTrigger>
            <TabsTrigger value="tb" className="flex-none px-3 py-1.5 text-[12px]">Trial Balance</TabsTrigger>
            <TabsTrigger value="pnl" className="flex-none px-3 py-1.5 text-[12px]">Profit &amp; Loss</TabsTrigger>
            <TabsTrigger value="bs" className="flex-none px-3 py-1.5 text-[12px]">Balance Sheet</TabsTrigger>
            <TabsTrigger value="bank" className="flex-none px-3 py-1.5 text-[12px]">Bank Reconciliation</TabsTrigger>
            <TabsTrigger value="glreport" className="flex-none px-3 py-1.5 text-[12px]">GL Report</TabsTrigger>
            <TabsTrigger value="debtorsledger" className="flex-none px-3 py-1.5 text-[12px]">Debtors Ledger</TabsTrigger>
            <TabsTrigger value="creditorsledger" className="flex-none px-3 py-1.5 text-[12px]">Creditors Ledger</TabsTrigger>
            <TabsTrigger value="stockledger" className="flex-none px-3 py-1.5 text-[12px]">Stock Ledger</TabsTrigger>
            <TabsTrigger value="mpesarecon" className="flex-none px-3 py-1.5 text-[12px]">M-Pesa Recon</TabsTrigger>
            <TabsTrigger value="documents" className="flex-none px-3 py-1.5 text-[12px]">Documents</TabsTrigger>
          </TabsList>

          <TabsContent value="coa">
            <CoaTab coa={data.coa} />
          </TabsContent>
          <TabsContent value="ledger">
            <GeneralLedgerTab journals={data.journals} stores={data.stores} onPrint={printJournal} />
          </TabsContent>
          <TabsContent value="daily">
            <DailyJournalsTab entries={data.dailySalesJournals} today={data.today} stores={data.stores} onPrint={printJournal} />
          </TabsContent>
          <TabsContent value="stock">
            <StockAccountsTab stock={data.stockValuation} />
          </TabsContent>
          <TabsContent value="tb">
            <TrialBalanceTab rows={data.trialBalance} totals={data.tbTotals} autoBalanced={data.tbAutoBalanced} adjustment={data.tbAdjustment} today={data.today} />
          </TabsContent>
          <TabsContent value="pnl">
            {canMargin ? (
              <PnlTab pnl={data.pnl} month={data.month} />
            ) : (
              <ManagementLock what="The Profit & Loss statement (margins and net profit)" />
            )}
          </TabsContent>
          <TabsContent value="bs">
            {canMargin ? (
              <BalanceSheetTab bs={data.balanceSheet} />
            ) : (
              <ManagementLock what="The Balance Sheet (assets, liabilities and equity)" />
            )}
          </TabsContent>
          <TabsContent value="bank">
            <BankReconTab recon={data.bankRecon} ledgerCash={data.ledgerCash} />
          </TabsContent>
          <TabsContent value="glreport">
            <FinancialReportTab kind="general-ledger" accounts={data.coa} stores={data.stores} />
          </TabsContent>
          <TabsContent value="debtorsledger">
            <FinancialReportTab kind="debtors-ledger" accounts={data.coa} stores={data.stores} />
          </TabsContent>
          <TabsContent value="creditorsledger">
            <FinancialReportTab kind="creditors-ledger" accounts={data.coa} stores={data.stores} />
          </TabsContent>
          <TabsContent value="stockledger">
            <FinancialReportTab kind="stock-ledger" accounts={data.coa} stores={data.stores} />
          </TabsContent>
          <TabsContent value="mpesarecon">
            <FinancialReportTab kind="mpesa-recon" accounts={data.coa} stores={data.stores} />
          </TabsContent>
          <TabsContent value="documents">
            <DocumentsTab onPrintDoc={printDocNow} />
          </TabsContent>
        </Tabs>
      )}

      {/* hidden A4 host for document prints (ReceiptDocument + printReceiptArea) */}
      <div className="hidden print:block">
        {printDoc ? <ReceiptDocument data={printDoc} mode="a4" /> : null}
      </div>
    </div>
  );
}
