"use client";

/**
 * DukaFlow — Procurement workspace (Suppliers + reorder suggestions + POs).
 *
 * Opened from the Inventory screen "Procurement" button. Three tabs:
 *   1. Reorder suggestions — low-stock lines (qty ≤ reorderPoint) with a
 *      suggested cover qty and best-match supplier; create POs grouped per
 *      supplier in one click.
 *   2. Purchase orders — lifecycle Draft → Sent → Received/Partially Received
 *      with a GRN-style receive flow (partial receipts supported).
 *   3. Suppliers — directory + quick add.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Check, ChevronDown, Loader2, Plus, Send, ShoppingCart, Truck, Undo2, X } from "lucide-react";
import { api } from "@/lib/api";
import { KES } from "@/types";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/* ── contracts ────────────────────────────────────────────── */

interface Sugg {
  stockLevelId: number; productId: number; name: string; emoji: string; sku: string;
  category: string; storeId: number; storeName: string; qty: number; reorderPoint: number;
  suggestedQty: number; unitCost: number; lineTotal: number;
  supplierId: number | null; supplierName: string | null; leadDays: number;
}

interface POItem {
  id: number; productId: number; qty: number; unitCost: number; received: number;
  product: { name: string; emoji: string; sku: string; unit: string };
}

interface PO {
  id: number; poNo: string; status: string; total: number; note: string;
  orderedAt: string; receivedAt: string | null;
  supplierId: number; supplierName: string; storeId: number; storeName: string;
  items: POItem[];
}

interface Sup {
  id: number; name: string; phone: string; email: string; kraPin: string;
  category: string; leadDays: number; poCount: number;
}

interface StoreLite { id: number; name: string }

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

const STATUS_CLS: Record<string, string> = {
  Draft: "bg-[#F4F5F7] text-[#6B778C]",
  Sent: "bg-[#E9F2FF] text-[#0052CC]",
  "Partially Received": "bg-[#FFF8E1] text-[#B8860B]",
  Received: "bg-[#E8F5E9] text-[#1B7A2E]",
  Cancelled: "bg-[#FFEBE8] text-[#FF5630]",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

/* ── component ────────────────────────────────────────────── */

export function ProcurementDialog({
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
  const [tab, setTab] = useState("suggestions");
  const [sugg, setSugg] = useState<Sugg[] | null>(null);
  const [pos, setPos] = useState<PO[] | null>(null);
  const [sups, setSups] = useState<Sup[] | null>(null);
  const [busy, setBusy] = useState(false);

  /* per-suggestion overrides */
  const [qtyOv, setQtyOv] = useState<Record<number, number>>({}); // stockLevelId → qty
  const [supOv, setSupOv] = useState<Record<number, number>>({}); // stockLevelId → supplierId
  const [storeFilter, setStoreFilter] = useState<string>("all");

  /* receive flow */
  const [recvPo, setRecvPo] = useState<number | null>(null);
  const [recvQty, setRecvQty] = useState<Record<number, number>>({}); // poItemId → qty

  /* supplier add form */
  const [supForm, setSupForm] = useState({ name: "", phone: "", category: "General", leadDays: "3" });

  const loadAll = useCallback(async () => {
    try {
      const [s, p, sup] = await Promise.all([
        api.get<{ suggestions: Sugg[] }>("/api/purchase-orders?suggestions=1"),
        api.get<PO[]>("/api/purchase-orders"),
        api.get<Sup[]>("/api/suppliers"),
      ]);
      setSugg(s.suggestions);
      setPos(p);
      setSups(sup);
      // defaults: suggested qty + best-match supplier
      const q: Record<number, number> = {};
      const sp: Record<number, number> = {};
      for (const x of s.suggestions) {
        q[x.stockLevelId] = x.suggestedQty;
        if (x.supplierId) sp[x.stockLevelId] = x.supplierId;
      }
      setQtyOv(q);
      setSupOv(sp);
    } catch (e) {
      toast({ title: "Could not load procurement data", description: err(e) });
      setSugg([]); setPos([]); setSups([]);
    }
  }, []);

  useEffect(() => {
    if (open) void loadAll();
  }, [open, loadAll]);

  const filteredSugg = useMemo(
    () => (sugg ?? []).filter((s) => storeFilter === "all" || s.storeId === Number(storeFilter)),
    [sugg, storeFilter]
  );
  const selectedLines = filteredSugg.filter((s) => (qtyOv[s.stockLevelId] ?? 0) > 0 && supOv[s.stockLevelId]);

  /* create POs grouped per supplier — mirrors how buyers actually send POs */
  const createPOs = async () => {
    if (!selectedLines.length || !sups?.length) return;
    setBusy(true);
    try {
      const bySupplier = new Map<number, Sugg[]>();
      for (const s of selectedLines) {
        const sid = supOv[s.stockLevelId] ?? s.supplierId;
        if (!sid) continue;
        bySupplier.set(sid, [...(bySupplier.get(sid) ?? []), s]);
      }
      let created = 0;
      for (const [supplierId, lines] of bySupplier) {
        // lines may span stores; group again per store within the supplier
        const byStore = new Map<number, Sugg[]>();
        for (const l of lines) byStore.set(l.storeId, [...(byStore.get(l.storeId) ?? []), l]);
        for (const [storeId, sls] of byStore) {
          await api.post("/api/purchase-orders", {
            supplierId,
            storeId,
            note: "Auto-drafted from low-stock reorder suggestions",
            items: sls.map((l) => ({ productId: l.productId, qty: qtyOv[l.stockLevelId], unitCost: l.unitCost })),
          });
          created++;
        }
      }
      toast({
        title: `${created} purchase order${created === 1 ? "" : "s"} drafted ✓`,
        description: "Find them under the Purchase orders tab — Send, then Receive stock.",
      });
      await loadAll();
      setTab("pos");
    } catch (e) {
      toast({ title: "Could not create PO", description: err(e) });
    } finally {
      setBusy(false);
    }
  };

  const poAction = async (po: PO, action: "send" | "cancel") => {
    setBusy(true);
    try {
      await api.patch(`/api/purchase-orders/${po.id}`, { action });
      toast({
        title: action === "send" ? `${po.poNo} sent to ${po.supplierName} ✓` : `${po.poNo} cancelled`,
        description: action === "send" ? "Receiving stock is one tap once the delivery arrives." : undefined,
      });
      await loadAll();
    } catch (e) {
      toast({ title: "Action failed", description: err(e) });
    } finally {
      setBusy(false);
    }
  };

  const confirmReceive = async (po: PO) => {
    const lines = Object.entries(recvQty)
      .filter(([, q]) => q > 0)
      .map(([itemId, qty]) => ({ itemId: Number(itemId), qty }));
    if (!lines.length) return;
    setBusy(true);
    try {
      const d = await api.patch<{ ok: boolean; po: { status: string } }>(`/api/purchase-orders/${po.id}`, {
        action: "receive",
        lines,
      });
      toast({
        title: `GRN posted — ${po.poNo} ${d.po.status.toLowerCase()} ✓`,
        description: "Store stock updated and #stock-alerts notified.",
      });
      setRecvPo(null);
      setRecvQty({});
      await loadAll();
      await onDone?.();
    } catch (e) {
      toast({ title: "Receive failed", description: err(e) });
    } finally {
      setBusy(false);
    }
  };

  const addSupplier = async () => {
    if (!supForm.name.trim()) return;
    setBusy(true);
    try {
      await api.post("/api/suppliers", {
        name: supForm.name,
        phone: supForm.phone,
        category: supForm.category,
        leadDays: Number(supForm.leadDays) || 3,
      });
      toast({ title: "Supplier added ✓", description: supForm.name });
      setSupForm({ name: "", phone: "", category: "General", leadDays: "3" });
      await loadAll();
    } catch (e) {
      toast({ title: "Could not add supplier", description: err(e) });
    } finally {
      setBusy(false);
    }
  };

  const suggTotal = selectedLines.reduce(
    (s, l) => s + (qtyOv[l.stockLevelId] ?? 0) * l.unitCost,
    0
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2 text-[16px] text-[#172B4D]">
            <ShoppingCart size={16} className="text-[#0052CC]" /> Procurement — suppliers, reorder & receive
          </DialogTitle>
          <DialogDescription>
            Auto-draft POs from low stock, send them to suppliers and receive goods into stores.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-9 w-full justify-start rounded-full border border-[#DFE1E6] bg-white p-1">
            <TabsTrigger value="suggestions" className="rounded-full px-3 text-[12px] font-semibold data-[state=active]:bg-[#172B4D] data-[state=active]:text-white">
              Reorder suggestions {(sugg?.length ?? 0) > 0 && <span className="ml-1 rounded-full bg-[#FF5630] px-1.5 text-[10px] font-bold text-white">{sugg?.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="pos" className="rounded-full px-3 text-[12px] font-semibold data-[state=active]:bg-[#172B4D] data-[state=active]:text-white">
              Purchase orders
            </TabsTrigger>
            <TabsTrigger value="suppliers" className="rounded-full px-3 text-[12px] font-semibold data-[state=active]:bg-[#172B4D] data-[state=active]:text-white">
              Suppliers
            </TabsTrigger>
          </TabsList>

          {/* ── SUGGESTIONS ── */}
          <TabsContent value="suggestions" className="space-y-3">
            <div className="flex items-center gap-2">
              <Select value={storeFilter} onValueChange={setStoreFilter}>
                <SelectTrigger className="h-8 w-44 rounded-lg text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stores</SelectItem>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[11px] text-[#6B778C]">
                {filteredSugg.length} lines at/below reorder point
              </span>
            </div>

            <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl border border-[#DFE1E6] p-2">
              {sugg === null ? (
                <p className="py-6 text-center text-[12px] text-[#6B778C]"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Loading suggestions…</p>
              ) : filteredSugg.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-[#6B778C]">All stock is healthy — nothing to reorder. 🎉</p>
              ) : (
                filteredSugg.map((s) => (
                  <div key={s.stockLevelId} className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#F4F5F7]">
                    <span className="text-[16px]">{s.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-semibold text-[#172B4D]">{s.name}</p>
                      <p className="text-[10px] text-[#6B778C]">
                        {s.storeName} • stock {Math.round(s.qty)} / reorder at {Math.round(s.reorderPoint)} • cost {KES(s.unitCost)}
                      </p>
                    </div>
                    <input
                      type="number" min={0}
                      value={qtyOv[s.stockLevelId] ?? 0}
                      onChange={(e) => setQtyOv((m) => ({ ...m, [s.stockLevelId]: Math.max(0, Number(e.target.value) || 0) }))}
                      className="h-7 w-16 rounded-lg border border-[#DFE1E6] text-center font-mono text-[12px] font-bold tabular-nums text-[#172B4D] outline-none focus:border-[#0052CC]"
                      aria-label={`Order quantity for ${s.name}`}
                    />
                    <Select
                      value={supOv[s.stockLevelId] ? String(supOv[s.stockLevelId]) : undefined}
                      onValueChange={(v) => setSupOv((m) => ({ ...m, [s.stockLevelId]: Number(v) }))}
                    >
                      <SelectTrigger className="h-7 w-40 rounded-lg text-[11px]">
                        <SelectValue placeholder="Pick supplier" />
                      </SelectTrigger>
                      <SelectContent>
                        {(sups ?? []).map((x) => (
                          <SelectItem key={x.id} value={String(x.id)}>
                            {x.name} · {x.leadDays}d
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between rounded-xl bg-[#172B4D] px-4 py-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">
                  Draft POs — {selectedLines.length} lines (grouped per supplier)
                </p>
                <p className="font-display text-[16px] font-bold text-white">{KES(suggTotal)}</p>
              </div>
              <Button
                onClick={() => void createPOs()}
                disabled={busy || selectedLines.length === 0}
                className="h-10 rounded-xl bg-[#00C853] px-5 text-[13px] font-bold text-[#052E14] hover:bg-[#00B34A] disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                Create purchase orders
              </Button>
            </div>
          </TabsContent>

          {/* ── PURCHASE ORDERS ── */}
          <TabsContent value="pos" className="space-y-2">
            <div className="df-scroll max-h-96 space-y-2 overflow-y-auto pr-1">
              {pos === null ? (
                <p className="py-6 text-center text-[12px] text-[#6B778C]"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Loading…</p>
              ) : pos.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-[#6B778C]">No purchase orders yet — draft them from reorder suggestions.</p>
              ) : (
                pos.map((po) => (
                  <div key={po.id} className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC]">
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                      <span className="font-mono text-[12px] font-bold text-[#172B4D]">{po.poNo}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", STATUS_CLS[po.status] ?? "bg-[#F4F5F7] text-[#6B778C]")}>
                        {po.status}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-[#6B778C]">
                        {po.supplierName} → {po.storeName} • {fmtDate(po.orderedAt)} • {po.items.length} lines
                      </span>
                      <span className="font-display text-[13px] font-bold text-[#172B4D]">{KES(po.total)}</span>

                      {po.status === "Draft" && (
                        <>
                          <Button size="sm" disabled={busy} onClick={() => void poAction(po, "send")} className="h-7 rounded-lg bg-[#0052CC] px-2.5 text-[11px] font-bold text-white hover:bg-[#0041A8]">
                            <Send className="h-3 w-3" /> Send
                          </Button>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => void poAction(po, "cancel")} className="h-7 rounded-lg px-2.5 text-[11px] font-bold text-[#FF5630]">
                            <X className="h-3 w-3" /> Cancel
                          </Button>
                        </>
                      )}
                      {(po.status === "Sent" || po.status === "Partially Received") && (
                        <Button size="sm" onClick={() => { setRecvPo(recvPo === po.id ? null : po.id); setRecvQty({}); }} className="h-7 rounded-lg bg-[#00C853] px-2.5 text-[11px] font-bold text-[#052E14] hover:bg-[#00B34A]">
                          <Truck className="h-3 w-3" /> Receive
                        </Button>
                      )}
                    </div>

                    {/* lines — always visible for context; editable in receive mode */}
                    <div className="space-y-1 border-t border-[#DFE1E6] px-3 py-2">
                      {po.items.map((it) => (
                        <div key={it.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span>{it.product.emoji}</span>
                          <span className="min-w-0 flex-1 truncate font-semibold text-[#172B4D]">{it.product.name}</span>
                          <span className="font-mono tabular-nums text-[#6B778C]">
                            {Math.round(it.received)}/{Math.round(it.qty)} {it.product.unit} @ {KES(it.unitCost)}
                          </span>
                          {recvPo === po.id && it.received < it.qty && (
                            <input
                              type="number" min={0} max={it.qty - it.received}
                              value={recvQty[it.id] ?? 0}
                              onChange={(e) => setRecvQty((m) => ({ ...m, [it.id]: Math.max(0, Math.min(it.qty - it.received, Number(e.target.value) || 0)) }))}
                              className="h-6 w-16 rounded-md border border-[#DFE1E6] text-center font-mono text-[11px] font-bold tabular-nums outline-none focus:border-[#00C853]"
                              aria-label={`Received quantity for ${it.product.name}`}
                            />
                          )}
                          {it.received >= it.qty && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-[#E8F5E9] px-1.5 py-0.5 text-[9px] font-bold text-[#1B7A2E]">
                              <Check className="h-2.5 w-2.5" /> in
                            </span>
                          )}
                        </div>
                      ))}
                      {recvPo === po.id && (
                        <div className="flex items-center justify-between pt-1.5">
                          <p className="text-[10px] text-[#6B778C]">Partial receipts are fine — receive what physically arrived.</p>
                          <Button size="sm" disabled={busy || Object.values(recvQty).every((q) => !q)} onClick={() => void confirmReceive(po)} className="h-7 rounded-lg bg-[#00C853] px-3 text-[11px] font-bold text-[#052E14] hover:bg-[#00B34A] disabled:opacity-40">
                            <Truck className="h-3 w-3" /> Confirm receipt
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          {/* ── SUPPLIERS ── */}
          <TabsContent value="suppliers" className="space-y-3">
            <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-[#DFE1E6] p-2">
              {(sups ?? []).map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#F4F5F7]">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#E9F2FF] text-[#0052CC]">
                    <Building2 size={12} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-[#172B4D]">{s.name}</p>
                    <p className="text-[10px] text-[#6B778C]">{s.phone || "—"} • {s.kraPin || "no PIN"}</p>
                  </div>
                  <Badge variant="outline" className="rounded-full border-[#DFE1E6] text-[10px] font-semibold text-[#6B778C]">{s.category}</Badge>
                  <span className="text-[10px] text-[#6B778C]">{s.leadDays}d lead • {s.poCount} POs</span>
                </div>
              ))}
            </div>

            {/* quick add */}
            <div className="rounded-xl border border-[#DFE1E6] bg-white p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-[#172B4D]">
                <Plus size={13} className="text-[#0052CC]" /> Add a supplier
              </p>
              <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-5">
                <Input value={supForm.name} onChange={(e) => setSupForm((f) => ({ ...f, name: e.target.value }))} placeholder="Name *" className="h-8 rounded-lg text-[12px]" />
                <Input value={supForm.phone} onChange={(e) => setSupForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Phone" className="h-8 rounded-lg text-[12px]" />
                <Select value={supForm.category} onValueChange={(v) => setSupForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger className="h-8 rounded-lg text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["General", "Cement", "Paint", "Plumbing", "Tools", "Electrical", "Hardware"].map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="number" min={1} value={supForm.leadDays} onChange={(e) => setSupForm((f) => ({ ...f, leadDays: e.target.value }))} placeholder="Lead days" className="h-8 rounded-lg text-[12px]" />
                <Button onClick={() => void addSupplier()} disabled={busy || !supForm.name.trim()} className="h-8 rounded-lg bg-[#0052CC] text-[12px] font-bold text-white hover:bg-[#0041A8] disabled:opacity-40">
                  Add supplier
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
