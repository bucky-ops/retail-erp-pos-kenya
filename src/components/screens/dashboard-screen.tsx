"use client";

/**
 * Owner Dashboard - KPI row (sales / payment donut / debtors / low stock),
 * 7-day trend chart, sales-by-store, live feed, staff rail, quick actions
 * and low-stock alerts. Refetches when the active store changes.
 */

import { useCallback, useEffect, useState } from "react";
import {
  HandCoins,
  MessageSquare,
  PackageX,
  ReceiptText,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  UserPlus,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { useApp } from "@/lib/store";
import { useLive, type LiveLowStock, type LiveSale } from "@/lib/live";
import { KES } from "@/types";
import { KraBadge, TierBadge } from "@/components/df/badges";
import { EmptyState, KpiCard, Panel, ScreenHeader, TableSkeleton } from "@/components/df/shared";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

/* ── API shapes (local to this screen) ───────────────────────── */

interface FeedRow {
  receipt: string;
  customer: string;
  tier: string | null;
  store: string;
  amount: number;
  pay: string;
  kra: string;
  time: string;
}

interface StaffRow {
  name: string;
  role: string;
  color: string;
}

interface LowStockRow {
  name: string;
  emoji: string;
  sku: string;
  qty: number;
  store: string;
  reorderPoint: number;
}

interface DashboardData {
  kpis: {
    todaySales: number;
    todayCount: number;
    weekSales: number;
    debtorsTotal: number;
    debtorsCount: number;
    customers: number;
    lowStockCount: number;
  };
  feed: FeedRow[];
  staff: StaffRow[];
  lowStock: LowStockRow[];
  trend: { day: string; sales: number }[];
  paySplit: { method: string; total: number; pct: number }[];
  salesByStore: { store: string; storeId: number; total: number; pct: number }[];
  debtors: { name: string; debtBalance: number }[];
}

const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const payChip = (method: string) => {
  const map: Record<string, string> = {
    "M-Pesa": "bg-[#E8F5E9] text-[#1B7A2E]",
    Cash: "bg-[#E3F2FD] text-[#0D47A1]",
    Till: "bg-[#E9F2FF] text-[#0052CC]",
    Paybill: "bg-[#F4F5F7] text-[#172B4D]",
    "Gift Card": "bg-[#FFF8E1] text-[#8B6D00]",
    "Credit Sale": "bg-[#FFEBEE] text-[#C62828]",
    Card: "bg-[#ECEFF1] text-[#455A64]",
  };
  return map[method] ?? "bg-[#F4F5F7] text-[#6B778C]";
};

export default function DashboardScreen() {
  const activeStoreId = useApp((s) => s.activeStoreId);
  const stores = useApp((s) => s.stores);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  // Realtime (socket.io): rows broadcast after the page load + KPI bump.
  const [liveRows, setLiveRows] = useState<FeedRow[]>([]);
  const [liveTotals, setLiveTotals] = useState({ sales: 0, count: 0 });
  const [freshIds, setFreshIds] = useState<string[]>([]);

  const activeStore = activeStoreId !== "all" ? stores.find((s) => s.id === activeStoreId) : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = activeStoreId === "all" ? "" : `?storeId=${activeStoreId}`;
      setData(await api.get<DashboardData>(`/api/dashboard${qs}`));
      // Server is now authoritative - clear optimistic live deltas so a
      // manual refresh never double-counts a sale.
      setLiveTotals({ sales: 0, count: 0 });
      setLiveRows([]);
    } catch (e) {
      toast({
        title: "Could not load dashboard",
        description: e instanceof Error ? e.message : "Check your connection and retry",
      });
    } finally {
      setLoading(false);
    }
  }, [activeStoreId]);

  useEffect(() => {
    // async boundary: the loader touches state, so never call it synchronously here
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // ── Realtime event bus ────────────────────────────────────────────
  const liveStatus = useLive((event, payload) => {
    if (event === "sale:new") {
      const s = payload as LiveSale;
      const row: FeedRow = {
        receipt: s.receiptNo,
        customer: s.customerName,
        tier: s.customerTier,
        store: s.storeName,
        amount: s.total,
        pay: s.paymentMethod,
        kra: s.kraStatus,
        time: new Date(s.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      };
      setLiveRows((prev) => [row, ...prev.filter((r) => r.receipt !== row.receipt)].slice(0, 12));
      setLiveTotals((t) => ({ sales: t.sales + s.total, count: t.count + 1 }));
      setFreshIds((prev) => [row.receipt, ...prev].slice(0, 10));
      window.setTimeout(() => setFreshIds((prev) => prev.filter((id) => id !== row.receipt)), 6000);
      if (s.total >= 10000) {
        toast({ title: "Big sale! 🎉", description: `${s.receiptNo} • ${KES(s.total)} • ${s.customerName}` });
      }
    } else if (event === "stock:low") {
      const ls = payload as LiveLowStock;
      toast({
        title: "Low stock alert",
        description: `${ls.emoji} ${ls.productName} at ${ls.storeName}: ${ls.qty} left (reorder at ${ls.reorderPoint})`,
      });
      void load();
    }
  });

  // Combined feed: realtime rows first, then the fetched history (deduped).
  const feedRows: FeedRow[] = [];
  const seenReceipts = new Set<string>();
  for (const row of [...liveRows, ...(data?.feed ?? [])]) {
    if (seenReceipts.has(row.receipt)) continue;
    seenReceipts.add(row.receipt);
    feedRows.push(row);
  }

  const today = new Date().toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });

  /* trend chart data + dashed green target at 80% of best day */
  const maxSales = data ? Math.max(...data.trend.map((t) => t.sales), 1) : 1;
  const trendData = (data?.trend ?? []).map((t) => ({ ...t, target: Math.round(maxSales * 0.8) }));

  /* payment donut - M-Pesa green, Cash blue, everything else amber */
  const mpesaPct = data?.paySplit.find((p) => p.method === "M-Pesa")?.pct ?? 0;
  const cashPct = data?.paySplit.find((p) => p.method === "Cash")?.pct ?? 0;
  const donut = [
    { name: "M-Pesa", value: mpesaPct, color: "#00C853" },
    { name: "Cash", value: cashPct, color: "#0052CC" },
    { name: "Other", value: Math.max(0, 100 - mpesaPct - cashPct), color: "#FFAB00" },
  ];

  const orderFromSupplier = () => {
    const first = data?.lowStock[0]?.name ?? "Bamburi Cement";
    toast({
      title: "PO draft created",
      description: `${first} notified - ${data?.lowStock.length ?? 0} low-stock item${(data?.lowStock.length ?? 0) === 1 ? "" : "s"} queued for restock`,
    });
  };

  return (
    <div className="space-y-5">
      <ScreenHeader
        title="Owner Dashboard"
        subtitle={`${activeStore ? activeStore.name : "All Stores"} • ${today}`}
        actions={
          <>
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void load()}
              className="h-9 rounded-xl border-[#DFE1E6] bg-white px-3 text-[13px] font-semibold text-[#172B4D]"
            >
              <RefreshCw size={14} className={cn(loading && "animate-spin")} /> Refresh
            </Button>
            <Button
              onClick={() => useApp.getState().setPage("pos")}
              className="h-9 rounded-xl bg-[#0052CC] px-4 text-[13px] font-semibold text-white hover:bg-[#0041A8]"
            >
              <ShoppingCart size={14} /> New Sale
            </Button>
          </>
        }
      />

      {/* ── Row 1: KPI cards ─────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @6xl:grid-cols-4">
        <KpiCard
          icon={<TrendingUp size={16} />}
          label="Today's Sales"
          value={KES((data?.kpis.todaySales ?? 0) + liveTotals.sales)}
          delta="+12%"
          sub={`${(data?.kpis.todayCount ?? 0) + liveTotals.count} receipts today`}
          loading={loading}
          className={cn(liveTotals.count > 0 && "df-live-flash")}
          chart={
            <div className="h-8 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.trend ?? []} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="sparkBlue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0052CC" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0052CC" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="sales"
                    stroke="#0052CC"
                    strokeWidth={1.8}
                    fill="url(#sparkBlue)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          }
        />

        {/* Payment split - mini donut card */}
        <div className="rounded-2xl border border-[#DFE1E6] bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "#E9F2FF", color: "#0052CC" }}>
              <Wallet size={16} />
            </div>
          </div>
          {loading ? (
            <Skeleton className="mt-3 h-12 w-32" />
          ) : (
            <div className="mt-3 flex items-center gap-4">
              <div className="h-12 w-12 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donut}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={15}
                      outerRadius={24}
                      paddingAngle={2}
                      strokeWidth={0}
                      startAngle={90}
                      endAngle={-270}
                    >
                      {donut.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1 text-[11px] text-[#6B778C]">
                {donut.map((d) => (
                  <div key={d.name} className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: d.color }} />
                    {d.name}&nbsp;<b className="text-[#172B4D]">{d.value}%</b>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="mt-0.5 text-[12px] text-[#6B778C]">Payment Split</p>
          <p className="mt-1 text-[11px] font-medium text-[#6B778C]">M-Pesa vs Cash vs Other</p>
        </div>

        <KpiCard
          icon={<HandCoins size={16} />}
          label="Total Debtors"
          value={KES(data?.kpis.debtorsTotal ?? 0, true)}
          delta="-8%"
          sub={`${data?.kpis.debtorsCount ?? 0} overdue • Action needed`}
          iconBg="#FFEBEE"
          iconColor="#FF5630"
          loading={loading}
        />

        <KpiCard
          icon={<PackageX size={16} />}
          label="Low Stock"
          value={`${data?.kpis.lowStockCount ?? 0} items`}
          sub="Cement, Paint, Plumbing"
          iconBg="#FFF8E1"
          iconColor="#B8860B"
          loading={loading}
          className="border-l-4 border-l-[#FFAB00]"
        />
      </div>

      {/* ── Row 2: trend + sales by store ────────────────── */}
      <div className="grid grid-cols-12 gap-5">
        <Panel className="col-span-12 @6xl:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Sales Trend (7 days)</h3>
              <p className="text-[11px] text-[#6B778C]">
                {activeStore ? activeStore.name : "Thika Road + Kiambu"} • KES per day
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-[#6B778C]">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#0052CC]" /> Sales
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0 w-4 border-t-2 border-dashed border-[#00C853]" /> Target (80%)
              </span>
            </div>
          </div>
          <div className="mt-4 h-[230px]">
            {loading ? (
              <TableSkeleton rows={4} cols={6} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dfTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0052CC" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#0052CC" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#DFE1E6" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#6B778C" }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#6B778C" }}
                    axisLine={false}
                    tickLine={false}
                    width={64}
                    tickFormatter={(v: number) => KES(v, true)}
                  />
                  <Tooltip
                    formatter={(value) => [KES(Number(value)), "Sales"]}
                    contentStyle={{ borderRadius: 12, border: "1px solid #DFE1E6", fontSize: 12 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="sales"
                    name="Sales"
                    stroke="#0052CC"
                    strokeWidth={2.5}
                    fill="url(#dfTrendFill)"
                  />
                  <Line
                    type="monotone"
                    dataKey="target"
                    name="Target"
                    stroke="#00C853"
                    strokeWidth={1.5}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel className="col-span-12 @6xl:col-span-4">
          <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Sales by Store</h3>
          <p className="text-[11px] text-[#6B778C]">This week, all locations</p>
          <div className="mt-4 space-y-4">
            {loading && <TableSkeleton rows={2} cols={2} />}
            {!loading &&
              (data?.salesByStore ?? []).map((s, i) => (
                <div key={s.storeId}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-semibold text-[#172B4D]">{s.store}</span>
                    <span className="font-bold text-[#172B4D]">
                      {KES(s.total, true)} <span className="text-[11px] font-semibold text-[#6B778C]">• {s.pct}%</span>
                    </span>
                  </div>
                  <Progress
                    value={s.pct}
                    className={cn(
                      "mt-2 h-2 bg-[#F4F5F7]",
                      i === 0
                        ? "[&_[data-slot=progress-indicator]]:bg-[#0052CC]"
                        : "[&_[data-slot=progress-indicator]]:bg-[#00C853]"
                    )}
                  />
                </div>
              ))}
            {!loading && (data?.salesByStore.length ?? 0) === 0 && (
              <p className="text-[12px] text-[#6B778C]">No sales recorded this week.</p>
            )}
          </div>
        </Panel>
      </div>

      {/* ── Row 3: live feed + right rail ────────────────── */}
      <div className="grid grid-cols-12 gap-5">
        <Panel padding={false} className="col-span-12 overflow-hidden @6xl:col-span-8">
          <div className="flex items-center justify-between border-b border-[#DFE1E6] p-4 @md:p-5">
            <div className="flex items-center gap-2">
              {liveStatus === "live" ? (
                <>
                  <span className="df-live-dot h-2 w-2 rounded-full bg-[#00C853]" />
                  <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Live Sales Feed</h3>
                  <span className="rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[10px] font-bold tracking-wide text-[#1B7A2E]">
                    LIVE
                  </span>
                </>
              ) : (
                <>
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[#FFAB00]" />
                  <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Live Sales Feed</h3>
                  <span className="rounded-full bg-[#FFF8E1] px-2 py-0.5 text-[10px] font-bold tracking-wide text-[#B8860B]">
                    {liveStatus === "connecting" ? "CONNECTING…" : "RECONNECTING…"}
                  </span>
                </>
              )}
            </div>
            <span className="hidden rounded-full bg-[#E3F2FD] px-3 py-1 text-[11px] font-bold text-[#0052CC] @md:inline">
              Conversion 68%
            </span>
          </div>
          <div className="df-scroll overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-[#FAFBFC] text-left text-[11px] uppercase tracking-widest text-[#6B778C]">
                  <th className="p-3 font-semibold">Time</th>
                  <th className="p-3 font-semibold">Receipt</th>
                  <th className="p-3 font-semibold">Customer</th>
                  <th className="hidden p-3 font-semibold @2xl:table-cell">Store</th>
                  <th className="p-3 font-semibold">Amount</th>
                  <th className="p-3 font-semibold">Pay</th>
                  <th className="p-3 font-semibold">KRA</th>
                </tr>
              </thead>
              <tbody>
                {feedRows.map((f) => (
                  <tr
                    key={f.receipt}
                    className={cn(
                      "border-t border-[#F4F5F7] hover:bg-[#FAFBFC]",
                      freshIds.includes(f.receipt) && "df-feed-new"
                    )}
                  >
                    <td className="whitespace-nowrap p-3 text-[#6B778C]">{f.time}</td>
                    <td className="whitespace-nowrap p-3 font-mono font-semibold text-[#172B4D]">{f.receipt}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#DFE1E6] text-[10px] font-bold text-[#172B4D]">
                          {initials(f.customer)}
                        </span>
                        <span className="whitespace-nowrap font-medium text-[#172B4D]">{f.customer}</span>
                        <TierBadge tier={f.tier} />
                      </div>
                    </td>
                    <td className="hidden whitespace-nowrap p-3 text-[#6B778C] @2xl:table-cell">{f.store}</td>
                    <td className="whitespace-nowrap p-3 font-bold text-[#172B4D]">{KES(f.amount)}</td>
                    <td className="p-3">
                      <span className={cn("whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-bold", payChip(f.pay))}>
                        {f.pay}
                      </span>
                    </td>
                    <td className="p-3">
                      <KraBadge status={f.kra} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading && (
              <div className="p-5">
                <TableSkeleton rows={5} cols={6} />
              </div>
            )}
            {!loading && (data?.feed.length ?? 0) === 0 && (
              <div className="p-6">
                <EmptyState
                  icon={<ReceiptText size={20} />}
                  title="No sales yet"
                  sub="Record your first sale in the POS and it will appear here in real time."
                />
              </div>
            )}
          </div>
        </Panel>

        {/* right rail */}
        <div className="col-span-12 space-y-4 @6xl:col-span-4">
          <Panel>
            <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Staff on Shift</h3>
            <div className="mt-3 space-y-3">
              {loading && <TableSkeleton rows={3} cols={2} />}
              {!loading &&
                (data?.staff ?? []).map((st) => (
                  <div key={st.name} className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-bold text-white"
                        style={{ background: st.color }}
                      >
                        {initials(st.name)}
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-[#00C853]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-[#172B4D]">{st.name}</p>
                      <p className="text-[11px] text-[#6B778C]">{st.role}</p>
                    </div>
                    <span className="rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[10px] font-bold text-[#1B7A2E]">
                      On shift
                    </span>
                  </div>
                ))}
              {!loading && (data?.staff.length ?? 0) === 0 && (
                <p className="text-[12px] text-[#6B778C]">No staff clocked in right now.</p>
              )}
            </div>
          </Panel>

          <Panel className="border-[#172B4D] bg-[#172B4D] text-white">
            <h3 className="font-display text-[15px] font-bold">Quick Actions</h3>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => useApp.getState().setPage("pos")}
                className="flex h-12 flex-col items-center justify-center gap-1 rounded-xl bg-[#0052CC] text-[12px] font-semibold text-white transition hover:bg-[#0041A8]"
              >
                <ShoppingCart size={16} /> New Sale
              </button>
              <button
                type="button"
                onClick={() => useApp.getState().setPage("customers")}
                className="flex h-12 flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/10 text-[12px] font-semibold text-white transition hover:bg-white/20"
              >
                <UserPlus size={16} /> Add Customer
              </button>
              <button
                type="button"
                onClick={() => useApp.getState().setPage("debts")}
                className="flex h-12 flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/10 text-[12px] font-semibold text-white transition hover:bg-white/20"
              >
                <HandCoins size={16} /> Record Debt Payment
              </button>
              <button
                type="button"
                onClick={() => useApp.getState().setPage("messages")}
                className="flex h-12 flex-col items-center justify-center gap-1 rounded-xl bg-[#00C853] text-[12px] font-semibold text-white transition hover:bg-[#00A844]"
              >
                <MessageSquare size={16} /> Send Promo
              </button>
            </div>
          </Panel>

          <div className="rounded-2xl border border-[#C8E6C9] bg-gradient-to-br from-[#E8F5E9] to-[#F2F9F2] p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#1B7A2E]">M-Pesa Till</p>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-[#00C853] shadow-sm">
                <Wallet size={15} />
              </div>
            </div>
            <p className="font-display mt-1 text-[16px] font-bold text-[#172B4D]">123456 • DukaFlow</p>
            <Progress
              value={78}
              className="mt-3 h-2 bg-white [&_[data-slot=progress-indicator]]:bg-[#00C853]"
            />
            <p className="mt-1.5 text-[11px] text-[#6B778C]">KES 89k collected today • 78% of daily target</p>
          </div>
        </div>
      </div>

      {/* ── Row 4: low stock alerts ──────────────────────── */}
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <PackageX size={16} className="text-[#B8860B]" />
            <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Low Stock Alerts</h3>
            <span className="rounded-full bg-[#FFF8E1] px-2 py-0.5 text-[10px] font-bold text-[#B8860B]">
              {data?.lowStock.length ?? 0} items
            </span>
          </div>
          <Button
            variant="ghost"
            onClick={orderFromSupplier}
            className="h-8 rounded-xl border border-[#DFE1E6] px-3 text-[12px] font-semibold text-[#172B4D] hover:bg-[#F4F5F7]"
          >
            Order from supplier
          </Button>
        </div>
        <div className="df-scroll mt-4 flex gap-3 overflow-x-auto pb-1">
          {loading &&
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px] min-w-[190px] rounded-xl" />)}
          {!loading &&
            (data?.lowStock ?? []).map((item) => {
              const critical = item.qty <= 3;
              return (
                <div
                  key={`${item.sku}-${item.store}`}
                  className="min-w-[190px] rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-lg shadow-sm">
                      {item.emoji}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-[#172B4D]">{item.name}</p>
                      <p className="truncate font-mono text-[11px] text-[#6B778C]">
                        {item.sku} • {item.store}
                      </p>
                    </div>
                  </div>
                  <p className={cn("mt-2 text-[12px] font-bold", critical ? "text-[#FF5630]" : "text-[#B8860B]")}>
                    {item.qty} left <span className="font-medium text-[#6B778C]">• reorder at {item.reorderPoint}</span>
                  </p>
                </div>
              );
            })}
          {!loading && (data?.lowStock.length ?? 0) === 0 && (
            <p className="py-2 text-[12px] text-[#6B778C]">All stock levels are healthy - no alerts.</p>
          )}
        </div>
      </Panel>
    </div>
  );
}
