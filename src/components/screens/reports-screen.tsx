"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2, CalendarClock, ChartColumn, Download, HandCoins, Landmark,
  Package, PieChart as PieChartIcon, Plus, RefreshCw, Smartphone, TrendingDown, TrendingUp, Users, Wallet,
} from "lucide-react";
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { useApp } from "@/lib/store";
import { KES, SettingsDto } from "@/types";
import { Panel, ScreenHeader, TableSkeleton } from "@/components/df/shared";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

/* -- contracts ----------------------------------------------- */

interface StockAgingBucket {
  bucket: string;
  from: number;
  to: number | null;
  color: string;
  value: number;
  qty: number;
  items: number;
  topItems: { name: string; emoji: string; qty: number; value: number; ageDays: number; store: string }[];
}

interface ReportsPayload {
  salesByStore: { store: string; total: number; count: number }[];
  salesByStaff: { staff: string; total: number; count: number }[];
  paySplit: { method: string; total: number }[];
  kra: { status: string; count: number }[];
  topProducts: { name: string; emoji: string; qty: number; total: number }[];
  debtorAging: { current: number; d0_30: number; d31_60: number; d60plus: number };
  loyalty: { earned: number; redeemed: number };
  daily: { day: string; revenue: number; profit: number }[];
  stockAging: { buckets: StockAgingBucket[]; totalValue: number };
  generatedAt: string;
}

/* Operating expenses (petty cash, bills) - served by /api/expenses */
interface ExpRow {
  id: number; storeId: number; storeName: string; category: string; note: string;
  amount: number; paidVia: string; refNo: string | null; staffName: string; spentAt: string;
}
interface ExpPayload {
  expenses: ExpRow[];
  summary: { total: number; today: number; month: number; count: number; byCategory: { category: string; amount: number }[] };
}

const EXP_CATEGORIES = ["Rent", "Electricity", "Salaries", "Transport", "Supplies", "Marketing", "Repairs", "Other"];
type ReportId = "store" | "pnl" | "stock" | "debtors" | "loyalty" | "staff" | "kra" | "mpesa" | "expenses";

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

const REPORTS: { id: ReportId; title: string; desc: string; icon: typeof ChartColumn }[] = [
  { id: "store", title: "Sales by Store", desc: "Thika Road vs Kiambu Road", icon: Building2 },
  { id: "pnl", title: "Profit & Loss", desc: "Revenue vs est. profit, last 7 days", icon: TrendingUp },
  { id: "stock", title: "Stock Aging", desc: "Inventory age buckets", icon: Package },
  { id: "debtors", title: "Debtor Aging", desc: "Aging buckets + overdue exposure", icon: HandCoins },
  { id: "loyalty", title: "Loyalty Redemption", desc: "Points earned vs redeemed", icon: PieChartIcon },
  { id: "staff", title: "Staff Performance", desc: "Sales per staff this week", icon: Users },
  { id: "kra", title: "KRA eTIMS Submissions", desc: "Verified vs pending invoices", icon: Landmark },
  { id: "mpesa", title: "M-Pesa Reconciliation", desc: "Mobile money vs cash trend", icon: Smartphone },
  { id: "expenses", title: "Operating Expenses", desc: "Petty cash, bills, rent & net P&L", icon: Wallet },
];

const rel = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return "-";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const compact = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n));

const kesTooltip = (v: number | string) => KES(Number(v));

/* -- screen -------------------------------------------------- */

export default function ReportsScreen() {
  const [data, setData] = useState<ReportsPayload | null>(null);
  const [exp, setExp] = useState<ExpPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<ReportId | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<ReportsPayload>("/api/reports"));
    } catch (e) {
      toast({ title: "Could not load reports", description: err(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadExp = useCallback(async () => {
    try {
      setExp(await api.get<ExpPayload>("/api/expenses?days=30"));
    } catch {
      setExp(null);
    }
  }, []);

  useEffect(() => {
    // async boundary: the loaders touch state, so never call them synchronously here
    const t = setTimeout(() => {
      void load();
      void loadExp();
    }, 0);
    return () => clearTimeout(t);
  }, [load, loadExp]);

  /* derived datasets --------------------------------------- */

  /* stock aging - REAL server data (StockLevel.receivedAt × qty × cost) */
  const stockAging = useMemo(() => {
    const b = data?.stockAging.buckets;
    return [
      { bucket: "0-30 days", value: b?.[0]?.value ?? 0, color: "#00C853", qty: b?.[0]?.qty ?? 0, items: b?.[0]?.items ?? 0 },
      { bucket: "31-60 days", value: b?.[1]?.value ?? 0, color: "#FFAB00", qty: b?.[1]?.qty ?? 0, items: b?.[1]?.items ?? 0 },
      { bucket: "61-90 days", value: b?.[2]?.value ?? 0, color: "#FF5630", qty: b?.[2]?.qty ?? 0, items: b?.[2]?.items ?? 0 },
      { bucket: "90+ days", value: b?.[3]?.value ?? 0, color: "#B71C1C", qty: b?.[3]?.qty ?? 0, items: b?.[3]?.items ?? 0 },
    ];
  }, [data]);

  const stockAgingItems = data?.stockAging.buckets ?? [];

  const debtorRows = useMemo(() => {
    const a = data?.debtorAging;
    return [
      { bucket: "Current", value: a?.current ?? 0, color: "#00C853" },
      { bucket: "1-30 days", value: a?.d0_30 ?? 0, color: "#FFAB00" },
      { bucket: "31-60 days", value: a?.d31_60 ?? 0, color: "#FF5630" },
      { bucket: "60+ days", value: a?.d60plus ?? 0, color: "#B71C1C" },
    ];
  }, [data]);

  const loyaltyRows = useMemo(
    () => [
      { name: "Earned", value: data?.loyalty.earned ?? 0, color: "#0052CC" },
      { name: "Redeemed", value: data?.loyalty.redeemed ?? 0, color: "#00C853" },
    ],
    [data]
  );

  const kraRows = useMemo(() => {
    const rows = data?.kra ?? [];
    const verified = rows.find((r) => r.status === "Verified")?.count ?? 0;
    const pending = rows.filter((r) => r.status !== "Verified").reduce((a, r) => a + r.count, 0);
    return [
      { name: "Verified", value: verified, color: "#00C853" },
      { name: "Pending", value: pending, color: "#FFAB00" },
    ];
  }, [data]);

  const mpesaRows = useMemo(() => {
    if (!data) return [];
    const total = data.paySplit.reduce((a, p) => a + p.total, 0) || 1;
    const mpesaShare = (data.paySplit.find((p) => p.method === "M-Pesa")?.total ?? 0) / total;
    const cashShare = (data.paySplit.find((p) => p.method === "Cash")?.total ?? 0) / total;
    return data.daily.map((d) => ({
      day: d.day,
      mpesa: Math.round(d.revenue * mpesaShare),
      cash: Math.round(d.revenue * cashShare),
      other: Math.round(d.revenue * (1 - mpesaShare - cashShare)),
    }));
  }, [data]);

  /* per-report table (drill-down + CSV) -------------------- */

  const tableFor = useCallback(
    (id: ReportId): { cols: string[]; rows: (string | number)[][] } => {
      const d = data;
      if (!d) return { cols: [], rows: [] };
      switch (id) {
        case "store":
          return {
            cols: ["Store", "Sales (KES)", "Transactions"],
            rows: d.salesByStore.map((r) => [r.store, r.total, r.count]),
          };
        case "pnl":
          return {
            cols: ["Day", "Revenue (KES)", "Profit (KES)", "Margin"],
            rows: d.daily.map((r) => [
              r.day, r.revenue, r.profit,
              r.revenue > 0 ? `${Math.round((r.profit / r.revenue) * 100)}%` : "-",
            ]),
          };
        case "stock":
          return {
            cols: ["Age bucket", "Units", "SKUs", "Stock value (KES)"],
            rows: stockAging.map((r) => [r.bucket, r.qty, r.items, r.value]),
          };
        case "debtors":
          return {
            cols: ["Aging bucket", "Outstanding (KES)"],
            rows: debtorRows.map((r) => [r.bucket, r.value]),
          };
        case "loyalty":
          return {
            cols: ["Metric", "Points", "KES value (@1pt = KES 1)"],
            rows: loyaltyRows.map((r) => [r.name, r.value, r.value]),
          };
        case "staff":
          return {
            cols: ["Staff", "Sales (KES)", "Transactions", "Avg sale (KES)"],
            rows: d.salesByStaff.map((r) => [r.staff, r.total, r.count, r.count ? Math.round(r.total / r.count) : 0]),
          };
        case "kra":
          return {
            cols: ["eTIMS status", "Invoices"],
            rows: kraRows.map((r) => [r.name, r.value]),
          };
        case "mpesa":
          return {
            cols: ["Day", "M-Pesa (KES)", "Cash (KES)", "Other (KES)"],
            rows: mpesaRows.map((r) => [r.day, r.mpesa, r.cash, r.other]),
          };
        case "expenses":
          return {
            cols: ["Category", "Spend (KES)", "Share of 30-day total"],
            rows: (exp?.summary.byCategory ?? []).map((c) => [
              c.category, c.amount,
              exp?.summary.total ? `${Math.round((c.amount / exp.summary.total) * 100)}%` : "-",
            ]),
          };
      }
    },
    [data, stockAging, debtorRows, loyaltyRows, kraRows, mpesaRows, exp]
  );

  const exportCsv = (id: ReportId) => {
    const { cols, rows } = tableFor(id);
    const esc = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
    const csv = [cols.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `dukaflow-${id}-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Report exported", description: `dukaflow-${id}-report.csv saved to downloads.` });
  };

  /* mini chart renderer (h-24, no axes) -------------------- */

  const miniChart = (id: ReportId) => {
    if (!data) return null;
    switch (id) {
      case "store":
        return (
          <ResponsiveContainer width="100%" height={96}>
            <BarChart data={data.salesByStore}>
              <Tooltip formatter={kesTooltip} cursor={{ fill: "rgba(0,82,204,0.06)" }} />
              <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                {data.salesByStore.map((_, i) => (
                  <Cell key={i} fill={i % 2 === 0 ? "#0052CC" : "#00C853"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );
      case "pnl":
        return (
          <ResponsiveContainer width="100%" height={96}>
            <ComposedChart data={data.daily}>
              <Tooltip formatter={kesTooltip} />
              <Area dataKey="revenue" stroke="#0052CC" fill="#0052CC" fillOpacity={0.14} strokeWidth={2} />
              <Line dataKey="profit" stroke="#00C853" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        );
      case "stock":
        return (
          <ResponsiveContainer width="100%" height={96}>
            <BarChart data={stockAging}>
              <Tooltip formatter={kesTooltip} cursor={{ fill: "rgba(107,119,140,0.08)" }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {stockAging.map((r, i) => (
                  <Cell key={i} fill={r.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );
      case "debtors":
        return (
          <ResponsiveContainer width="100%" height={96}>
            <BarChart data={debtorRows.slice(1)}>
              <Tooltip formatter={kesTooltip} cursor={{ fill: "rgba(255,86,48,0.06)" }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {debtorRows.slice(1).map((r, i) => (
                  <Cell key={i} fill={r.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );
      case "loyalty":
        return (
          <ResponsiveContainer width="100%" height={96}>
            <PieChart>
              <Tooltip formatter={kesTooltip} />
              <Pie data={loyaltyRows} dataKey="value" innerRadius={26} outerRadius={44} paddingAngle={3} strokeWidth={0}>
                {loyaltyRows.map((r, i) => (
                  <Cell key={i} fill={r.color} />
                ))}
              </Pie>
              <Legend iconSize={7} wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        );
      case "staff":
        return (
          <ResponsiveContainer width="100%" height={96}>
            <BarChart data={data.salesByStaff} layout="vertical">
              <Tooltip formatter={kesTooltip} cursor={{ fill: "rgba(0,82,204,0.06)" }} />
              <Bar dataKey="total" fill="#0052CC" radius={[0, 6, 6, 0]} barSize={12} />
            </BarChart>
          </ResponsiveContainer>
        );
      case "kra":
        return (
          <ResponsiveContainer width="100%" height={96}>
            <PieChart>
              <Tooltip formatter={(v: number | string) => `${v} invoices`} />
              <Pie data={kraRows} dataKey="value" innerRadius={26} outerRadius={44} paddingAngle={3} strokeWidth={0}>
                {kraRows.map((r, i) => (
                  <Cell key={i} fill={r.color} />
                ))}
              </Pie>
              <Legend iconSize={7} wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        );
      case "mpesa":
        return (
          <ResponsiveContainer width="100%" height={96}>
            <LineChart data={mpesaRows}>
              <Tooltip formatter={kesTooltip} />
              <Line dataKey="mpesa" stroke="#00C853" strokeWidth={2} dot={false} />
              <Line dataKey="cash" stroke="#0052CC" strokeWidth={2} dot={false} />
              <Line dataKey="other" stroke="#FFAB00" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        );
      case "expenses":
        return (
          <ResponsiveContainer width="100%" height={96}>
            <BarChart data={exp?.summary.byCategory.slice(0, 5) ?? []} layout="vertical">
              <Tooltip formatter={kesTooltip} cursor={{ fill: "rgba(255,86,48,0.06)" }} />
              <Bar dataKey="amount" fill="#FF5630" radius={[0, 6, 6, 0]} barSize={10} />
            </BarChart>
          </ResponsiveContainer>
        );
    }
  };

  /* big chart for the drill-down dialog (with axes) -------- */

  const bigChart = (id: ReportId) => {
    if (!data) return null;
    const axis = { fontSize: 10, fill: "#6B778C" };
    switch (id) {
      case "store":
        return (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.salesByStore}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DFE1E6" vertical={false} />
              <XAxis dataKey="store" tick={axis} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={compact} />
              <Tooltip formatter={kesTooltip} cursor={{ fill: "rgba(0,82,204,0.06)" }} />
              <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                {data.salesByStore.map((_, i) => (
                  <Cell key={i} fill={i % 2 === 0 ? "#0052CC" : "#00C853"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );
      case "pnl":
        return (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DFE1E6" vertical={false} />
              <XAxis dataKey="day" tick={axis} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={compact} />
              <Tooltip formatter={kesTooltip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area dataKey="revenue" name="Revenue" stroke="#0052CC" fill="#0052CC" fillOpacity={0.14} strokeWidth={2} />
              <Line dataKey="profit" name="Profit (est.)" stroke="#00C853" strokeWidth={2} dot />
            </ComposedChart>
          </ResponsiveContainer>
        );
      case "stock":
        return (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stockAging}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DFE1E6" vertical={false} />
              <XAxis dataKey="bucket" tick={axis} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={compact} />
              <Tooltip formatter={kesTooltip} cursor={{ fill: "rgba(107,119,140,0.08)" }} />
              <Bar dataKey="value" name="Stock value" radius={[6, 6, 0, 0]}>
                {stockAging.map((r, i) => (
                  <Cell key={i} fill={r.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );
      case "debtors":
        return (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={debtorRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DFE1E6" vertical={false} />
              <XAxis dataKey="bucket" tick={axis} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={compact} />
              <Tooltip formatter={kesTooltip} cursor={{ fill: "rgba(255,86,48,0.06)" }} />
              <Bar dataKey="value" name="Outstanding" radius={[6, 6, 0, 0]}>
                {debtorRows.map((r, i) => (
                  <Cell key={i} fill={r.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );
      case "loyalty":
        return (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Tooltip formatter={kesTooltip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Pie data={loyaltyRows} dataKey="value" name="Points" innerRadius={60} outerRadius={95} paddingAngle={3} strokeWidth={0}>
                {loyaltyRows.map((r, i) => (
                  <Cell key={i} fill={r.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        );
      case "staff":
        return (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.salesByStaff} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#DFE1E6" horizontal={false} />
              <XAxis type="number" tick={axis} axisLine={false} tickLine={false} tickFormatter={compact} />
              <YAxis type="category" dataKey="staff" width={90} tick={{ fontSize: 11, fill: "#172B4D" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={kesTooltip} cursor={{ fill: "rgba(0,82,204,0.06)" }} />
              <Bar dataKey="total" name="Sales" fill="#0052CC" radius={[0, 6, 6, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        );
      case "kra":
        return (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Tooltip formatter={(v: number | string) => `${v} invoices`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Pie data={kraRows} dataKey="value" name="Invoices" innerRadius={60} outerRadius={95} paddingAngle={3} strokeWidth={0}>
                {kraRows.map((r, i) => (
                  <Cell key={i} fill={r.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        );
      case "mpesa":
        return (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={mpesaRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DFE1E6" vertical={false} />
              <XAxis dataKey="day" tick={axis} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={compact} />
              <Tooltip formatter={kesTooltip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line dataKey="mpesa" name="M-Pesa" stroke="#00C853" strokeWidth={2} dot />
              <Line dataKey="cash" name="Cash" stroke="#0052CC" strokeWidth={2} dot strokeDasharray="4 3" />
              <Line dataKey="other" name="Other" stroke="#FFAB00" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        );
      case "expenses":
        return (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={exp?.summary.byCategory ?? []} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#DFE1E6" horizontal={false} />
              <XAxis type="number" tick={axis} axisLine={false} tickLine={false} tickFormatter={compact} />
              <YAxis type="category" dataKey="category" width={90} tick={{ fontSize: 11, fill: "#172B4D" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={kesTooltip} cursor={{ fill: "rgba(255,86,48,0.06)" }} />
              <Bar dataKey="amount" name="Spend" fill="#FF5630" radius={[0, 6, 6, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        );
    }
  };

  const drillMeta = REPORTS.find((r) => r.id === drill);
  const drillTable = drill ? tableFor(drill) : null;

  return (
    <div className="space-y-5">
      <ScreenHeader
        title="Reports & Analytics"
        subtitle="Live from your sales, stock, debtors & KRA submissions"
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#DFE1E6] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#172B4D]">
              <span className="h-2 w-2 rounded-full bg-[#00C853]" />
              {data ? `Last updated ${rel(data.generatedAt)}` : "Loading…"}
            </span>
            <Button
              onClick={() => void load()}
              disabled={loading}
              className="h-9 rounded-xl bg-[#0052CC] px-4 text-[13px] font-bold text-white hover:bg-[#0041A8]"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </Button>
          </>
        }
      />

      {loading && !data ? (
        <TableSkeleton rows={8} cols={4} />
      ) : (
        <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @6xl:grid-cols-4">
          {REPORTS.map(({ id, title, desc, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setDrill(id)}
              className="rounded-2xl border border-[#DFE1E6] bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#0052CC]/40 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F4F5F7] text-[#0052CC]">
                  <Icon size={16} />
                </div>
                <span className="text-[11px] text-[#6B778C]">{data ? rel(data.generatedAt) : "-"}</span>
              </div>
              <h3 className="font-display mt-4 text-[14px] font-bold text-[#172B4D]">{title}</h3>
              <p className="text-[12px] text-[#6B778C]">{desc}</p>
              <div className="mt-3 h-24">{miniChart(id)}</div>
              <p className="mt-2 text-[11px] font-semibold text-[#0052CC]">Click to drill down →</p>
            </button>
          ))}
        </div>
      )}

      {/* drill-down dialog */}
      <Dialog open={drill !== null} onOpenChange={(o) => !o && setDrill(null)}>
        <DialogContent className="max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2 text-[16px] text-[#172B4D]">
              {drillMeta && <drillMeta.icon size={16} className="text-[#0052CC]" />}
              {drillMeta?.title ?? "Report"}
            </DialogTitle>
            <DialogDescription>{drillMeta?.desc}</DialogDescription>
          </DialogHeader>

          <div className="h-64">{drill && bigChart(drill)}</div>

          {/* expenses: summary tiles + record-expense form + recent ledger */}
          {drill === "expenses" && exp && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
                {[
                  { label: "30-day spend", value: exp.summary.total, color: "#FF5630" },
                  { label: "This month", value: exp.summary.month, color: "#FF5630" },
                  { label: "Today", value: exp.summary.today, color: "#FFAB00" },
                  { label: "Entries", value: exp.summary.count, color: "#172B4D", plain: true },
                ].map((t) => (
                  <div key={t.label} className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#6B778C]">{t.label}</p>
                    <p className="font-display mt-0.5 text-[16px] font-bold tabular-nums" style={{ color: t.color }}>
                      {t.plain ? t.value : KES(t.value)}
                    </p>
                  </div>
                ))}
              </div>

              {/* net P&L strip - revenue vs expenses tells the owner the real story */}
              {data && (() => {
                const revenue7 = data.daily.reduce((s, d) => s + d.revenue, 0);
                const profit7 = data.daily.reduce((s, d) => s + d.profit, 0);
                const net = profit7 - (exp.summary.total / 30) * 7; // rough weekly operating cost
                return (
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-[#DFE1E6] bg-white p-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[#6B778C]">Revenue (7d)</p>
                      <p className="font-display text-[14px] font-bold text-[#0052CC]">{KES(revenue7)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[#6B778C]">Est. gross profit (7d)</p>
                      <p className="font-display text-[14px] font-bold text-[#00C853]">{KES(profit7)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[#6B778C]">Est. weekly op. cost</p>
                      <p className="font-display text-[14px] font-bold text-[#FF5630]">{KES((exp.summary.total / 30) * 7)}</p>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[#6B778C]">Net operating profit (7d)</p>
                      <p className={cn("font-display text-[16px] font-bold", net >= 0 ? "text-[#00C853]" : "text-[#FF5630]")}>
                        {KES(net)}
                      </p>
                    </div>
                  </div>
                );
              })()}

              <RecordExpenseForm onRecorded={loadExp} />

              {/* recent expense ledger */}
              {exp.expenses.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-xl border border-[#DFE1E6]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#FAFBFC]">
                        <TableHead className="text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">When</TableHead>
                        <TableHead className="text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Category</TableHead>
                        <TableHead className="text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Note</TableHead>
                        <TableHead className="text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Store</TableHead>
                        <TableHead className="text-right text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {exp.expenses.slice(0, 12).map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="text-[11px] text-[#6B778C]">
                            {new Date(e.spentAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                          </TableCell>
                          <TableCell>
                            <span className="rounded-full bg-[#F4F5F7] px-2 py-0.5 text-[11px] font-bold text-[#172B4D]">{e.category}</span>
                          </TableCell>
                          <TableCell className="max-w-44 truncate text-[12px] text-[#172B4D]" title={e.note}>{e.note}</TableCell>
                          <TableCell className="text-[11px] text-[#6B778C]">{e.storeName}</TableCell>
                          <TableCell className="text-right font-mono text-[12px] font-bold tabular-nums text-[#FF5630]">
                            −{KES(e.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          {/* P&L: operating-expense context (monthly spend from Expense ledger) */}
          {drill === "pnl" && exp && (
            <div className="flex items-center justify-between rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#6B778C]">Operating expenses (this month, all stores)</p>
                <p className="font-display text-[14px] font-bold text-[#FF5630]">{KES(exp.summary.month)}</p>
                <p className="mt-0.5 text-[10px] text-[#6B778C]">Top: {exp.summary.byCategory.slice(0, 2).map((c) => `${c.category} ${KES(c.amount)}`).join(" • ")}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDrill("expenses")}
                className="rounded-xl border-[#DFE1E6] text-[12px] font-bold text-[#172B4D]"
              >
                <TrendingDown size={13} /> Break down
              </Button>
            </div>
          )}

          {/* stock aging: real inventory-batch breakdown - heaviest items per bucket */}
          {drill === "stock" && stockAgingItems.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Heaviest stock per bucket</p>
                <span className="rounded-full bg-[#E9F2FF] px-2.5 py-1 text-[11px] font-bold text-[#0052CC]">
                  Total inventory at cost: {KES(data?.stockAging.totalValue ?? 0)}
                </span>
              </div>
              <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-xl border border-[#DFE1E6] p-2">
                {stockAgingItems
                  .filter((b) => b.topItems.length > 0)
                  .flatMap((b) =>
                    b.topItems.slice(0, 3).map((it, i) => (
                      <div key={`${b.bucket}-${i}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[#F4F5F7]">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: b.color }} />
                        <span className="text-[14px]">{it.emoji}</span>
                        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#172B4D]">{it.name}</span>
                        <span className="text-[11px] text-[#6B778C]">{it.store}</span>
                        <span className="text-[11px] tabular-nums text-[#6B778C]">×{Math.round(it.qty)}</span>
                        <span className="w-14 text-right text-[11px] tabular-nums text-[#6B778C]">{it.ageDays}d</span>
                        <span className="w-20 text-right font-mono text-[12px] font-semibold tabular-nums text-[#172B4D]">{KES(it.value)}</span>
                      </div>
                    ))
                  )}
              </div>
            </div>
          )}

          {drillTable && drillTable.rows.length > 0 ? (
            <div className="max-h-56 overflow-y-auto rounded-xl border border-[#DFE1E6]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#FAFBFC]">
                    {drillTable.cols.map((c) => (
                      <TableHead key={c} className="text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">
                        {c}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drillTable.rows.map((row, i) => (
                    <TableRow key={i}>
                      {row.map((cell, j) => (
                        <TableCell
                          key={j}
                          className={cn(
                            "text-[12px]",
                            j === 0 ? "font-semibold text-[#172B4D]" : "text-[#172B4D]",
                            typeof cell === "number" && j > 0 ? "font-mono tabular-nums" : ""
                          )}
                        >
                          {typeof cell === "number" &&
                           j > 0 &&
                           !["Transactions", "Invoices", "Points", "Units", "SKUs"].some((k) => String(drillTable.cols[j]).includes(k))
                            ? KES(cell)
                            : String(cell)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="py-4 text-center text-[12px] text-[#6B778C]">No data for this report yet.</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => drill && exportCsv(drill)}
              className="h-9 flex-1 rounded-xl bg-[#0052CC] text-[13px] font-bold text-white hover:bg-[#0041A8]"
            >
              <Download size={14} /> Export CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => setScheduleOpen(true)}
              className="h-9 flex-1 rounded-xl border-[#DFE1E6] text-[13px] font-bold text-[#172B4D]"
            >
              <CalendarClock size={14} /> Schedule email
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* scheduled-report email dialog - persists to Settings, sends via /api/cron/report */}
      <ScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} currentReport={drillMeta?.title} />
    </div>
  );
}

/* -- Scheduled report email dialog ----------------------------
   Real persisted schedule (Settings.reportSchedule*) backed by
   /api/cron/report - the mock Frappe scheduler hook that emails
   the owner a full sales summary (logged to Messages as Email). */
const FREQ_LABEL: Record<string, string> = {
  Daily: "Every day, 08:00 EAT",
  Weekly: "Every Monday, 08:00 EAT",
  Monthly: "1st of every month, 08:00 EAT",
};

function ScheduleDialog({
  open,
  onOpenChange,
  currentReport,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  currentReport?: string;
}) {
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [freq, setFreq] = useState("Weekly");
  const [email, setEmail] = useState("owner@dukaflow.co.ke");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  /* fresh settings each open */
  useEffect(() => {
    if (!open) return;
    api
      .get<SettingsDto>("/api/settings")
      .then((s) => {
        setSettings(s);
        setEnabled(s.reportScheduleEnabled);
        setFreq(String(s.reportScheduleFrequency));
        setEmail(s.reportScheduleEmail);
      })
      .catch(() => toast({ title: "Could not load schedule", description: "Check your connection." }));
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      const d = await api.put<{ settings: SettingsDto }>("/api/settings", {
        reportScheduleEnabled: enabled,
        reportScheduleFrequency: freq,
        reportScheduleEmail: email.trim() || "owner@dukaflow.co.ke",
      });
      setSettings(d.settings);
      toast({
        title: enabled ? "Report email scheduled ✓" : "Schedule paused",
        description: enabled
          ? `${FREQ_LABEL[freq]} → ${d.settings.reportScheduleEmail}`
          : "The owner will no longer receive automatic report emails.",
      });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Could not save schedule", description: err(e) });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const d = await api.post<{ ok: boolean; message?: string; email?: string; reason?: string }>(
        "/api/cron/report?force=1",
        {}
      );
      toast({
        title: d.ok ? "Test report sent ✓" : "Not sent",
        description: d.ok ? `Emailed to ${d.email} - check Messages for the copy.` : d.message,
      });
      if (d.ok) onOpenChange(false);
    } catch (e) {
      toast({ title: "Test send failed", description: err(e) });
    } finally {
      setTesting(false);
    }
  };

  const last = settings?.reportScheduleLastSentAt ? new Date(settings.reportScheduleLastSentAt) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2 text-[16px] text-[#172B4D]">
            <CalendarClock size={16} className="text-[#0052CC]" /> Schedule report email
          </DialogTitle>
          <DialogDescription>
            {currentReport ? `Automatic email for “${currentReport}” and the weekly sales summary.` : "Automatic owner sales summary."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* enabled */}
          <div className="flex items-center justify-between rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
            <div>
              <p className="text-[13px] font-bold text-[#172B4D]">Email the owner automatically</p>
              <p className="text-[11px] text-[#6B778C]">Sales, VAT, top products & payment split</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Toggle scheduled report" />
          </div>

          {/* frequency */}
          <div className="space-y-1.5">
            <Label className="text-[12px] font-semibold text-[#172B4D]">Frequency</Label>
            <Select value={freq} onValueChange={setFreq} disabled={!enabled}>
              <SelectTrigger className="w-full rounded-xl text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Daily">Daily - every day 08:00 EAT</SelectItem>
                <SelectItem value="Weekly">Weekly - Mondays 08:00 EAT</SelectItem>
                <SelectItem value="Monthly">Monthly - 1st 08:00 EAT</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* email */}
          <div className="space-y-1.5">
            <Label className="text-[12px] font-semibold text-[#172B4D]">Recipient</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="owner@dukaflow.co.ke"
              disabled={!enabled}
              className="rounded-xl text-[13px]"
            />
          </div>

          {/* status */}
          <div className="rounded-xl bg-[#E9F2FF] p-3 text-[11px] leading-relaxed text-[#0052CC]">
            {enabled
              ? `Active - ${FREQ_LABEL[freq]} → ${email}. Last sent: ${last ? last.toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never"}`
              : "Schedule is off. Turn it on to receive automatic reports."}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={sendTest}
              disabled={testing || saving}
              className="h-9 flex-1 rounded-xl border-[#DFE1E6] text-[12px] font-bold text-[#172B4D]"
            >
              {testing ? "Sending…" : "Send test now"}
            </Button>
            <Button
              onClick={save}
              disabled={saving || testing}
              className="h-9 flex-1 rounded-xl bg-[#0052CC] text-[12px] font-bold text-white hover:bg-[#0041A8]"
            >
              {saving ? "Saving…" : "Save schedule"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -- Record expense (petty cash / bills) ----------------------
   Inline form inside the Expenses drill-down. Persists to the
   Expense ledger via POST /api/expenses and refreshes the chart. */
function RecordExpenseForm({ onRecorded }: { onRecorded: () => void | Promise<void> }) {
  const stores = useApp((s) => s.stores);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    storeId: "", category: "Rent", amount: "", paidVia: "Cash", note: "", refNo: "",
  });

  const submit = async () => {
    const storeId = Number(form.storeId || stores[0]?.id || 0);
    const amount = Number(form.amount);
    if (!storeId || !amount || amount <= 0) {
      toast({ title: "Pick a store and an amount", description: "Both are required to record an expense." });
      return;
    }
    setBusy(true);
    try {
      const d = await api.post<{ ok: boolean; expense: ExpRow }>("/api/expenses", {
        storeId,
        category: form.category,
        amount,
        paidVia: form.paidVia,
        note: form.note.trim(),
        refNo: form.refNo.trim() || undefined,
      });
      toast({
        title: "Expense recorded ✓",
        description: `${form.category} - ${KES(amount)} at ${d.expense.storeName} (${form.paidVia}).`,
      });
      setForm({ storeId: "", category: "Rent", amount: "", paidVia: "Cash", note: "", refNo: "" });
      setOpen(false);
      await onRecorded();
    } catch (e) {
      toast({ title: "Could not record expense", description: err(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#DFE1E6] bg-white p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 text-[12px] font-bold text-[#172B4D]">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#FFEBE8] text-[#FF5630]">
            <Plus size={13} />
          </span>
          Record an expense
        </span>
        <span className="text-[11px] font-semibold text-[#0052CC]">{open ? "Hide −" : "Show +"}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-2.5 border-t border-[#DFE1E6] pt-3">
          <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold text-[#6B778C]">Store</Label>
              <Select value={form.storeId} onValueChange={(v) => setForm((f) => ({ ...f, storeId: v }))}>
                <SelectTrigger className="h-8 rounded-lg text-[12px]"><SelectValue placeholder={stores[0]?.name ?? "Store"} /></SelectTrigger>
                <SelectContent>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold text-[#6B778C]">Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger className="h-8 rounded-lg text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXP_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold text-[#6B778C]">Amount (KES)</Label>
              <Input
                type="number" min="1" value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0" className="h-8 rounded-lg text-[12px] font-bold"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold text-[#6B778C]">Paid via</Label>
              <Select value={form.paidVia} onValueChange={(v) => setForm((f) => ({ ...f, paidVia: v }))}>
                <SelectTrigger className="h-8 rounded-lg text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Cash", "M-Pesa", "Bank"].map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
            <div className="col-span-2 space-y-1">
              <Label className="text-[11px] font-semibold text-[#6B778C]">Note</Label>
              <Input
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="e.g. KPLC tokens - September"
                className="h-8 rounded-lg text-[12px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold text-[#6B778C]">Ref / voucher</Label>
              <Input
                value={form.refNo}
                onChange={(e) => setForm((f) => ({ ...f, refNo: e.target.value }))}
                placeholder="optional"
                className="h-8 rounded-lg text-[12px]"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={submit} disabled={busy}
                className="h-8 w-full rounded-lg bg-[#FF5630] text-[12px] font-bold text-white hover:bg-[#E64526]"
              >
                {busy ? "Saving…" : "Record expense"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
