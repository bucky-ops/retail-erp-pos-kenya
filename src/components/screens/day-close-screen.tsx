"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Banknote, CalendarClock, CheckCircle2, CreditCard, FileText,
  Loader2, Lock, RefreshCw, Scale, ShieldCheck, Smartphone, Store,
} from "lucide-react";
import { api } from "@/lib/api";
import { KES } from "@/types";
import { ScreenHeader, KpiCard, Panel, EmptyState, TableSkeleton } from "@/components/df/shared";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/* -- contract (mirror of /api/day-close) ------------------- */

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

interface DCPayload {
  today: DayCloseDTO | null;
  history: DayCloseDTO[];
  staffOnDuty: string[];
  breakdown: { method: string; total: number; count: number }[];
}

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** Variance tolerance from the close guard on the server. */
const TOLERANCE = 100;

const fmtTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    : "-";

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-KE", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

const signed = (n: number) => `${n >= 0 ? "+" : "-"}${KES(Math.abs(n))}`;

/** Green when the variance sits inside the KES 100 tolerance, red outside. */
function VarianceBadge({ v }: { v: number }) {
  const ok = Math.abs(v) <= TOLERANCE;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
        ok ? "bg-[#E8F5E9] text-[#1B7A2E]" : "bg-[#FFEBEE] text-[#C62828]"
      )}
    >
      {ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
      {signed(v)}
      <span className="font-semibold opacity-70">/ ±{KES(TOLERANCE)}</span>
    </span>
  );
}

/* -- screen ------------------------------------------------ */

export default function DayCloseScreen() {
  const [data, setData] = useState<DCPayload | null>(null);
  const [busy, setBusy] = useState<"count" | "approve" | "close" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  /* counted drafts - resynced at render time whenever the day-close record changes */
  const [syncedId, setSyncedId] = useState(0);
  const [cash, setCash] = useState("");
  const [mpesa, setMpesa] = useState("");
  const [note, setNote] = useState("");
  const [approver, setApprover] = useState("");

  const today = data?.today ?? null;

  const load = useCallback(async () => {
    try {
      setData(await api.get<DCPayload>("/api/day-close"));
    } catch (e) {
      toast({ title: "Could not load day close", description: err(e) });
      setData({ today: null, history: [], staffOnDuty: [], breakdown: [] });
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  /* render-time resync: prefill counted drafts when a new day-close record loads */
  if ((today?.id ?? 0) !== syncedId) {
    setSyncedId(today?.id ?? 0);
    setCash(today?.cashCounted != null ? String(today.cashCounted) : "");
    setMpesa(today?.mpesaCounted != null ? String(today.mpesaCounted) : "");
    setNote(today?.note ?? "");
  }

  /* -- derived variance math (counted vs system per tender) --
     Live: typed counts are compared as you type; when a field is left empty
     the saved drawer count (if any) is used instead. */
  const closed = today?.status === "Closed";
  const typedCash = cash.trim() === "" ? null : Number(cash) || 0;
  const typedMpesa = mpesa.trim() === "" ? null : Number(mpesa) || 0;
  const effCash = typedCash ?? today?.cashCounted ?? null;
  const effMpesa = typedMpesa ?? today?.mpesaCounted ?? null;
  const hasCounts = effCash != null || effMpesa != null;
  const countsSaved = today?.cashCounted != null || today?.mpesaCounted != null || closed;
  const cashVar = today && effCash != null ? effCash - today.cashSystem : 0;
  const mpesaVar = today && effMpesa != null ? effMpesa - today.mpesaSystem : 0;
  const totalVar = cashVar + mpesaVar;
  const withinTolerance = Math.abs(totalVar) <= TOLERANCE;
  const needsApproval = hasCounts && !withinTolerance && !today?.approvedBy;
  const canClose = countsSaved && (withinTolerance || !!today?.approvedBy) && !closed;

  /* -- actions ----------------------------------------------- */

  const saveCounts = async () => {
    setBusy("count");
    try {
      const res = await api.post<{ ok: boolean; today: DayCloseDTO }>("/api/day-close", {
        action: "count",
        cashCounted: effCash ?? 0,
        mpesaCounted: effMpesa ?? 0,
      });
      setData((d) => (d ? { ...d, today: res.today } : d));
      toast({
        title: "Drawer counts saved",
        description: `Variance ${signed(totalVar)} - ${withinTolerance ? "inside the KES 100 tolerance" : "over tolerance, approval needed"}`,
      });
    } catch (e) {
      toast({ title: "Could not save counts", description: err(e) });
    } finally {
      setBusy(null);
    }
  };

  const recordApproval = async () => {
    if (!approver) {
      toast({ title: "Pick who approved the variance" });
      return;
    }
    setBusy("approve");
    try {
      const res = await api.post<{ ok: boolean; today: DayCloseDTO }>("/api/day-close", {
        action: "approve",
        approvedBy: approver,
      });
      setData((d) => (d ? { ...d, today: res.today } : d));
      toast({ title: "Variance approval recorded", description: `Signed off by ${approver}` });
    } catch (e) {
      toast({ title: "Could not record approval", description: err(e) });
    } finally {
      setBusy(null);
    }
  };

  const freezeDay = async () => {
    setBusy("close");
    try {
      const res = await api.post<{ ok: boolean; zNo: string; jvNo: string }>("/api/day-close", {
        action: "close",
        note,
      });
      setConfirmOpen(false);
      toast({
        title: `Day frozen - ${res.zNo}`,
        description: `Daily sales journal ${res.jvNo} posted to the ledger.`,
      });
      await load();
    } catch (e) {
      toast({ title: "Could not close the day", description: err(e) });
    } finally {
      setBusy(null);
    }
  };

  const loading = data === null;
  const history = data?.history ?? [];

  /* -- KPI values -------------------------------------------- */
  const expectedCash = today ? today.openingCash + today.cashSystem : 0;
  const lastZ = history[0]?.zNo ?? "-";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <ScreenHeader
        title="Day Closing"
        subtitle="Count the till, check variance, freeze the Z report"
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={loading} className="h-9 rounded-xl text-[13px] font-semibold">
            <RefreshCw size={14} /> Refresh
          </Button>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={<CalendarClock size={16} />}
          label="Today net sales"
          value={today ? KES(today.salesTotal) : ""}
          sub={today ? `${today.receipts} receipts • ${today.storeName}` : undefined}
          loading={loading}
        />
        <KpiCard
          icon={<Banknote size={16} />}
          label="Expected cash in drawer"
          value={today ? KES(expectedCash) : ""}
          sub={today ? `float ${KES(today.openingCash)} + cash sales ${KES(today.cashSystem)}` : undefined}
          iconBg="#FFF8E1"
          iconColor="#B8860B"
          loading={loading}
        />
        <KpiCard
          icon={<Scale size={16} />}
          label="Variance status"
          value={loading ? "" : hasCounts ? (withinTolerance ? "Balanced" : "Over tolerance") : "Awaiting count"}
          sub={loading ? undefined : hasCounts ? `${signed(totalVar)} vs KES 100 tolerance` : "Enter counted totals to compare"}
          iconBg={hasCounts && !withinTolerance ? "#FFEBEE" : "#E8F5E9"}
          iconColor={hasCounts && !withinTolerance ? "#C62828" : "#1B7A2E"}
          loading={loading}
        />
        <KpiCard
          icon={<FileText size={16} />}
          label="Last Z number"
          value={loading ? "" : lastZ}
          sub={history[0] ? `${history[0].businessDate} • ${history[0].status}` : undefined}
          iconBg="#F4F5F7"
          iconColor="#172B4D"
          loading={loading}
        />
      </div>

      {!loading && !today ? (
        <Panel>
          <EmptyState
            icon={<Store size={22} />}
            title="No store configured"
            sub="A day-close record is opened automatically per business day once a store exists."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {/* -- Start Day Close -- */}
          <Panel className="lg:col-span-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Start Day Close</h3>
                <p className="text-[11px] text-[#6B778C]">
                  Count every drawer against the system totals - card tenders settle automatically.
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge className="rounded-full bg-[#E9F2FF] text-[11px] text-[#0052CC] hover:bg-[#E9F2FF]">
                  <Store size={11} className="mr-1" /> {today?.storeName}
                </Badge>
                <Badge className="rounded-full bg-[#F4F5F7] font-mono text-[11px] text-[#172B4D] hover:bg-[#F4F5F7]">
                  {today ? fmtDay(today.businessDate) : "-"}
                </Badge>
              </div>
            </div>

            {/* live tender mix */}
            {(data?.breakdown.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Live tender mix:</span>
                {data!.breakdown.map((b) => (
                  <span key={b.method} className="rounded-full border border-[#DFE1E6] bg-[#FAFBFC] px-2 py-0.5 text-[10px] font-semibold text-[#172B4D]">
                    {b.method} • {KES(b.total, true)} ({b.count})
                  </span>
                ))}
              </div>
            )}

            <Separator className="my-4" />

            {/* counted inputs */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="dc-cash" className="flex items-center gap-1.5 text-[12px] font-semibold text-[#172B4D]">
                  <Banknote size={13} className="text-[#1B7A2E]" /> Cash counted
                </Label>
                <Input
                  id="dc-cash"
                  type="number"
                  min={0}
                  inputMode="decimal"
                  disabled={closed || busy !== null}
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                  placeholder={today ? String(today.cashSystem) : "0"}
                  className="h-10 rounded-xl bg-[#FAFBFC] text-right font-bold tabular-nums"
                />
                <p className="text-[10px] text-[#6B778C]">System: {today ? KES(today.cashSystem) : "-"}</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="dc-mpesa" className="flex items-center gap-1.5 text-[12px] font-semibold text-[#172B4D]">
                  <Smartphone size={13} className="text-[#1B7A2E]" /> M-Pesa counted
                </Label>
                <Input
                  id="dc-mpesa"
                  type="number"
                  min={0}
                  inputMode="decimal"
                  disabled={closed || busy !== null}
                  value={mpesa}
                  onChange={(e) => setMpesa(e.target.value)}
                  placeholder={today ? String(today.mpesaSystem) : "0"}
                  className="h-10 rounded-xl bg-[#FAFBFC] text-right font-bold tabular-nums"
                />
                <p className="text-[10px] text-[#6B778C]">System: {today ? KES(today.mpesaSystem) : "-"}</p>
              </div>
              <div className="grid gap-1.5">
                <Label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#172B4D]">
                  <CreditCard size={13} className="text-[#6B778C]" /> Card &amp; other
                </Label>
                <Input
                  disabled
                  value={today ? KES(today.cardSystem) : "-"}
                  className="h-10 rounded-xl bg-[#F4F5F7] text-right font-bold tabular-nums text-[#6B778C]"
                />
                <p className="text-[10px] text-[#6B778C]">Auto-reconciled at settlement</p>
              </div>
            </div>

            {/* variance summary */}
            <div className="mt-4 rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-[#172B4D]">Variance (counted - system)</span>
                {hasCounts ? <VarianceBadge v={totalVar} /> : (
                  <span className="rounded-full bg-[#F4F5F7] px-2.5 py-0.5 text-[11px] font-bold text-[#6B778C]">Enter counts to compute</span>
                )}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
                <span className="text-[#6B778C]">Cash: <b className={cn("tabular-nums", cashVar === 0 ? "text-[#172B4D]" : cashVar > 0 ? "text-[#1B7A2E]" : "text-[#C62828]")}>{effCash != null ? signed(cashVar) : "-"}</b></span>
                <span className="text-[#6B778C]">M-Pesa: <b className={cn("tabular-nums", mpesaVar === 0 ? "text-[#172B4D]" : mpesaVar > 0 ? "text-[#1B7A2E]" : "text-[#C62828]")}>{effMpesa != null ? signed(mpesaVar) : "-"}</b></span>
                <span className="text-[#6B778C]">Card: <b className="tabular-nums text-[#172B4D]">{KES(0)}</b></span>
              </div>
            </div>

            {/* notes */}
            <div className="mt-3 grid gap-1.5">
              <Label htmlFor="dc-note" className="text-[12px] font-semibold text-[#172B4D]">Notes (optional)</Label>
              <Textarea
                id="dc-note"
                disabled={closed || busy !== null}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything the owner should know about today's float, damages or IOUs..."
                className="min-h-[64px] rounded-xl bg-[#FAFBFC] text-[12px]"
              />
            </div>

            {/* approval block - required when variance exceeds KES 100 */}
            {needsApproval && (
              <div className="mt-3 rounded-xl border border-[#FFD591] bg-[#FFF8E1] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[12px] font-bold text-[#8B6D00]">
                    <ShieldCheck size={14} /> Variance over KES {TOLERANCE} - approval required before freezing
                  </span>
                  <div className="flex items-center gap-2">
                    <Select value={approver} onValueChange={setApprover}>
                      <SelectTrigger className="h-9 w-[190px] rounded-lg bg-white text-[12px]" aria-label="Approved by">
                        <SelectValue placeholder="Approved by..." />
                      </SelectTrigger>
                      <SelectContent>
                        {(data?.staffOnDuty ?? []).map((n) => (
                          <SelectItem key={n} value={n}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      onClick={() => void recordApproval()}
                      disabled={busy !== null || !approver}
                      className="h-9 rounded-lg bg-[#B8860B] text-[12px] font-bold text-white hover:bg-[#8B6D00]"
                    >
                      {busy === "approve" ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Record approval
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {today?.approvedBy && (
              <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-[#E8F5E9] px-3 py-2 text-[12px] font-semibold text-[#1B7A2E]">
                <ShieldCheck size={14} /> Variance approved by {today.approvedBy}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void saveCounts()}
                disabled={closed || busy !== null || (!cash && !mpesa)}
                className="h-10 rounded-xl bg-[#0052CC] px-5 text-[13px] font-semibold text-white hover:bg-[#0041A8]"
              >
                {busy === "count" ? <Loader2 size={14} className="animate-spin" /> : <Scale size={14} />} Save counts
              </Button>
              <p className="text-[11px] text-[#6B778C]">
                Saving counts stores the drawer figures and computes the variance; freezing posts the journal.
              </p>
            </div>
          </Panel>

          {/* -- Z Report -- */}
          <Panel className="lg:col-span-2">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Z Report</h3>
              {today && (
                <Badge
                  className={cn(
                    "rounded-full px-3 py-1 text-[11px] font-bold",
                    closed ? "bg-[#E8F5E9] text-[#1B7A2E]" : "bg-[#FFF8E1] text-[#8B6D00]"
                  )}
                >
                  {closed ? "Closed" : "Open"}
                </Badge>
              )}
            </div>

            {today && (
              <div className="mt-3 rounded-xl border border-[#DFE1E6] bg-white p-4 font-mono text-[11.5px] leading-relaxed text-[#172B4D] shadow-inner">
                <div className="text-center">
                  <p className="font-display text-[14px] font-bold tracking-wide">DUKAFLOW LTD</p>
                  <p className="text-[10px] text-[#6B778C]">PIN P051234567A • Nairobi, Kenya</p>
                  <p className="mt-1.5 inline-block rounded-full border border-dashed border-[#C9CFDA] px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest">
                    Z Reading - End of Day
                  </p>
                </div>
                <div className="my-3 border-t border-dashed border-[#C9CFDA]" />
                <div className="space-y-1">
                  <Line k="Z No" v={today.zNo} mono />
                  <Line k="Store" v={today.storeName} />
                  <Line k="Period" v={fmtTime(today.openedAt)} />
                  {closed && <Line k="Closed at" v={fmtTime(today.closedAt)} />}
                  <Line k="Staff on duty" v={today.staffOnDuty || "-"} />
                </div>
                <div className="my-3 border-t border-dashed border-[#C9CFDA]" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Tender breakdown</p>
                <div className="mt-1 space-y-1">
                  <Line k="Cash (system)" v={KES(today.cashSystem)} />
                  {today.cashCounted != null && <Line k="Cash (counted)" v={KES(today.cashCounted)} />}
                  <Line k="M-Pesa (system)" v={KES(today.mpesaSystem)} />
                  {today.mpesaCounted != null && <Line k="M-Pesa (counted)" v={KES(today.mpesaCounted)} />}
                  <Line k="Card & other" v={KES(today.cardSystem)} />
                </div>
                <div className="my-3 border-t border-dashed border-[#C9CFDA]" />
                <Line k="Net sales" v={KES(today.salesTotal)} bold />
                <Line k="Receipts" v={String(today.receipts)} />
                {hasCounts && (
                  <div className="mt-1 space-y-1">
                    <Line k="Variance" v={signed(totalVar)} bold />
                    <Line k="Status" v={withinTolerance ? "WITHIN TOLERANCE" : "OVER TOLERANCE"} />
                  </div>
                )}
                {today.approvedBy && <Line k="Approved by" v={today.approvedBy} />}
                {today.note && <Line k="Note" v={today.note} />}
                {closed && today.closingCash != null && <Line k="Closing cash banked" v={KES(today.closingCash)} />}
                <div className="my-3 border-t border-dashed border-[#C9CFDA]" />
                <p className="text-center text-[10px] text-[#6B778C]">
                  {closed ? "Day frozen - figures are final" : "Provisional - freeze to finalize"}
                </p>
              </div>
            )}

            {/* freeze action */}
            {today && !closed && (
              <div className="mt-4">
                <Button
                  onClick={() => setConfirmOpen(true)}
                  disabled={!canClose || busy !== null}
                  className="h-10 w-full rounded-xl bg-[#172B4D] text-[13px] font-bold text-white hover:bg-[#0C1526]"
                >
                  <Lock size={14} /> Freeze and close day
                </Button>
                <p className="mt-2 text-center text-[10px] text-[#6B778C]">
                  {countsSaved
                    ? canClose
                      ? "Locks the Z report and auto-posts the daily sales journal"
                      : "Record a variance approval to unlock freezing"
                    : "Save the drawer counts first"}
                </p>
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* -- Recent Z readings -- */}
      <Panel padding={false}>
        <div className="flex items-center justify-between border-b border-[#DFE1E6] px-4 py-3 md:px-6">
          <div>
            <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Recent Z readings</h3>
            <p className="text-[11px] text-[#6B778C]">Last 14 frozen and open day-close records</p>
          </div>
        </div>
        {loading ? (
          <div className="p-4">
            <TableSkeleton rows={4} cols={5} />
          </div>
        ) : history.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<FileText size={22} />}
              title="No Z readings yet"
              sub="Close your first day to start the Z-number audit trail."
            />
          </div>
        ) : (
          <div className="df-scroll max-h-96 overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-[#FAFBFC]">
                <tr>
                  {["Z No", "Date", "Store", "Status", "Variance", "Net sales"].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-[#6B778C] md:px-6">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-[#F4F5F7] transition-colors hover:bg-[#FAFBFC]">
                    <td className="px-4 py-2.5 font-mono font-bold text-[#172B4D] md:px-6">{h.zNo}</td>
                    <td className="px-4 py-2.5 text-[#6B778C] md:px-6">{h.businessDate}</td>
                    <td className="px-4 py-2.5 text-[#6B778C] md:px-6">{h.storeName}</td>
                    <td className="px-4 py-2.5 md:px-6">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold",
                          h.status === "Closed" ? "bg-[#E8F5E9] text-[#1B7A2E]" : "bg-[#FFF8E1] text-[#8B6D00]"
                        )}
                      >
                        {h.status}
                      </span>
                    </td>
                    <td className={cn("px-4 py-2.5 font-semibold tabular-nums md:px-6", h.variance === 0 ? "text-[#6B778C]" : Math.abs(h.variance) <= TOLERANCE ? "text-[#1B7A2E]" : "text-[#C62828]")}>
                      {signed(h.variance)}
                    </td>
                    <td className="px-4 py-2.5 font-bold tabular-nums text-[#172B4D] md:px-6">{KES(h.salesTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* freeze confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Freeze the Z report?</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px]">
              This locks {today?.zNo} for {today?.storeName} on {today?.businessDate}, banks closing cash of{" "}
              {today && KES(today.cashCounted ?? 0)} and posts the daily sales journal to the ledger. A frozen
              day cannot be reopened.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void freezeDay()}
              disabled={busy !== null}
              className="rounded-xl bg-[#172B4D] font-bold text-white hover:bg-[#0C1526]"
            >
              {busy === "close" ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Freeze day
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* -- small pieces (module level - never created during render) -- */

function Line({ k, v, bold, mono }: { k: string; v: string; bold?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-[#6B778C]">{k}</span>
      <span className={cn("truncate text-right", bold && "font-bold", mono && "tracking-wide")}>{v}</span>
    </div>
  );
}
