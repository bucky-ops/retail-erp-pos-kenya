"use client";

/**
 * DukaFlow - Stock take / cycle-count workspace.
 *
 * Opened from the Inventory screen "Stock Take" button. Three tabs:
 *   1. Count - the live counting grid for the open session: search lines,
 *      enter shelf quantities (steppers / direct input / "Same" quick match),
 *      live variance coloring, approve applies variances to real stock.
 *   2. Sessions - every count session with progress, value variance and
 *      status; resume counting or approve from here too.
 *   3. New count - open a session (snapshots system quantities so live sales
 *      during the count don't skew the math).
 *
 * Approve = one transaction applying every counted variance to StockLevel,
 * posting a digest to #stock-alerts and emitting stocktake:approved live.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardCheck, Loader2, Minus, Plus, ScanBarcode, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { KES } from "@/types";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/* ── contracts ────────────────────────────────────────────── */

interface SessionStat {
  id: number; stNo: string; status: string; category: string; startedBy: string; note: string;
  startedAt: string; approvedAt: string | null;
  store: { id: number; name: string };
  totalItems: number; countedItems: number;
  varianceValue: number; shortage: number; surplus: number;
}

interface TakeItem {
  id: number; productId: number; systemQty: number; countedQty: number | null;
  unitCost: number; counted: boolean; countedBy: string;
  product: { id: number; name: string; sku: string; emoji: string; unit: string; category: string; barcode: string | null };
}

interface FullSession {
  id: number; stNo: string; status: string; category: string; startedBy: string;
  store: { id: number; name: string };
  items: TakeItem[];
}

interface StoreLite { id: number; name: string }

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

const STATUS_CLS: Record<string, string> = {
  Counting: "bg-[#FFF8E1] text-[#B8860B]",
  Review: "bg-[#FFF8E1] text-[#B8860B]",
  Approved: "bg-[#E8F5E9] text-[#1B7A2E]",
  Cancelled: "bg-[#FFEBE8] text-[#FF5630]",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

/* ── component ────────────────────────────────────────────── */

export function StockTakeDialog({
  open,
  onOpenChange,
  stores,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  stores: StoreLite[];
  onDone?: () => void | Promise<void>;
}) {
  const [tab, setTab] = useState("count");
  const [sessions, setSessions] = useState<SessionStat[] | null>(null);
  const [busy, setBusy] = useState(false);

  /* open (countable) session + its full line list */
  const [activeId, setActiveId] = useState<number | null>(null);
  const [session, setSession] = useState<FullSession | null>(null);
  const [counts, setCounts] = useState<Record<number, number>>({}); // itemId → counted qty (edited locally)
  const [q, setQ] = useState("");
  /* scan-to-count: each barcode gun burst (Enter-terminated) = +1 physical unit */
  const [scan, setScan] = useState("");
  const [scanFlash, setScanFlash] = useState<number | null>(null); // itemId just scanned
  const scanRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{ applied: { name: string; delta: number; value: number }[]; shortageValue: number; surplusValue: number; netValue: number; stNo: string } | null>(null);

  /* new-count form */
  const [form, setForm] = useState({ storeId: "", category: "All", startedBy: "Owner", note: "" });

  const loadSessions = useCallback(async () => {
    try {
      const list = await api.get<SessionStat[]>("/api/stock-take");
      setSessions(list);
      return list;
    } catch (e) {
      toast({ title: "Could not load stock takes", description: err(e) });
      setSessions([]);
      return [];
    }
  }, []);

  const openSession = useCallback(async (id: number) => {
    setActiveId(id);
    setResult(null);
    setQ("");
    try {
      const full = await api.get<FullSession>(`/api/stock-take/${id}`);
      setSession(full);
      // seed local counts with what was already recorded
      const seeded: Record<number, number> = {};
      for (const it of full.items) if (it.counted && it.countedQty !== null) seeded[it.id] = it.countedQty;
      setCounts(seeded);
    } catch (e) {
      toast({ title: "Could not open session", description: err(e) });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const list = await loadSessions();
      const openSessionStat = list.find((s) => s.status === "Counting" || s.status === "Review");
      if (openSessionStat) {
        setTab("count");
        void openSession(openSessionStat.id);
      } else {
        setTab("sessions");
        setActiveId(null);
        setSession(null);
      }
    })();
  }, [open, loadSessions, openSession]);

  /* push one line count to the server (optimistic local state already set) */
  const saveCount = useCallback(async (item: TakeItem, qty: number) => {
    if (!session) return;
    setCounts((m) => ({ ...m, [item.id]: qty }));
    try {
      await api.patch(`/api/stock-take/${session.id}`, {
        action: "count", itemId: item.id, countedQty: qty, countedBy: session.startedBy,
      });
    } catch (e) {
      toast({ title: "Count not saved", description: err(e) });
    }
  }, [session]);

  /* scan-to-count: a scanned label (barcode gun fires Enter) bumps that line's
   * counted qty by 1 - the counter just scans every physical unit on the
   * shelf. Matches barcode first, then SKU. Unknown codes toast amber. */
  const handleScan = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!session || !code) return;
      const needle = code.toLowerCase();
      const item = session.items.find(
        (i) => (i.product.barcode ?? "").toLowerCase() === needle || i.product.sku.toLowerCase() === needle
      );
      if (!item) {
        toast({ title: `Unknown code: ${code}`, description: "Not a line in this count session", variant: "destructive" });
        return;
      }
      const next = (counts[item.id] ?? 0) + 1;
      await saveCount(item, next);
      setScanFlash(item.id);
      setTimeout(() => setScanFlash((f) => (f === item.id ? null : f)), 1200);
    },
    [session, counts, saveCount]
  );

  const onScanKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleScan(scan).then(() => setScan(""));
    }
  };

  const approve = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const d = await api.patch<{
        ok: boolean; applied: { name: string; delta: number; value: number }[];
        shortageValue: number; surplusValue: number; netValue: number;
      }>(`/api/stock-take/${session.id}`, { action: "approve" });
      setResult({ ...d, stNo: session.stNo });
      toast({
        title: `${session.stNo} approved - stock updated ✓`,
        description: `${d.applied.length} variance lines • net ${KES(d.netValue)} • #stock-alerts notified.`,
      });
      await loadSessions();
      await onDone?.();
      setSession(null);
      setActiveId(null);
      setTab("sessions");
    } catch (e) {
      toast({ title: "Approve failed", description: err(e) });
    } finally {
      setBusy(false);
    }
  };

  const cancelSession = async (id: number, stNo: string) => {
    setBusy(true);
    try {
      await api.patch(`/api/stock-take/${id}`, { action: "cancel" });
      toast({ title: `${stNo} cancelled`, description: "No stock was changed." });
      if (activeId === id) { setSession(null); setActiveId(null); }
      await loadSessions();
    } catch (e) {
      toast({ title: "Cancel failed", description: err(e) });
    } finally {
      setBusy(false);
    }
  };

  const createSession = async () => {
    if (!form.storeId) return;
    setBusy(true);
    try {
      const d = await api.post<{ ok: boolean; stNo: string; items: number }>("/api/stock-take", {
        storeId: Number(form.storeId),
        category: form.category,
        startedBy: form.startedBy || "Owner",
        note: form.note,
      });
      toast({
        title: `${d.stNo} opened ✓`,
        description: `${d.items} stock lines snapshotted - start counting!`,
      });
      setForm({ storeId: "", category: "All", startedBy: "Owner", note: "" });
      await loadSessions();
      await openSession((await api.get<SessionStat[]>("/api/stock-take")).find((s) => s.stNo === d.stNo)?.id ?? 0);
      setTab("count");
    } catch (e) {
      toast({ title: "Could not open count", description: err(e) });
    } finally {
      setBusy(false);
    }
  };

  /* derived */
  const openSessions = (sessions ?? []).filter((s) => s.status === "Counting" || s.status === "Review");
  const countedItems = session ? session.items.filter((i) => counts[i.id] !== undefined).length : 0;
  const filteredItems = useMemo(
    () =>
      (session?.items ?? []).filter((i) => {
        if (!q.trim()) return true;
        const t = q.toLowerCase();
        return i.product.name.toLowerCase().includes(t) || i.product.sku.toLowerCase().includes(t);
      }),
    [session, q]
  );
  const liveVariance = useMemo(() => {
    if (!session) return { value: 0, shortage: 0, surplus: 0 };
    let value = 0, shortage = 0, surplus = 0;
    for (const it of session.items) {
      if (counts[it.id] === undefined) continue;
      const v = (counts[it.id] - it.systemQty) * it.unitCost;
      value += v;
      if (v < 0) shortage++;
      if (v > 0) surplus++;
    }
    return { value, shortage, surplus };
  }, [session, counts]);

  const progressPct = session && session.items.length > 0 ? Math.round((countedItems / session.items.length) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2 text-[16px] text-[#172B4D]">
            <ClipboardCheck size={16} className="text-[#0052CC]" /> Stock take - cycle counts with variance control
          </DialogTitle>
          <DialogDescription>
            Snapshot stock, count the shelf, approve - variances land on real inventory with a full audit trail.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-9 w-full justify-start rounded-full border border-[#DFE1E6] bg-white p-1">
            <TabsTrigger value="count" className="rounded-full px-3 text-[12px] font-semibold data-[state=active]:bg-[#172B4D] data-[state=active]:text-white">
              Count {openSessions.length > 0 && <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF8F00]" />}
            </TabsTrigger>
            <TabsTrigger value="sessions" className="rounded-full px-3 text-[12px] font-semibold data-[state=active]:bg-[#172B4D] data-[state=active]:text-white">
              Sessions
            </TabsTrigger>
            <TabsTrigger value="new" className="rounded-full px-3 text-[12px] font-semibold data-[state=active]:bg-[#172B4D] data-[state=active]:text-white">
              New count
            </TabsTrigger>
          </TabsList>

          {/* ── COUNT (active session) ── */}
          <TabsContent value="count" className="space-y-3">
            {!session ? (
              <div className="rounded-xl border border-dashed border-[#DFE1E6] py-10 text-center">
                <ClipboardCheck className="mx-auto mb-2 h-8 w-8 text-[#DFE1E6]" />
                <p className="text-[13px] font-semibold text-[#172B4D]">No count session open</p>
                <p className="mx-auto mt-1 max-w-xs text-[11px] text-[#6B778C]">
                  Open one under “New count” - it snapshots today’s system quantities so sales during the count won’t skew variances.
                </p>
                {openSessions.length === 0 && (sessions?.length ?? 0) > 0 && (
                  <Button size="sm" onClick={() => setTab("sessions")} className="mt-3 h-8 rounded-lg bg-[#0052CC] text-[12px] font-bold text-white hover:bg-[#0041A8]">
                    View past sessions
                  </Button>
                )}
              </div>
            ) : (
              <>
                {/* session header + progress */}
                <div className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12px] font-bold text-[#172B4D]">{session.stNo}</span>
                    <span className="text-[11px] text-[#6B778C]">{session.store.name} • {session.category === "All" ? "all products" : session.category} • by {session.startedBy}</span>
                    <span className="ml-auto font-mono text-[11px] font-bold tabular-nums text-[#0052CC]">{countedItems}/{session.items.length} counted</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#DFE1E6]">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#0052CC] to-[#00C853] transition-all duration-500" style={{ width: `${progressPct}%` }} />
                  </div>
                </div>

                {/* scan-to-count (barcode gun types + Enter) */}
                <div className="df-scan-bar flex items-center gap-2 rounded-xl border border-[#B2DFDB] bg-[#E0F2F1] px-3 py-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#00695C] text-white">
                    <ScanBarcode size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Input
                      ref={scanRef}
                      value={scan}
                      onChange={(e) => setScan(e.target.value)}
                      onKeyDown={onScanKey}
                      placeholder="Scan a shelf label (or type barcode + Enter) - each scan = +1 unit counted"
                      className="h-8 rounded-lg border-[#B2DFDB] bg-white font-mono text-[12px]"
                      aria-label="Barcode scan to count"
                    />
                  </div>
                  <span className="shrink-0 rounded-full bg-[#00695C] px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-white">
                    Scan mode
                  </span>
                </div>

                {/* search */}
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B778C]" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a product or SKU to count…" className="h-8 rounded-lg pl-7 text-[12px]" />
                </div>

                {/* count lines */}
                <div className="df-scroll max-h-72 space-y-1 overflow-y-auto rounded-xl border border-[#DFE1E6] p-1.5">
                  {filteredItems.map((it) => {
                    const c = counts[it.id];
                    const isCounted = c !== undefined;
                    const variance = isCounted ? c - it.systemQty : null;
                    const vValue = variance !== null ? variance * it.unitCost : 0;
                    return (
                      <div key={it.id} className={cn(
                        "flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
                        scanFlash === it.id ? "df-scan-flash" : isCounted ? "bg-[#F0F7F0]" : "hover:bg-[#F4F5F7]"
                      )}>
                        <span className="text-[16px]">{it.product.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-semibold text-[#172B4D]">{it.product.name}</p>
                          <p className="text-[10px] text-[#6B778C]">
                            system <b className="font-mono tabular-nums">{Math.round(it.systemQty)}</b> {it.product.unit} • {it.product.sku} • cost {KES(it.unitCost)}
                          </p>
                        </div>
                        {variance !== null && (
                          <span className={cn(
                            "rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums",
                            variance === 0 ? "bg-[#F4F5F7] text-[#6B778C]" : variance > 0 ? "bg-[#E8F5E9] text-[#1B7A2E]" : "bg-[#FFEBE8] text-[#C62828]"
                          )}>
                            {variance > 0 ? "+" : ""}{Math.round(variance)} ({vValue > 0 ? "+" : ""}{KES(vValue, true)})
                          </span>
                        )}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => void saveCount(it, Math.max(0, (c ?? it.systemQty) - 1))}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#DFE1E6] bg-white text-[#172B4D] transition-colors hover:border-[#0052CC] hover:text-[#0052CC]"
                            aria-label={`Decrease counted quantity for ${it.product.name}`}
                          >
                            <Minus size={13} />
                          </button>
                          <input
                            type="number" min={0}
                            value={c ?? ""}
                            onChange={(e) => setCounts((m) => ({ ...m, [it.id]: Math.max(0, Number(e.target.value) || 0) }))}
                            onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && e.target.value !== "") void saveCount(it, Math.max(0, v)); }}
                            placeholder="-"
                            className="h-7 w-14 rounded-lg border border-[#DFE1E6] text-center font-mono text-[12px] font-bold tabular-nums text-[#172B4D] outline-none focus:border-[#0052CC]"
                            aria-label={`Counted quantity for ${it.product.name}`}
                          />
                          <button
                            onClick={() => void saveCount(it, (c ?? it.systemQty) + 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#DFE1E6] bg-white text-[#172B4D] transition-colors hover:border-[#0052CC] hover:text-[#0052CC]"
                            aria-label={`Increase counted quantity for ${it.product.name}`}
                          >
                            <Plus size={13} />
                          </button>
                          <button
                            onClick={() => void saveCount(it, it.systemQty)}
                            disabled={isCounted && c === it.systemQty}
                            className={cn(
                              "flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-bold transition-colors disabled:opacity-40",
                              isCounted && c === it.systemQty
                                ? "bg-[#E8F5E9] text-[#1B7A2E]"
                                : "border border-[#DFE1E6] bg-white text-[#6B778C] hover:border-[#00C853] hover:text-[#1B7A2E]"
                            )}
                            aria-label={`Mark ${it.product.name} as matching system quantity`}
                          >
                            <Check size={11} /> Same
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* live tally + approve */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#172B4D] px-4 py-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Live variance - {countedItems} counted, {session.items.length - countedItems} to go</p>
                    <p className="font-display text-[16px] font-bold text-white">
                      {KES(liveVariance.value)}
                      <span className="ml-2 text-[11px] font-semibold text-white/70">
                        ({liveVariance.surplus} surplus / {liveVariance.shortage} shortage)
                      </span>
                    </p>
                  </div>
                  <Button
                    onClick={() => void approve()}
                    disabled={busy || countedItems === 0}
                    className="h-10 rounded-xl bg-[#00C853] px-5 text-[13px] font-bold text-[#052E14] hover:bg-[#00B34A] disabled:opacity-40"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                    Apply &amp; approve
                  </Button>
                </div>
                <div className="flex justify-end">
                  <Button variant="ghost" disabled={busy} onClick={() => void cancelSession(session.id, session.stNo)} className="h-7 rounded-lg px-2.5 text-[11px] font-bold text-[#FF5630] hover:bg-[#FFEBE8]">
                    <X className="h-3 w-3" /> Cancel session
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          {/* ── SESSIONS ── */}
          <TabsContent value="sessions" className="space-y-2">
            <div className="df-scroll max-h-96 space-y-2 overflow-y-auto pr-1">
              {sessions === null ? (
                <p className="py-6 text-center text-[12px] text-[#6B778C]"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Loading…</p>
              ) : sessions.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-[#6B778C]">No stock takes yet - open your first count under “New count”.</p>
              ) : (
                sessions.map((s) => {
                  const pct = s.totalItems > 0 ? Math.round((s.countedItems / s.totalItems) * 100) : 0;
                  return (
                    <div key={s.id} className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] font-bold text-[#172B4D]">{s.stNo}</span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", STATUS_CLS[s.status] ?? "bg-[#F4F5F7] text-[#6B778C]")}>{s.status}</span>
                        <span className="min-w-0 flex-1 truncate text-[11px] text-[#6B778C]">
                          {s.store.name} • {fmtDate(s.startedAt)} • {s.startedBy} • {s.category}
                        </span>
                        {s.status !== "Cancelled" && s.countedItems > 0 && (
                          <span className={cn("font-mono text-[11px] font-bold tabular-nums", s.varianceValue < 0 ? "text-[#C62828]" : s.varianceValue > 0 ? "text-[#1B7A2E]" : "text-[#6B778C]")}>
                            {s.varianceValue > 0 ? "+" : ""}{KES(s.varianceValue, true)}
                          </span>
                        )}
                        {(s.status === "Counting" || s.status === "Review") && (
                          <>
                            <Button size="sm" onClick={() => { void openSession(s.id); setTab("count"); }} className="h-7 rounded-lg bg-[#0052CC] px-2.5 text-[11px] font-bold text-white hover:bg-[#0041A8]">
                              Resume count
                            </Button>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void cancelSession(s.id, s.stNo)} className="h-7 rounded-lg px-2.5 text-[11px] font-bold text-[#FF5630]">
                              Cancel
                            </Button>
                          </>
                        )}
                      </div>
                      {s.status !== "Cancelled" && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-1 flex-1 overflow-hidden rounded-full bg-[#DFE1E6]">
                            <div className={cn("h-full rounded-full", pct === 100 ? "bg-[#00C853]" : "bg-[#0052CC]")} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-24 text-right font-mono text-[10px] tabular-nums text-[#6B778C]">{s.countedItems}/{s.totalItems} lines</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </TabsContent>

          {/* ── NEW COUNT ── */}
          <TabsContent value="new" className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Store *</Label>
                <Select value={form.storeId} onValueChange={(v) => setForm((f) => ({ ...f, storeId: v }))}>
                  <SelectTrigger className="h-9 rounded-lg text-[12px]"><SelectValue placeholder="Pick a store" /></SelectTrigger>
                  <SelectContent>
                    {stores.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Scope</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger className="h-9 rounded-lg text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All products</SelectItem>
                    {["Cement", "Paint", "Plumbing", "Electrical", "Tools", "Hardware", "Building"].map((c) => (
                      <SelectItem key={c} value={c}>{c} only</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Count leader</Label>
                <Input value={form.startedBy} onChange={(e) => setForm((f) => ({ ...f, startedBy: e.target.value }))} className="h-9 rounded-lg text-[12px]" placeholder="Owner" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Note</Label>
                <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className="h-9 rounded-lg text-[12px]" placeholder="Monthly cycle count…" />
              </div>
            </div>
            <div className="rounded-xl border border-[#00C853]/30 bg-[#E8F5E9]/50 px-4 py-3">
              <p className="text-[11px] font-semibold text-[#1B7A2E]">
                How it works: the session snapshots every stock line in scope. Count the shelf at your pace - POS stays live. Approving applies each variance to real stock, values it at cost, and posts the digest to #stock-alerts.
              </p>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void createSession()} disabled={busy || !form.storeId} className="h-10 rounded-xl bg-[#0052CC] px-5 text-[13px] font-bold text-white hover:bg-[#0041A8] disabled:opacity-40">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                Open count session
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {/* approve result */}
        {result && (
          <div className="rounded-xl border border-[#00C853]/30 bg-[#E8F5E9]/60 p-4">
            <p className="font-display text-[14px] font-bold text-[#1B7A2E]">✓ {result.stNo} applied</p>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-white px-2 py-1.5">
                <p className="text-[9px] font-bold uppercase tracking-wide text-[#6B778C]">Shortage</p>
                <p className="font-mono text-[13px] font-bold text-[#C62828]">{KES(result.shortageValue, true)}</p>
              </div>
              <div className="rounded-lg bg-white px-2 py-1.5">
                <p className="text-[9px] font-bold uppercase tracking-wide text-[#6B778C]">Surplus</p>
                <p className="font-mono text-[13px] font-bold text-[#1B7A2E]">{KES(result.surplusValue, true)}</p>
              </div>
              <div className="rounded-lg bg-white px-2 py-1.5">
                <p className="text-[9px] font-bold uppercase tracking-wide text-[#6B778C]">Net</p>
                <p className={cn("font-mono text-[13px] font-bold", result.netValue < 0 ? "text-[#C62828]" : "text-[#1B7A2E]")}>{KES(result.netValue, true)}</p>
              </div>
            </div>
            <div className="df-scroll mt-2 max-h-28 space-y-0.5 overflow-y-auto">
              {result.applied.map((a, i) => (
                <p key={i} className="text-[11px] text-[#172B4D]">
                  • {a.delta > 0 ? "+" : ""}{Math.round(a.delta)} × {a.name} <span className="font-mono tabular-nums text-[#6B778C]">({KES(a.value, true)})</span>
                </p>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
