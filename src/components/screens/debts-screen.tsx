"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  BellRing, CalendarClock, ChartNoAxesColumnIncreasing, Download, Eye, FileText, HandCoins, Landmark, Loader2, Mail, MoreHorizontal,
  Plus, Printer, ReceiptText, Send, ShieldAlert, Smartphone, TrendingUp, TriangleAlert, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { CustomerDto, DebtPlanDto, KES } from "@/types";
import { customerPointsLine, fmtDate, kes, type ReceiptDocData } from "@/lib/receipt";
import { ReceiptDocument, printReceiptArea } from "@/components/df/receipt-document";
import { ScreenHeader, KpiCard, Panel, EmptyState, TableSkeleton } from "@/components/df/shared";
import { TierBadge, OverdueBadge, KraBadge } from "@/components/df/badges";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* -- contracts ---------------------------------------------- */

/** API enriches plans with the customer's tier (shared DebtPlanDto omits it). */
type PlanRow = DebtPlanDto & { tier?: string | null };

interface DebtSummary {
  toCollect: number;
  overdueCount: number;
  overdueAmount: number;
  aging: { d0_30: number; d31_60: number; d60plus: number };
}

interface DebtPlansResponse {
  plans: PlanRow[];
  summary: DebtSummary;
}

interface Creditor {
  id: number;
  name: string;
  billNo: string;
  amount: number;
  balance: number;
  due: string;
  overdueDays: number;
  paid: boolean;
  terms: string;
}

/* -- debtor statement (printable / CSV) ------------------- */

interface StatementData {
  customer: { id: number; name: string; phone: string; email: string | null; tier: string };
  plan: {
    id: number; invoiceNo: string | null; installmentType: string; installmentAmount: number;
    nextDueDate: string; status: string; overdueDays: number; balance: number;
  };
  invoices: { id: number; receiptNo: string; createdAt: string; total: number; status: string }[];
  payments: { id: number; amount: number; method: string; note: string | null; createdAt: string }[];
  summary: {
    invoicedTotal: number; paidTotal: number; balance: number; creditLimit: number;
    availableCredit: number; oldestInvoiceAgeDays: number; generatedAt: string;
  };
}

/** Creditors ledger - seed subset matching the prototype (Bamburi / Sadolin / Twiga). */
const CREDITORS: Creditor[] = [
  { id: 1, name: "Bamburi Cement Ltd", billNo: "BILL-001", amount: 120000, balance: 80000, due: "15 Sep", overdueDays: 0, paid: false, terms: "Net 30" },
  { id: 2, name: "Sadolin Paints Kenya", billNo: "BILL-002", amount: 45000, balance: 0, due: "30 Aug", overdueDays: 0, paid: true, terms: "Net 15" },
  { id: 3, name: "Twiga Steel Suppliers", billNo: "BILL-003", amount: 65000, balance: 65000, due: "01 Sep", overdueDays: 3, paid: false, terms: "Net 30" },
];

/** Prototype-level payables totals (full supplier ledger lives in the books). */
const CREDITOR_BOOK = { toPay: 210000, dueThisWeek: 3, suppliers: 12 };
const CREDITOR_AGING: { label: string; value: number }[] = [
  { label: "Current / 0-30d", value: 145000 },
  { label: "31-60d", value: 0 },
  { label: "60d+", value: 65000 },
];

const TO_PAY_BASE = 210000; // static payable book used for net cashflow estimate

type DebtFilter = "all" | "overdue" | "blocked" | "active" | "cur" | "b1_30" | "b31_60" | "b60p";

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const initials = (name: string) =>
  name.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const compact = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(Math.abs(n) / 1000)}k` : `${Math.abs(n)}`);

/* -- receipt builders (ReceiptDocument + digital twin) ----- */

const RECEIPT_HOST_CSS = `
#df-receipt-host { display: none; }
@media print {
  #df-receipt-host { display: block !important; }
  body > *:not(#df-receipt-host) { display: none !important; }
  #df-receipt-host .df-receipt { position: static !important; left: auto; top: auto; }
}
`;

function ReceiptPrintHost({ docs, mode }: { docs: ReceiptDocData[]; mode: "thermal" | "a4" }) {
  if (docs.length === 0) return null;
  // portals only exist client-side; docs start empty so SSR renders null and hydration stays in sync
  if (typeof document === "undefined") return null;
  return createPortal(
    <div id="df-receipt-host" aria-hidden>
      <style>{RECEIPT_HOST_CSS}</style>
      {docs.map((d, i) => (
        <div key={`${i}-${d.docNo}`} style={{ pageBreakAfter: i < docs.length - 1 ? "always" : "auto" }}>
          <ReceiptDocument data={d} mode={mode} />
        </div>
      ))}
    </div>,
    document.body
  );
}

/** Fresh statement payload (also used to locate the newest payment row). */
async function fetchStatement(planId: number): Promise<StatementData | null> {
  try {
    return await api.get<StatementData>(`/api/debt-plans/${planId}/statement`);
  } catch {
    return null;
  }
}

/** ReceiptDocument for one DebtPayment (docNo RCP-D-<paymentId>). */
function debtPaymentDoc(args: {
  planId: number;
  invoiceNo: string | null;
  payment: { id: number; amount: number; method: string; note: string | null; createdAt: string };
  customerName: string;
  tier?: string | null;
  pointsBalance?: number;
  remainingBalance?: number;
  receiptCode?: string;
}): ReceiptDocData {
  const { planId, invoiceNo, payment, customerName, tier, pointsBalance, remainingBalance, receiptCode } = args;
  return {
    kind: "DEBT_PAYMENT",
    docNo: `RCP-D-${payment.id}`,
    receiptCode,
    date: fmtDate(payment.createdAt),
    servedBy: "Accounts Desk",
    customerName,
    customerLine: customerPointsLine(customerName, tier, undefined, pointsBalance),
    lines: [
      {
        no: 1,
        name: `Payment towards ${invoiceNo ?? `payment plan #${planId}`}`,
        qty: 1,
        unit: "pc",
        unitPrice: payment.amount,
        discount: 0,
        total: payment.amount,
      },
    ],
    totals: [
      ...(typeof remainingBalance === "number"
        ? [{ label: "Remaining balance", value: kes(remainingBalance) }]
        : []),
      { label: "Amount received", value: kes(payment.amount), bold: true },
    ],
    grandTotal: kes(payment.amount),
    paymentLines: [{ method: payment.method, amount: kes(payment.amount) }],
    footerMessage: "Thank you for your payment - Asante!",
  };
}

/** Statement summary as a ReceiptDocument (all invoices + payments in extraBlocks). */
function statementReceiptDoc(st: StatementData, receiptCode?: string): ReceiptDocData {
  return {
    kind: "STATEMENT",
    title: "ACCOUNT STATEMENT",
    docNo: `STMT-D-${st.plan.id}`,
    receiptCode,
    date: fmtDate(st.summary.generatedAt),
    servedBy: "Accounts Desk",
    customerName: st.customer.name,
    customerLine: customerPointsLine(st.customer.name, st.customer.tier),
    lines: [],
    totals: [{ label: "Balance due", value: kes(st.summary.balance), bold: true }],
    grandTotal: kes(st.summary.balance),
    extraBlocks: [
      {
        heading: "Credit invoices",
        rows: st.invoices.map((i) => ({ label: `${i.receiptNo} - ${fmtDay(i.createdAt)}`, value: kes(i.total) })),
      },
      {
        heading: "Payments received",
        rows: st.payments.map((p) => ({ label: `${fmtDay(p.createdAt)} - ${p.method}`, value: `- ${kes(p.amount)}` })),
      },
      {
        heading: "Account summary",
        rows: [
          { label: "Invoiced total", value: kes(st.summary.invoicedTotal) },
          { label: "Paid to date", value: kes(st.summary.paidTotal) },
          { label: "Installment", value: `${kes(st.plan.installmentAmount)} / ${st.plan.installmentType.toLowerCase()}` },
          { label: "Next due", value: fmtDay(st.plan.nextDueDate) },
          { label: "Overdue days", value: String(st.plan.overdueDays) },
          { label: "Credit limit", value: kes(st.summary.creditLimit) },
          { label: "Available credit", value: kes(st.summary.availableCredit) },
        ],
      },
    ],
    footerMessage: "Statement generated by DukaFlow ERP - Asante!",
  };
}

/** Debtors Payment Summary (ALL): every customer with outstanding totals. */
function debtorsSummaryDoc(plans: PlanRow[]): ReceiptDocData {
  const total = plans.reduce((a, p) => a + p.totalDebt, 0);
  const overdue = plans.filter((p) => p.overdueDays > 0 && p.status === "Active");
  return {
    kind: "STATEMENT",
    title: "DEBTORS PAYMENT SUMMARY",
    docNo: `STMT-ALL-${new Date().toISOString().slice(0, 10)}`,
    date: fmtDate(new Date().toISOString()),
    servedBy: "Accounts Desk",
    lines: [],
    totals: [
      { label: `${plans.length} debt ledgers`, value: "" },
      { label: `${overdue.length} overdue`, value: kes(overdue.reduce((a, p) => a + p.totalDebt, 0)), bold: true },
    ],
    grandTotal: kes(total),
    extraBlocks: [
      {
        heading: "Outstanding per customer",
        rows: plans.length
          ? plans.map((p) => ({
              label: `${p.customerName}${p.invoiceNo ? ` - ${p.invoiceNo}` : ""}`,
              value: kes(p.totalDebt),
              bold: p.overdueDays > 0,
            }))
          : [{ label: "No open debt plans", value: "" }],
      },
    ],
    footerMessage: "Debtors summary - DukaFlow credit control",
  };
}

/* -- screen ------------------------------------------------- */

export default function DebtsScreen() {
  const [data, setData] = useState<DebtPlansResponse | null>(null);
  const [customers, setCustomers] = useState<CustomerDto[] | null>(null);
  const [filter, setFilter] = useState<DebtFilter>("all");
  const [busyPlanId, setBusyPlanId] = useState<number | null>(null);

  /* record payment dialog */
  const [payPlan, setPayPlan] = useState<PlanRow | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payBusy, setPayBusy] = useState(false);

  /* edit plan dialog */
  const [editPlan, setEditPlan] = useState<PlanRow | null>(null);
  const [editForm, setEditForm] = useState({ installmentType: "Weekly", installmentAmount: "", autoReminderSms: true, autoBlockPosOverdue: true });
  const [editBusy, setEditBusy] = useState(false);

  /* payment plan builder */
  const [builderOpen, setBuilderOpen] = useState(false);
  const [buildBusy, setBuildBusy] = useState(false);
  const [buildForm, setBuildForm] = useState({
    customerId: "", totalDebt: "", installmentType: "Weekly", weeks: 4,
    installmentAmount: "", invoiceNo: "", autoReminderSms: true, autoBlockPosOverdue: true,
  });

  /* supplier payment confirm */
  const [payCreditor, setPayCreditor] = useState<Creditor | null>(null);
  const [creditorBusy, setCreditorBusy] = useState(false);

  /* debtor statement dialog */
  const [stmtPlan, setStmtPlan] = useState<PlanRow | null>(null);
  const [stmtData, setStmtData] = useState<StatementData | null>(null);
  const [stmtLoading, setStmtLoading] = useState(false);
  const [stmtBusy, setStmtBusy] = useState(false);

  /* statement email (mock mailer - audited in Messages) */
  const [stmtEmailOpen, setStmtEmailOpen] = useState(false);
  const [stmtEmailTo, setStmtEmailTo] = useState("");
  const [stmtEmailSubject, setStmtEmailSubject] = useState("");
  const [stmtEmailBody, setStmtEmailBody] = useState("");
  const [stmtEmailLoading, setStmtEmailLoading] = useState(false);
  const [stmtEmailSending, setStmtEmailSending] = useState(false);

  /* receipt printing (payment receipts, statement receipts, debtors summary) */
  const [payMethod, setPayMethod] = useState("Cash");
  const [printDocs, setPrintDocs] = useState<ReceiptDocData[]>([]);
  const [printMode, setPrintMode] = useState<"thermal" | "a4">("thermal");
  const [stmtReceiptBusy, setStmtReceiptBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [debt, custs] = await Promise.all([
        api.get<DebtPlansResponse>("/api/debt-plans"),
        api.get<CustomerDto[]>("/api/customers"),
      ]);
      setData(debt);
      setCustomers(custs);
    } catch (e) {
      toast({ title: "Could not load debt ledger", description: err(e) });
      setData({ plans: [], summary: { toCollect: 0, overdueCount: 0, overdueAmount: 0, aging: { d0_30: 0, d31_60: 0, d60plus: 0 } } });
      setCustomers([]);
    }
  }, []);

  useEffect(() => {
    // async boundary: the loader touches state, so never call it synchronously here
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const plans = data?.plans ?? [];
  const s = data?.summary;

  const printDocsNow = useCallback((docs: ReceiptDocData[], mode: "thermal" | "a4") => {
    setPrintMode(mode);
    setPrintDocs(docs);
    // let React mount the hidden print host + generate QRs before window.print()
    window.setTimeout(() => printReceiptArea(mode), 300);
  }, []);

  /** Debt payment receipt: digital twin first (QR), then print (thermal roll). */
  const printDebtPayment = useCallback(
    async (
      plan: { id: number; invoiceNo: string | null },
      payment: { id: number; amount: number; method: string; note: string | null; createdAt: string },
      customerName: string,
      opts?: { tier?: string | null; pointsBalance?: number; remainingBalance?: number }
    ) => {
      const doc = debtPaymentDoc({
        planId: plan.id,
        invoiceNo: plan.invoiceNo,
        payment,
        customerName,
        tier: opts?.tier,
        pointsBalance: opts?.pointsBalance,
        remainingBalance: opts?.remainingBalance,
      });
      try {
        const dr = await api.post<{ receiptCode: string; url: string }>("/api/digital-receipt", {
          kind: "DEBT_PAYMENT",
          refNo: doc.docNo,
          payload: doc,
        });
        doc.receiptCode = dr.receiptCode;
      } catch {
        // digital twin failed - print anyway, QR falls back to the doc number
      }
      printDocsNow([doc], "thermal");
    },
    [printDocsNow]
  );

  /** Customer statement as a summary ReceiptDocument with extraBlocks. */
  const printStatementReceipt = useCallback(
    async (plan: PlanRow) => {
      setStmtReceiptBusy(true);
      try {
        const st = await fetchStatement(plan.id);
        if (!st) throw new Error("Statement not found");
        const doc = statementReceiptDoc(st);
        try {
          const dr = await api.post<{ receiptCode: string }>("/api/digital-receipt", {
            kind: "STATEMENT",
            refNo: doc.docNo,
            payload: doc,
          });
          doc.receiptCode = dr.receiptCode;
        } catch {
          // print without the digital code if the twin fails
        }
        printDocsNow([doc], "a4");
      } catch (e) {
        toast({ title: "Could not print statement receipt", description: err(e) });
      } finally {
        setStmtReceiptBusy(false);
      }
    },
    [printDocsNow]
  );

  /** Debtors Payment Summary (ALL): one receipt listing every customer. */
  const printDebtorsSummary = useCallback(() => {
    if (plans.length === 0) {
      toast({ title: "Nothing to summarise", description: "No debt plans are open right now." });
      return;
    }
    const doc = debtorsSummaryDoc(plans);
    void (async () => {
      try {
        const dr = await api.post<{ receiptCode: string }>("/api/digital-receipt", {
          kind: "STATEMENT",
          refNo: doc.docNo,
          payload: doc,
        });
        doc.receiptCode = dr.receiptCode;
      } catch {
        // print without the digital code if the twin fails
      }
      printDocsNow([doc], "a4");
    })();
  }, [plans, printDocsNow]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "overdue":
        return plans.filter((p) => p.overdueDays > 0 && p.status === "Active");
      case "blocked":
        return plans.filter((p) => p.autoBlockPosOverdue && p.overdueDays > 7);
      case "active":
        return plans.filter((p) => p.status === "Active");
      case "cur":
        return plans.filter((p) => p.status === "Active" && p.overdueDays === 0);
      case "b1_30":
        return plans.filter((p) => p.status === "Active" && p.overdueDays >= 1 && p.overdueDays <= 30);
      case "b31_60":
        return plans.filter((p) => p.status === "Active" && p.overdueDays >= 31 && p.overdueDays <= 60);
      case "b60p":
        return plans.filter((p) => p.status === "Active" && p.overdueDays > 60);
      default:
        return plans;
    }
  }, [plans, filter]);

  /* -- receivables aging buckets from the live ledger -- */
  const agingBuckets = useMemo(() => {
    const active = plans.filter((p) => p.status === "Active");
    const inBucket = (p: (typeof active)[number], lo: number, hi: number) =>
      p.overdueDays >= lo && p.overdueDays <= hi;
    const mk = (key: DebtFilter, label: string, color: string, bg: string, lo: number, hi: number) => {
      const rows = active.filter((p) => inBucket(p, lo, hi));
      return { key, label, color, bg, count: rows.length, amount: rows.reduce((a, p) => a + p.totalDebt, 0) };
    };
    const buckets = [
      mk("cur", "Current", "#0052CC", "#E9F2FF", 0, 0),
      mk("b1_30", "1-30 days", "#B8860B", "#FFF8E1", 1, 30),
      mk("b31_60", "31-60 days", "#FF5630", "#FFEBE8", 31, 60),
      mk("b60p", "60+ days", "#C62828", "#FFEBEE", 61, Number.MAX_SAFE_INTEGER),
    ];
    const total = buckets.reduce((a, b) => a + b.amount, 0);
    return { buckets, total };
  }, [plans]);

  const chipCount = (f: DebtFilter) => {
    switch (f) {
      case "overdue": return plans.filter((p) => p.overdueDays > 0 && p.status === "Active").length;
      case "blocked": return plans.filter((p) => p.autoBlockPosOverdue && p.overdueDays > 7).length;
      case "active": return plans.filter((p) => p.status === "Active").length;
      case "cur": return plans.filter((p) => p.status === "Active" && p.overdueDays === 0).length;
      case "b1_30": return plans.filter((p) => p.status === "Active" && p.overdueDays >= 1 && p.overdueDays <= 30).length;
      case "b31_60": return plans.filter((p) => p.status === "Active" && p.overdueDays >= 31 && p.overdueDays <= 60).length;
      case "b60p": return plans.filter((p) => p.status === "Active" && p.overdueDays > 60).length;
      default: return plans.length;
    }
  };

  /* -- mutations -------------------------------------------- */

  const patchPlan = async (id: number, body: Record<string, unknown>, okMsg: string) => {
    setBusyPlanId(id);
    try {
      await api.patch(`/api/debt-plans/${id}`, body);
      toast({ title: okMsg });
      await load();
    } catch (e) {
      toast({ title: "Update failed", description: err(e) });
      throw e;
    } finally {
      setBusyPlanId(null);
    }
  };

  const togglePlanField = async (plan: PlanRow, field: "autoReminderSms" | "autoBlockPosOverdue", value: boolean) => {
    setBusyPlanId(plan.id);
    const prev = plans;
    setData((d) =>
      d ? { ...d, plans: d.plans.map((p) => (p.id === plan.id ? { ...p, [field]: value } : p)) } : d
    );
    try {
      await api.patch(`/api/debt-plans/${plan.id}`, { [field]: value });
      toast({
        title: field === "autoReminderSms"
          ? `Auto reminder SMS ${value ? "on" : "off"} for ${plan.customerName}`
          : `Auto-block POS ${value ? "on" : "off"} for ${plan.customerName}`,
      });
    } catch (e) {
      setData((d) => (d ? { ...d, plans: prev } : d)); // revert
      toast({ title: "Could not update automation", description: err(e) });
    } finally {
      setBusyPlanId(null);
    }
  };

  const openRecordPayment = (plan: PlanRow) => {
    setPayPlan(plan);
    setPayAmount(String(plan.installmentAmount || ""));
  };

  /* -- debtor statement: load → render → print / CSV ------ */
  const openStatement = async (plan: PlanRow) => {
    setStmtPlan(plan);
    setStmtData(null);
    setStmtLoading(true);
    try {
      const d = await api.get<StatementData>(`/api/debt-plans/${plan.id}/statement`);
      setStmtData(d);
    } catch (e) {
      toast({ title: "Could not load statement", description: err(e) });
      setStmtPlan(null);
    } finally {
      setStmtLoading(false);
    }
  };

  const printStatement = () => {
    setStmtBusy(true);
    window.setTimeout(() => {
      window.print();
      setStmtBusy(false);
    }, 60);
  };

  /* -- statement email: preview → send ------------------- */
  const openStatementEmail = async () => {
    if (!stmtPlan) return;
    setStmtEmailOpen(true);
    setStmtEmailLoading(true);
    setStmtEmailTo(stmtData?.customer.email ?? "");
    try {
      const r = await api.get<{ ok: boolean; subject: string; body: string; to: string; customerName: string }>(
        `/api/debt-plans/${stmtPlan.id}/statement/email`
      );
      setStmtEmailSubject(r.subject);
      setStmtEmailBody(r.body);
      if (r.to) setStmtEmailTo(r.to);
    } catch {
      setStmtEmailSubject(`Account Statement - ${stmtPlan.customerName}`);
      setStmtEmailBody("Could not preview the statement - try again.");
    } finally {
      setStmtEmailLoading(false);
    }
  };

  const sendStatementEmail = async () => {
    if (!stmtPlan) return;
    setStmtEmailSending(true);
    try {
      const r = await api.post<{ ok: boolean; to: string }>(`/api/debt-plans/${stmtPlan.id}/statement/email`, {
        to: stmtEmailTo.trim(),
      });
      toast({ title: "Statement emailed ✉️", description: `${stmtPlan.customerName} → ${r.to} (audited in Messages)` });
      setStmtEmailOpen(false);
    } catch (e) {
      toast({ title: "Could not send", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setStmtEmailSending(false);
    }
  };

  const downloadStatementCsv = () => {
    if (!stmtData) return;
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const rows: string[] = [
      ["Type", "Date", "Reference", "Method", "Amount (KES)"].map(esc).join(","),
      ...stmtData.invoices.map((i) =>
        ["Invoice", i.createdAt.slice(0, 10), i.receiptNo, "Credit Sale", i.total].map(esc).join(",")
      ),
      ...stmtData.payments.map((p) =>
        ["Payment", p.createdAt.slice(0, 10), `Plan #${stmtData.plan.id}`, p.method, -p.amount].map(esc).join(",")
      ),
      "",
      ["", "", "", "Balance", stmtData.summary.balance].map(esc).join(","),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `statement-${stmtData.customer.name.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Statement CSV downloaded", description: `${stmtData.customer.name} • ${stmtData.invoices.length} invoices • ${stmtData.payments.length} payments` });
  };

  const submitPayment = async () => {
    if (!payPlan) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      toast({ title: "Enter a valid amount", description: "Amount must be greater than zero." });
      return;
    }
    setPayBusy(true);
    try {
      await api.patch(`/api/debt-plans/${payPlan.id}`, { action: "recordPayment", amount, method: payMethod });
      toast({
        title: `KES ${amount.toLocaleString()} received • SMS sent`,
        description: `Receipt sent to ${payPlan.customerPhone} • balance KES ${Math.max(0, payPlan.totalDebt - amount).toLocaleString()}`,
      });
      const plan = payPlan;
      setPayPlan(null);
      await load();
      // auto-print the debtor payment receipt (digital twin + QR on the slip)
      try {
        const st = await fetchStatement(plan.id);
        const payment = st?.payments.slice().sort((a, b) => b.id - a.id)[0];
        const cust = customers?.find((c) => c.id === plan.customerId);
        if (st && payment) {
          await printDebtPayment(plan, payment, plan.customerName, {
            tier: st.customer.tier,
            pointsBalance: cust?.loyaltyPoints,
            remainingBalance: st.summary.balance,
          });
        }
      } catch {
        // best effort - payment already recorded
      }
    } catch (e) {
      toast({ title: "Payment failed", description: err(e) });
    } finally {
      setPayBusy(false);
    }
  };

  const sendReminder = async (plan: PlanRow) => {
    setBusyPlanId(plan.id);
    try {
      await api.patch(`/api/debt-plans/${plan.id}`, { action: "remind" });
      toast({ title: "Reminder SMS sent", description: `Delivered to ${plan.customerPhone}` });
    } catch (e) {
      toast({ title: "Reminder failed", description: err(e) });
    } finally {
      setBusyPlanId(null);
    }
  };

  const openEdit = (plan: PlanRow) => {
    setEditPlan(plan);
    setEditForm({
      installmentType: plan.installmentType,
      installmentAmount: String(plan.installmentAmount),
      autoReminderSms: plan.autoReminderSms,
      autoBlockPosOverdue: plan.autoBlockPosOverdue,
    });
  };

  const submitEdit = async () => {
    if (!editPlan) return;
    const amount = Number(editForm.installmentAmount);
    if (!amount || amount <= 0) {
      toast({ title: "Enter a valid installment amount" });
      return;
    }
    setEditBusy(true);
    try {
      await api.patch(`/api/debt-plans/${editPlan.id}`, {
        installmentType: editForm.installmentType,
        installmentAmount: amount,
        autoReminderSms: editForm.autoReminderSms,
        autoBlockPosOverdue: editForm.autoBlockPosOverdue,
      });
      toast({ title: "Plan updated", description: `${editPlan.customerName} • ${editForm.installmentType} KES ${amount.toLocaleString()}` });
      setEditPlan(null);
      await load();
    } catch (e) {
      toast({ title: "Update failed", description: err(e) });
    } finally {
      setEditBusy(false);
    }
  };

  /* -- plan builder ----------------------------------------- */

  const buildSuggested = (total: number, n: number) =>
    total > 0 && n > 0 ? Math.ceil(total / n / 100) * 100 : 0;

  const setBuildTotal = (v: string) => {
    const total = Number(v) || 0;
    setBuildForm((f) => ({ ...f, totalDebt: v, installmentAmount: String(buildSuggested(total, f.weeks)) }));
  };
  const setBuildWeeks = (n: number) => {
    setBuildForm((f) => ({ ...f, weeks: n, installmentAmount: String(buildSuggested(Number(f.totalDebt) || 0, n)) }));
  };
  const setBuildType = (t: string) => {
    setBuildForm((f) => ({ ...f, installmentType: t, weeks: t === "Weekly" ? 4 : 6, installmentAmount: String(buildSuggested(Number(f.totalDebt) || 0, t === "Weekly" ? 4 : 6)) }));
  };
  const setBuildCustomer = (id: string) => {
    const c = (customers ?? []).find((x) => String(x.id) === id);
    const debt = c?.debtBalance ?? 0;
    setBuildForm((f) => ({ ...f, customerId: id, totalDebt: debt ? String(debt) : "", installmentAmount: debt ? String(buildSuggested(debt, f.weeks)) : "" }));
  };

  const openBuilder = () => {
    setBuildForm({ customerId: "", totalDebt: "", installmentType: "Weekly", weeks: 4, installmentAmount: "", invoiceNo: "", autoReminderSms: true, autoBlockPosOverdue: true });
    setBuilderOpen(true);
  };

  const submitBuilder = async () => {
    const totalDebt = Number(buildForm.totalDebt);
    const customerId = Number(buildForm.customerId);
    if (!customerId) {
      toast({ title: "Pick a customer", description: "Select who the payment plan is for." });
      return;
    }
    if (!totalDebt || totalDebt <= 0) {
      toast({ title: "Enter the total debt amount" });
      return;
    }
    setBuildBusy(true);
    try {
      await api.post("/api/debt-plans", {
        customerId,
        totalDebt,
        installmentType: buildForm.installmentType,
        weeks: buildForm.weeks,
        installmentAmount: Number(buildForm.installmentAmount) || undefined,
        invoiceNo: buildForm.invoiceNo.trim() || undefined,
        autoReminderSms: buildForm.autoReminderSms,
        autoBlockPosOverdue: buildForm.autoBlockPosOverdue,
      });
      const next = new Date();
      next.setDate(next.getDate() + (buildForm.installmentType === "Weekly" ? 7 : 30));
      toast({
        title: "Payment plan created",
        description: `Next due ${fmtDay(next.toISOString())} • ${buildForm.installmentType} KES ${Number(buildForm.installmentAmount || 0).toLocaleString()}`,
      });
      setBuilderOpen(false);
      await load();
    } catch (e) {
      toast({ title: "Could not create plan", description: err(e) });
    } finally {
      setBuildBusy(false);
    }
  };

  /* -- creditors -------------------------------------------- */

  const confirmCreditorPay = async () => {
    if (!payCreditor) return;
    setCreditorBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 600)); // B2C scheduling
      toast({
        title: "B2C payment scheduled",
        description: `${payCreditor.name} • KES ${payCreditor.balance.toLocaleString()} → Paybill 123456`,
      });
      setPayCreditor(null);
    } finally {
      setCreditorBusy(false);
    }
  };

  /* -- render helpers --------------------------------------- */

  const netCashflow = (s?.toCollect ?? 0) - TO_PAY_BASE;
  const netPositive = netCashflow >= 0;

  const agingMax = CREDITOR_AGING.length ? Math.max(...CREDITOR_AGING.map((a) => a.value)) : 1;

  return (
    <div>
      <ScreenHeader
        title="Debtors & Creditors"
        subtitle="Credit control • Payment plans • Aging"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={printDebtorsSummary}
              className="h-9 rounded-xl text-[13px] font-semibold"
            >
              <Printer className="h-4 w-4" /> Debtors Summary
            </Button>
            <Button onClick={openBuilder} className="h-9 rounded-xl bg-[#0052CC] px-4 text-[13px] font-semibold hover:bg-[#0041A8]">
              <Plus className="h-4 w-4" /> Payment Plan
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="debtors">
        <TabsList className="mb-4 h-10 rounded-full border border-[#DFE1E6] bg-white p-1">
          <TabsTrigger value="debtors" className="rounded-full px-5 text-[13px] font-semibold data-[state=active]:bg-[#172B4D] data-[state=active]:text-white">
            Debtors • Customers Owe Us
          </TabsTrigger>
          <TabsTrigger value="creditors" className="rounded-full px-5 text-[13px] font-semibold data-[state=active]:bg-[#172B4D] data-[state=active]:text-white">
            Creditors • We Owe Suppliers
          </TabsTrigger>
        </TabsList>

        {/* ════════════════ DEBTORS ════════════════ */}
        <TabsContent value="debtors" className="space-y-4">
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @6xl:grid-cols-5">
            <KpiCard
              icon={<HandCoins className="h-4 w-4" />}
              label="Total to collect"
              value={KES(s?.toCollect ?? 0)}
              loading={!data}
              sub={`${plans.length} active ledgers`}
            />
            <KpiCard
              icon={<TriangleAlert className="h-4 w-4" />}
              label="Overdue customers"
              value={`${s?.overdueCount ?? 0} customers`}
              loading={!data}
              sub={`KES ${(s?.overdueAmount ?? 0).toLocaleString()} past due`}
              iconBg="#FFEBEE"
              iconColor="#FF5630"
            />
            <KpiCard
              icon={<CalendarClock className="h-4 w-4" />}
              label="Aging 0-30 days"
              value={KES(s?.aging.d0_30 ?? 0)}
              loading={!data}
              sub="watch closely"
              iconBg="#FFF8E1"
              iconColor="#B8860B"
            />
            <KpiCard
              icon={<ShieldAlert className="h-4 w-4" />}
              label="Aging 60+ days"
              value={KES(s?.aging.d60plus ?? 0)}
              loading={!data}
              sub="escalate collection"
              iconBg="#FFEBEE"
              iconColor="#C62828"
            />
            <div className="col-span-2 rounded-2xl border border-[#172B4D] bg-[#172B4D] p-4 shadow-sm @2xl:col-span-1">
              <div className="flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-[#00C853]">
                  <TrendingUp className="h-4 w-4" />
                </div>
              </div>
              {data ? (
                <p className={cn("font-display mt-3 text-xl font-bold", netPositive ? "text-[#00C853]" : "text-[#FF5630]")}>
                  KES {netPositive ? "+" : "−"}{compact(netCashflow)} est
                </p>
              ) : (
                <div className="mt-3 h-7 w-28 animate-pulse rounded bg-white/20" />
              )}
              <p className="mt-0.5 text-[12px] text-white/60">Net cashflow (collect − payables)</p>
            </div>
          </div>

          {/* ══════════ receivables aging - live stacked bar + clickable buckets ══════════ */}
          <Panel className="p-4 @6xl:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E9F2FF] text-[#0052CC]">
                  <ChartNoAxesColumnIncreasing className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="font-display text-[14px] font-bold text-[#172B4D]">Receivables aging</h3>
                  <p className="text-[11px] text-[#6B778C]">Live ledger • click a bucket to filter the list below</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(filter === "cur" || filter === "b1_30" || filter === "b31_60" || filter === "b60p") && (
                  <button
                    onClick={() => setFilter("all")}
                    className="flex items-center gap-1.5 rounded-full border border-[#DFE1E6] bg-white px-3 py-1.5 text-[11px] font-bold text-[#172B4D] transition hover:border-[#B3B9C4]"
                  >
                    Filtered: {agingBuckets.buckets.find((b) => b.key === filter)?.label}
                    <X size={12} className="text-[#FF5630]" />
                  </button>
                )}
                <p className="font-display text-[15px] font-extrabold tabular-nums text-[#172B4D]">{KES(agingBuckets.total)}</p>
              </div>
            </div>

            {/* stacked bar */}
            <div className="mt-3 flex h-4 w-full gap-px overflow-hidden rounded-full bg-[#F4F5F7]">
              {agingBuckets.buckets.map((b) =>
                b.amount > 0 ? (
                  <div
                    key={b.key}
                    style={{ width: `${(b.amount / agingBuckets.total) * 100}%`, backgroundColor: b.color }}
                    className={cn(
                      "h-full transition-all duration-500",
                      filter === b.key && "ring-2 ring-[#172B4D] ring-offset-1"
                    )}
                    title={`${b.label} - ${KES(b.amount)}`}
                  />
                ) : null
              )}
            </div>

            {/* bucket rows */}
            <div className="mt-3 grid grid-cols-2 gap-2 @2xl:grid-cols-4">
              {agingBuckets.buckets.map((b) => {
                const active = filter === b.key;
                const pct = agingBuckets.total > 0 ? Math.round((b.amount / agingBuckets.total) * 100) : 0;
                return (
                  <button
                    key={b.key}
                    onClick={() => setFilter(active ? "all" : b.key)}
                    aria-pressed={active}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left transition",
                      active
                        ? "border-[#172B4D] shadow-sm"
                        : "border-[#DFE1E6] bg-white hover:border-[#B3B9C4] hover:shadow-sm"
                    )}
                    style={active ? { backgroundColor: b.bg, borderColor: b.color } : undefined}
                  >
                    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[#6B778C]">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
                      {b.label}
                      {active && <span className="ml-auto text-[9px] font-extrabold" style={{ color: b.color }}>●</span>}
                    </p>
                    <p className="font-display mt-1 text-[15px] font-extrabold tabular-nums" style={{ color: b.color }}>
                      {KES(b.amount)}
                    </p>
                    <div className="mt-1 flex items-center justify-between">
                      <p className="text-[10px] font-semibold text-[#6B778C]">
                        {b.count} ledger{b.count === 1 ? "" : "s"}
                      </p>
                      <p className="text-[10px] font-bold tabular-nums text-[#6B778C]">{pct}%</p>
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[#F4F5F7]">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: b.color }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </Panel>

          {/* filter chips */}
          <div className="flex flex-wrap gap-2">
            {([
              ["all", "All Debts"],
              ["overdue", "Overdue"],
              ["blocked", "Blocked at POS"],
              ["active", "Active plans"],
            ] as [DebtFilter, string][]).map(([key, label]) => {
              const danger = key === "overdue" && filter === "overdue";
              return (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "rounded-full border px-4 py-2 text-[12px] font-semibold transition",
                    filter === key
                      ? danger
                        ? "border-[#FFCDD2] bg-[#FFEBEE] text-[#C62828]"
                        : "border-[#172B4D] bg-[#172B4D] text-white"
                      : "border-[#DFE1E6] bg-white text-[#6B778C] hover:border-[#B3B9C4]"
                  )}
                >
                  {label} ({chipCount(key)})
                </button>
              );
            })}
          </div>

          {/* debtors table */}
          <Panel padding={false} className="overflow-hidden">
            {!data ? (
              <div className="p-4">
                <TableSkeleton rows={5} cols={6} />
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={<HandCoins className="h-6 w-6" />}
                  title="No debt plans here"
                  sub={filter === "all" ? "No customer owes anything right now - credit sales create plans automatically." : "Nothing matches this filter. Try another chip."}
                  action={
                    <Button onClick={openBuilder} className="rounded-xl bg-[#0052CC] hover:bg-[#0041A8]">
                      <Plus className="h-4 w-4" /> Create payment plan
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#FAFBFC]">
                      <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Customer</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Invoice</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Balance</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Due date</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Overdue</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Plan</TableHead>
                      <TableHead className="text-center text-[11px] uppercase tracking-widest text-[#6B778C]">Auto-SMS</TableHead>
                      <TableHead className="text-center text-[11px] uppercase tracking-widest text-[#6B778C]">Auto-block</TableHead>
                      <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((p) => (
                      <TableRow key={p.id} className="text-[12px]">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#DFE1E6] text-[11px] font-bold text-[#172B4D]">
                              {initials(p.customerName)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-[#172B4D]">{p.customerName}</p>
                              <p className="text-[11px] text-[#6B778C]">{p.customerPhone}</p>
                            </div>
                            <TierBadge tier={p.tier} />
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-[#6B778C]">{p.invoiceNo ?? "-"}</TableCell>
                        <TableCell className="font-display text-[13px] font-bold text-[#FF5630]">
                          {KES(p.totalDebt)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-[#172B4D]">{fmtDay(p.nextDueDate)}</TableCell>
                        <TableCell><OverdueBadge days={p.overdueDays} /></TableCell>
                        <TableCell>
                          <span className="inline-flex items-center rounded-full border border-[#DFE1E6] bg-[#F4F5F7] px-2.5 py-1 text-[11px] font-semibold text-[#172B4D]">
                            {p.installmentType} {(p.installmentAmount / 1000).toFixed(p.installmentAmount % 1000 === 0 ? 0 : 1)}k
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={p.autoReminderSms}
                            disabled={busyPlanId === p.id}
                            onCheckedChange={(v) => void togglePlanField(p, "autoReminderSms", v)}
                            aria-label={`Auto reminder SMS for ${p.customerName}`}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={p.autoBlockPosOverdue}
                            disabled={busyPlanId === p.id}
                            onCheckedChange={(v) => void togglePlanField(p, "autoBlockPosOverdue", v)}
                            aria-label={`Auto-block POS for ${p.customerName}`}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" className="h-7 rounded-full px-2.5" disabled={busyPlanId === p.id}>
                                {busyPlanId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuLabel className="text-[11px] text-[#6B778C]">{p.customerName}</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => openRecordPayment(p)}>
                                <HandCoins className="h-4 w-4 text-[#00C853]" /> Record payment
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void sendReminder(p)}>
                                <BellRing className="h-4 w-4 text-[#0052CC]" /> Send reminder
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEdit(p)}>
                                <CalendarClock className="h-4 w-4 text-[#B8860B]" /> Edit plan
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void openStatement(p)}>
                                <FileText className="h-4 w-4 text-[#0052CC]" /> Account statement
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void printStatementReceipt(p)} disabled={stmtReceiptBusy}>
                                <Printer className="h-4 w-4 text-[#172B4D]" /> Print statement receipt
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() =>
                                  toast({
                                    title: "Customer profile",
                                    description: `${p.customerName} (${p.customerPhone}) - open the Customers screen for the full 360° view.`,
                                  })
                                }
                              >
                                <Eye className="h-4 w-4 text-[#6B778C]" /> View customer
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Panel>
        </TabsContent>

        {/* ════════════════ CREDITORS ════════════════ */}
        <TabsContent value="creditors" className="space-y-4">
          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-3">
            <KpiCard icon={<Landmark className="h-4 w-4" />} label="Total to pay suppliers" value={KES(CREDITOR_BOOK.toPay)} sub={`${CREDITORS.filter((c) => !c.paid).length} open bills in view`} />
            <KpiCard icon={<CalendarClock className="h-4 w-4" />} label="Bills due this week" value={String(CREDITOR_BOOK.dueThisWeek)} iconBg="#FFF8E1" iconColor="#B8860B" sub="schedule B2C payouts" />
            <KpiCard icon={<HandCoins className="h-4 w-4" />} label="Active suppliers" value={String(CREDITOR_BOOK.suppliers)} iconBg="#E8F5E9" iconColor="#1B7A2E" sub="cement • paint • steel" />
          </div>

          <div className="grid grid-cols-1 gap-4 @6xl:grid-cols-3">
            {/* bills table */}
            <Panel padding={false} className="overflow-hidden @6xl:col-span-2">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#FAFBFC]">
                      <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Supplier</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Bill</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Amount</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Balance</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Due</TableHead>
                      <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {CREDITORS.map((c) => (
                      <TableRow key={c.id} className="text-[13px]">
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0052CC] text-[12px] font-bold text-white">
                              {c.name[0]}
                            </span>
                            <div>
                              <p className="font-semibold text-[#172B4D]">{c.name}</p>
                              <Badge variant="outline" className="h-5 rounded-full border-[#DFE1E6] px-2 text-[10px] font-semibold text-[#6B778C]">
                                {c.terms}
                              </Badge>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-[#6B778C]">{c.billNo}</TableCell>
                        <TableCell className="whitespace-nowrap text-[#172B4D]">{KES(c.amount)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {c.paid ? (
                            <span className="rounded-full bg-[#E8F5E9] px-2.5 py-1 text-[11px] font-bold text-[#1B7A2E]">Paid</span>
                          ) : (
                            <span className="font-display font-bold text-[#FF5630]">{KES(c.balance)}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {c.paid ? (
                            <span className="text-[11px] text-[#6B778C]">settled</span>
                          ) : c.overdueDays > 0 ? (
                            <OverdueBadge days={c.overdueDays} />
                          ) : (
                            <span className="whitespace-nowrap text-[#172B4D]">{c.due}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {c.paid ? (
                            <span className="text-[11px] font-semibold text-[#1B7A2E]">✓ Settled</span>
                          ) : (
                            <Button
                              onClick={() => setPayCreditor(c)}
                              className="h-8 rounded-full bg-[#00C853] px-3 text-[11px] font-bold text-white hover:bg-[#00A844]"
                            >
                              <Smartphone className="h-3.5 w-3.5" /> Pay M-Pesa
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Panel>

            {/* aging mini-bars */}
            <Panel className="h-fit">
              <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Payables aging</h3>
              <p className="mt-0.5 text-[12px] text-[#6B778C]">Supplier book by bucket</p>
              <div className="mt-4 space-y-3.5">
                {CREDITOR_AGING.map((a) => (
                  <div key={a.label}>
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-[#172B4D]">{a.label}</span>
                      <span className={cn("font-bold", a.value > 100000 ? "text-[#FF5630]" : "text-[#6B778C]")}>
                        {KES(a.value)}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#F4F5F7]">
                      <div
                        className={cn("h-full rounded-full", a.value > 100000 ? "bg-[#FF5630]" : "bg-[#0052CC]")}
                        style={{ width: `${agingMax ? Math.max(4, (a.value / agingMax) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3 text-[11px] leading-relaxed text-[#6B778C]">
                B2C payouts run on <span className="font-semibold text-[#172B4D]">M-Pesa Paybill 123456</span>. Overdue supplier bills block new stock POs in v2.5.
              </div>
            </Panel>
          </div>
        </TabsContent>
      </Tabs>

      {/* ══════════ Record Payment dialog ══════════ */}
      <Dialog open={!!payPlan} onOpenChange={(o) => !o && setPayPlan(null)}>
        <DialogContent className="rounded-[20px] sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="font-display">Record payment</DialogTitle>
            <DialogDescription>
              {payPlan ? `${payPlan.customerName} owes KES ${payPlan.totalDebt.toLocaleString()} • next due ${fmtDay(payPlan.nextDueDate)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="pay-amount" className="text-[12px] font-semibold text-[#172B4D]">Amount received (KES)</Label>
            <Input
              id="pay-amount"
              type="number"
              min={1}
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              placeholder="0"
              className="h-11 rounded-xl text-lg font-bold"
            />
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold text-[#172B4D]">Payment method</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="M-Pesa">M-Pesa</SelectItem>
                  <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                  <SelectItem value="Cheque">Cheque</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-[#6B778C]">Shown on the printable payment receipt (RCP-D).</p>
            </div>
            <div className="flex gap-2">
              {[0.25, 0.5, 1].map((f) => (
                <button
                  key={f}
                  onClick={() => payPlan && setPayAmount(String(Math.round(payPlan.installmentAmount * f)))}
                  className="flex-1 rounded-xl border border-[#DFE1E6] bg-[#F4F5F7] py-2 text-[11px] font-bold text-[#172B4D] hover:border-[#0052CC] hover:text-[#0052CC]"
                >
                  {f === 1 ? "100%" : `${f * 100}%`} • {payPlan ? Math.round(payPlan.installmentAmount * f).toLocaleString() : 0}
                </button>
              ))}
            </div>
            {payPlan && Number(payAmount) > 0 && (
              <div className="rounded-xl border border-[#C8E6C9] bg-[#E8F5E9] p-3 text-[12px] font-semibold text-[#1B7A2E]">
                Remaining after payment: KES {Math.max(0, payPlan.totalDebt - Number(payAmount)).toLocaleString()}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayPlan(null)} className="rounded-xl">Cancel</Button>
            <Button onClick={() => void submitPayment()} disabled={payBusy} className="rounded-xl bg-[#00C853] font-semibold text-white hover:bg-[#00A844]">
              {payBusy && <Loader2 className="h-4 w-4 animate-spin" />} Receive & SMS receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════ Edit Plan dialog ══════════ */}
      <Dialog open={!!editPlan} onOpenChange={(o) => !o && setEditPlan(null)}>
        <DialogContent className="rounded-[20px] sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="font-display">Edit payment plan</DialogTitle>
            <DialogDescription>{editPlan ? `${editPlan.customerName} • balance ${KES(editPlan.totalDebt)}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold text-[#172B4D]">Installment type</Label>
                <Select value={editForm.installmentType} onValueChange={(v) => setEditForm((f) => ({ ...f, installmentType: v }))}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Weekly">Weekly</SelectItem>
                    <SelectItem value="Monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-amount" className="text-[12px] font-semibold text-[#172B4D]">Amount (KES)</Label>
                <Input
                  id="edit-amount"
                  type="number"
                  min={100}
                  value={editForm.installmentAmount}
                  onChange={(e) => setEditForm((f) => ({ ...f, installmentAmount: e.target.value }))}
                  className="h-10 rounded-xl"
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
              <div>
                <p className="text-[12px] font-semibold text-[#172B4D]">Auto reminder SMS</p>
                <p className="text-[11px] text-[#6B778C]">Sent 1 day before due date</p>
              </div>
              <Switch checked={editForm.autoReminderSms} onCheckedChange={(v) => setEditForm((f) => ({ ...f, autoReminderSms: v }))} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
              <div>
                <p className="text-[12px] font-semibold text-[#172B4D]">Auto-block POS when overdue &gt; 7 days</p>
                <p className="text-[11px] text-[#6B778C]">Blocks new credit sales at the till</p>
              </div>
              <Switch checked={editForm.autoBlockPosOverdue} onCheckedChange={(v) => setEditForm((f) => ({ ...f, autoBlockPosOverdue: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPlan(null)} className="rounded-xl">Cancel</Button>
            <Button onClick={() => void submitEdit()} disabled={editBusy} className="rounded-xl bg-[#0052CC] font-semibold hover:bg-[#0041A8]">
              {editBusy && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════ Account Statement dialog (printable A4) ══════════ */}
      <Dialog open={!!stmtPlan} onOpenChange={(o) => !o && setStmtPlan(null)}>
        <DialogContent className="rounded-[20px] sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle className="font-display">Account statement</DialogTitle>
            <DialogDescription>
              {stmtPlan ? `${stmtPlan.customerName} • plan #${stmtPlan.id} • ${stmtPlan.installmentType.toLowerCase()} installments` : ""}
            </DialogDescription>
          </DialogHeader>

          {stmtLoading || !stmtData ? (
            <div className="flex h-56 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-[#0052CC]" />
            </div>
          ) : (
            <>
              <div className="df-scroll max-h-[60vh] overflow-y-auto pr-1">
                {/* the sheet - printable A4 area */}
                <div className="df-print-area df-print-area-a4 df-statement overflow-hidden rounded-xl border border-[#DFE1E6] shadow-sm">
                  {/* navy gradient header band */}
                  <div className="flex items-center justify-between bg-gradient-to-r from-[#0052CC] to-[#003d99] px-6 py-4 text-white">
                    <div>
                      <p className="font-display text-[16px] font-bold">DukaFlow Ltd</p>
                      <p className="text-[11px] text-white/80">Thika Road, Nairobi • +254 700 123 456</p>
                      <p className="font-mono text-[10px] text-white/70">KRA PIN: P051234567A</p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-[14px] font-bold tracking-wide">ACCOUNT STATEMENT</p>
                      <p className="text-[11px] text-white/80">
                        Generated {new Date(stmtData.summary.generatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      </p>
                    </div>
                  </div>

                  {/* customer + plan summary */}
                  <div className="grid grid-cols-2 gap-4 px-6 py-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Billed to</p>
                      <p className="font-display mt-1 text-[14px] font-bold text-[#172B4D]">{stmtData.customer.name}</p>
                      <p className="font-mono text-[12px] text-[#6B778C]">{stmtData.customer.phone}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <TierBadge tier={stmtData.customer.tier} />
                        {stmtData.summary.oldestInvoiceAgeDays > 60 && (
                          <span className="rounded-full bg-[#FFEBEE] px-2 py-0.5 text-[10px] font-bold text-[#C62828]">
                            Oldest {stmtData.summary.oldestInvoiceAgeDays}d
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1 text-right text-[12px]">
                      <p className="text-[#6B778C]">
                        Installment:{" "}
                        <b className="text-[#172B4D]">
                          {KES(stmtData.plan.installmentAmount)} / {stmtData.plan.installmentType.toLowerCase()}
                        </b>
                      </p>
                      <p className="text-[#6B778C]">
                        Next due: <b className="text-[#172B4D]">{fmtDay(stmtData.plan.nextDueDate)}</b>
                      </p>
                      <p className="text-[#6B778C]">
                        Credit limit: <b className="text-[#172B4D]">{KES(stmtData.summary.creditLimit, true)}</b>
                      </p>
                      <p className="text-[#6B778C]">
                        Available credit: <b className="text-[#1B7A2E]">{KES(stmtData.summary.availableCredit, true)}</b>
                      </p>
                    </div>
                  </div>

                  {/* balance hero */}
                  <div className="mx-6 mb-4 flex items-center justify-between rounded-xl bg-[#172B4D] px-5 py-3 text-white">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">Balance due</p>
                      <p className="font-display text-[22px] font-bold">{KES(stmtData.summary.balance)}</p>
                    </div>
                    <div className="text-right text-[11px] text-white/80">
                      <p>Invoiced {KES(stmtData.summary.invoicedTotal, true)}</p>
                      <p>Paid <span className="text-[#7DE8A2]">−{KES(stmtData.summary.paidTotal, true)}</span></p>
                      <p className={cn("font-bold", stmtData.plan.overdueDays > 7 ? "text-[#FF8A80]" : "text-white")}>
                        {stmtData.plan.overdueDays > 0 ? `${stmtData.plan.overdueDays} days overdue` : "Not overdue"}
                      </p>
                    </div>
                  </div>

                  {/* invoices */}
                  <div className="px-6 pb-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Credit invoices</p>
                    <table className="mt-2 w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-[#DFE1E6] text-left text-[10px] uppercase tracking-wider text-[#6B778C]">
                          <th className="py-1.5 font-semibold">Invoice</th>
                          <th className="py-1.5 font-semibold">Date</th>
                          <th className="py-1.5 font-semibold">KRA</th>
                          <th className="py-1.5 text-right font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stmtData.invoices.length === 0 ? (
                          <tr><td colSpan={4} className="py-2 text-[11px] text-[#6B778C]">No credit invoices on record.</td></tr>
                        ) : (
                          stmtData.invoices.map((i) => (
                            <tr key={i.id} className="border-b border-[#F4F5F7]">
                              <td className="py-1.5 font-mono font-semibold text-[#172B4D]">{i.receiptNo}</td>
                              <td className="py-1.5 text-[#6B778C]">{fmtDay(i.createdAt)}</td>
                              <td className="py-1.5">
                                <KraBadge status={i.status} />
                              </td>
                              <td className="py-1.5 text-right font-bold text-[#172B4D]">{KES(i.total)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* payments ledger */}
                  <div className="px-6 pb-4">
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Payments received</p>
                    <table className="mt-2 w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-[#DFE1E6] text-left text-[10px] uppercase tracking-wider text-[#6B778C]">
                          <th className="py-1.5 font-semibold">Date</th>
                          <th className="py-1.5 font-semibold">Method</th>
                          <th className="py-1.5 font-semibold">Note</th>
                          <th className="py-1.5 text-right font-semibold">Amount</th>
                          <th className="py-1.5 text-right font-semibold">Rcpt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stmtData.payments.length === 0 ? (
                          <tr><td colSpan={5} className="py-2 text-[11px] text-[#6B778C]">No payments recorded yet.</td></tr>
                        ) : (
                          stmtData.payments.map((p) => (
                            <tr key={p.id} className="border-b border-[#F4F5F7]">
                              <td className="py-1.5 text-[#6B778C]">{fmtDay(p.createdAt)}</td>
                              <td className="py-1.5 font-semibold text-[#172B4D]">{p.method}</td>
                              <td className="max-w-[160px] truncate py-1.5 text-[11px] text-[#6B778C]">{p.note ?? "-"}</td>
                              <td className="py-1.5 text-right font-bold text-[#1B7A2E]">−{KES(p.amount)}</td>
                              <td className="py-1.5 text-right">
                                <button
                                  onClick={() =>
                                    void printDebtPayment(
                                      { id: stmtData.plan.id, invoiceNo: stmtData.plan.invoiceNo },
                                      p,
                                      stmtData.customer.name,
                                      { tier: stmtData.customer.tier, remainingBalance: stmtData.summary.balance }
                                    )
                                  }
                                  title={`Print payment receipt RCP-D-${p.id}`}
                                  aria-label={`Print receipt for payment RCP-D-${p.id}`}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#DFE1E6] bg-white text-[#172B4D] transition hover:border-[#0052CC] hover:text-[#0052CC]"
                                >
                                  <Printer size={13} />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* footer */}
                  <div className="border-t border-dashed border-[#DFE1E6] px-6 py-3 text-[10px] text-[#6B778C]">
                    This statement is generated by DukaFlow ERP and reflects the account position at the time of printing.
                    Questions? Call +254 700 123 456 or email accounts@dukaflow.co.ke - Asante!
                  </div>
                </div>
              </div>

              <DialogFooter className="mt-1 gap-2">
                <Button variant="outline" onClick={downloadStatementCsv} className="rounded-xl">
                  <Download className="h-4 w-4" /> CSV
                </Button>
                <Button
                  variant="outline"
                  onClick={() => stmtPlan && void printStatementReceipt(stmtPlan)}
                  disabled={stmtReceiptBusy}
                  className="rounded-xl"
                >
                  {stmtReceiptBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />} Statement Receipt
                </Button>
                <Button
                  onClick={() => void openStatementEmail()}
                  className="rounded-xl border border-[#C5CAE9] bg-[#E8EAF6] text-[13px] font-semibold text-[#283593] hover:bg-[#DCDFF5]"
                >
                  <Mail className="h-4 w-4" /> Email statement
                </Button>
                <Button
                  onClick={printStatement}
                  disabled={stmtBusy}
                  className="rounded-xl bg-[#0052CC] font-semibold hover:bg-[#0041A8]"
                >
                  {stmtBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Print / Save PDF
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ══════════ Statement email dialog ══════════ */}
      <Dialog open={stmtEmailOpen} onOpenChange={setStmtEmailOpen}>
        <DialogContent className="rounded-2xl sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-[15px] font-bold text-[#172B4D]">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8EAF6] text-[#283593]">
                <Mail size={15} />
              </span>
              Email account statement
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              Sends the full statement (invoices, payments, balance) to the debtor - mock mailer, audited in Messages.
            </DialogDescription>
          </DialogHeader>

          {stmtEmailLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-[#6B778C]">
              <Loader2 size={14} className="animate-spin" /> Preparing statement email…
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="stmt-email-to" className="text-[10px] font-bold uppercase tracking-wide text-[#6B778C]">
                  To
                </Label>
                <Input
                  id="stmt-email-to"
                  value={stmtEmailTo}
                  onChange={(e) => setStmtEmailTo(e.target.value)}
                  placeholder="customer@email.com"
                  type="email"
                  className="h-9 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px]"
                />
                <p className="text-[10px] text-[#6B778C]">
                  {stmtData?.customer.email
                    ? "Customer has an email on file - the address you send to will be kept for future statements."
                    : `No email on file for ${stmtData?.customer.name ?? "this customer"} - the address you send to will be saved.`}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-wide text-[#6B778C]">Subject</Label>
                <p className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-3 py-2 text-[12px] font-semibold text-[#172B4D]">
                  {stmtEmailSubject}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-wide text-[#6B778C]">Preview</Label>
                <pre className="df-scroll max-h-[220px] overflow-auto whitespace-pre-wrap rounded-xl border border-[#DFE1E6] bg-white p-3 font-mono text-[11px] leading-relaxed text-[#172B4D]">
                  {stmtEmailBody}
                </pre>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setStmtEmailOpen(false)} className="h-9 rounded-xl text-[12px] font-bold text-[#172B4D]">
              Cancel
            </Button>
            <Button
              disabled={stmtEmailLoading || stmtEmailSending || !stmtEmailTo.trim() || !stmtPlan}
              onClick={() => void sendStatementEmail()}
              className="h-9 rounded-xl bg-[#283593] px-5 text-[12px] font-bold text-white hover:bg-[#1A237E]"
            >
              {stmtEmailSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send statement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════ Payment Plan builder ══════════ */}
      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="rounded-[20px] sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="font-display">New payment plan</DialogTitle>
            <DialogDescription>Spread a customer&apos;s debt into scheduled installments with automations.</DialogDescription>
          </DialogHeader>
          <div className="rounded-2xl border border-[#DFE1E6] bg-[#FAFBFC] p-4">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold text-[#172B4D]">Customer</Label>
                <Select value={buildForm.customerId} onValueChange={setBuildCustomer}>
                  <SelectTrigger className="h-10 rounded-xl bg-white"><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>
                    {(customers ?? []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name} - {KES(c.debtBalance)} debt
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="build-debt" className="text-[12px] font-semibold text-[#172B4D]">Total debt (KES)</Label>
                  <Input id="build-debt" type="number" min={100} value={buildForm.totalDebt} onChange={(e) => setBuildTotal(e.target.value)} placeholder="0" className="h-10 rounded-xl bg-white" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-semibold text-[#172B4D]">Installment type</Label>
                  <Select value={buildForm.installmentType} onValueChange={setBuildType}>
                    <SelectTrigger className="h-10 rounded-xl bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Weekly">Weekly</SelectItem>
                      <SelectItem value="Monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] font-semibold text-[#172B4D]">
                    Clear in {buildForm.weeks} {buildForm.installmentType === "Weekly" ? "weeks" : "months"}
                  </Label>
                  <span className="rounded-full bg-[#E9F2FF] px-2 py-0.5 text-[11px] font-bold text-[#0052CC]">
                    ≈ {buildForm.installmentType === "Weekly" ? `${buildForm.weeks} × 7d` : `${buildForm.weeks} × 30d`}
                  </span>
                </div>
                <Slider value={[buildForm.weeks]} min={1} max={24} step={1} onValueChange={(v) => setBuildWeeks(v[0] ?? buildForm.weeks)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="build-installment" className="text-[12px] font-semibold text-[#172B4D]">Installment (KES)</Label>
                  <Input
                    id="build-installment"
                    type="number"
                    min={100}
                    value={buildForm.installmentAmount}
                    onChange={(e) => setBuildForm((f) => ({ ...f, installmentAmount: e.target.value }))}
                    className="h-10 rounded-xl border-[#0052CC] bg-white font-bold text-[#0052CC]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="build-invoice" className="text-[12px] font-semibold text-[#172B4D]">Invoice no (optional)</Label>
                  <Input id="build-invoice" value={buildForm.invoiceNo} onChange={(e) => setBuildForm((f) => ({ ...f, invoiceNo: e.target.value }))} placeholder="INV-2847" className="h-10 rounded-xl bg-white font-mono text-[12px]" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-[#DFE1E6] bg-white p-3">
                <div>
                  <p className="text-[12px] font-semibold text-[#172B4D]">Auto reminder SMS (1 day before due)</p>
                  <p className="text-[11px] text-[#6B778C]">Raven SMS • costs ~KES 1 each</p>
                </div>
                <Switch checked={buildForm.autoReminderSms} onCheckedChange={(v) => setBuildForm((f) => ({ ...f, autoReminderSms: v }))} />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-[#DFE1E6] bg-white p-3">
                <div>
                  <p className="text-[12px] font-semibold text-[#172B4D]">Auto-block POS when overdue &gt; 7 days</p>
                  <p className="text-[11px] text-[#6B778C]">Manager override available at till</p>
                </div>
                <Switch checked={buildForm.autoBlockPosOverdue} onCheckedChange={(v) => setBuildForm((f) => ({ ...f, autoBlockPosOverdue: v }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuilderOpen(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={() => void submitBuilder()} disabled={buildBusy} className="rounded-xl bg-[#0052CC] font-semibold hover:bg-[#0041A8]">
              {buildBusy && <Loader2 className="h-4 w-4 animate-spin" />} Create plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════ Supplier B2C confirm ══════════ */}
      <Dialog open={!!payCreditor} onOpenChange={(o) => !o && setPayCreditor(null)}>
        <DialogContent className="rounded-[20px] sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="font-display">Pay supplier via M-Pesa B2C</DialogTitle>
            <DialogDescription>
              {payCreditor ? `${payCreditor.name} • ${payCreditor.billNo} • balance KES ${payCreditor.balance.toLocaleString()}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-[#C8E6C9] bg-[#E8F5E9] p-3 text-[12px] font-semibold text-[#1B7A2E]">
            B2C transfer of KES {payCreditor?.balance.toLocaleString() ?? 0} → Paybill 123456. A journal entry is posted automatically.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayCreditor(null)} className="rounded-xl">Cancel</Button>
            <Button onClick={() => void confirmCreditorPay()} disabled={creditorBusy} className="rounded-xl bg-[#00C853] font-semibold text-white hover:bg-[#00A844]">
              {creditorBusy && <Loader2 className="h-4 w-4 animate-spin" />} Confirm payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* hidden receipt print host (portaled to body, revealed by printReceiptArea) */}
      <ReceiptPrintHost docs={printDocs} mode={printMode} />
    </div>
  );
}
