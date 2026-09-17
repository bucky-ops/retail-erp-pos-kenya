"use client";

/**
 * DukaFlow — Procurement workspace (Suppliers + reorder suggestions + POs + RTV).
 *
 * Opened from the Inventory screen "Procurement" button. Four tabs:
 *   1. Reorder suggestions — low-stock lines (qty ≤ reorderPoint) with a
 *      suggested cover qty and best-match supplier; create POs grouped per
 *      supplier in one click.
 *   2. Purchase orders — lifecycle Draft → Sent → Received/Partially Received
 *      with a GRN-style receive flow (partial receipts supported).
 *   3. Suppliers — directory + quick add.
 *   4. Return to vendor — send damaged/wrong/warranty/overstock goods back
 *      with a numbered debit note (RTV-xxxx / DN-xxxx); stock decrements and
 *      the supplier can be marked credited when the money lands.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Check, ChevronDown, FileText, Loader2, PackageMinus, Plus, Printer, Send, ShoppingCart, Tag, Truck, Undo2, X } from "lucide-react";
import { api } from "@/lib/api";
import { KES, type ProductDto } from "@/types";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
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

interface RTV {
  id: number; rtnNo: string; debitNoteNo: string; reason: string; total: number; status: string; note: string; createdAt: string;
  supplier: { id: number; name: string };
  store: { id: number; name: string };
  items: { id: number; qty: number; unitCost: number; total: number; product: { name: string; emoji: string; sku: string } }[];
}

/* stock line used to pick + validate RTV quantities */
interface StockRow { productId: number; name: string; emoji: string; sku: string; storeId: number; qty: number; cost: number }

/* supplier reconciliation statement (POs + RTV debit notes + price list) */
interface SupStmt {
  supplier: { id: number; name: string; phone: string; email: string; kraPin: string; category: string; leadDays: number };
  pos: {
    id: number; poNo: string; status: string; total: number; receivedValue: number; outstandingValue: number;
    orderedAt: string; receivedAt: string | null; storeName: string; lines: number;
    items: { name: string; emoji: string; qty: number; received: number; unitCost: number }[];
  }[];
  rtvs: {
    id: number; rtnNo: string; debitNoteNo: string; reason: string; total: number; status: string; note: string;
    createdAt: string; storeName: string; items: { name: string; emoji: string; qty: number; unitCost: number }[];
  }[];
  prices: {
    productId: number; name: string; emoji: string; sku: string; unit: string;
    catalogCost: number; negotiatedCost: number; savingPerUnit: number; updatedAt: string;
  }[];
  summary: {
    poCount: number; openPos: number; orderedValue: number; purchasedValue: number; openOrdersValue: number;
    cancelledValue: number; rtvCount: number; returnedValue: number; creditedValue: number;
    pendingCreditValue: number; netTraded: number; priceListCount: number; priceListSavings: number; generatedAt: string;
  };
}

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

const STATUS_CLS: Record<string, string> = {
  Draft: "bg-[#F4F5F7] text-[#6B778C]",
  Sent: "bg-[#E9F2FF] text-[#0052CC]",
  "Partially Received": "bg-[#FFF8E1] text-[#B8860B]",
  Received: "bg-[#E8F5E9] text-[#1B7A2E]",
  Cancelled: "bg-[#FFEBE8] text-[#FF5630]",
  Counting: "bg-[#FFF8E1] text-[#B8860B]",
  Approved: "bg-[#E8F5E9] text-[#1B7A2E]",
  Credited: "bg-[#E8F5E9] text-[#1B7A2E]",
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

  /* supplier price list editor (negotiated per-product costs) */
  const [priceSup, setPriceSup] = useState<Sup | null>(null);
  const [priceQ, setPriceQ] = useState("");
  const [priceEdits, setPriceEdits] = useState<Record<number, string>>({}); // productId → negotiated cost ("" clears)
  const [priceCatalog, setPriceCatalog] = useState<ProductDto[] | null>(null);
  const [priceBusy, setPriceBusy] = useState(false);

  /* supplier reconciliation statement */
  const [stmtSup, setStmtSup] = useState<Sup | null>(null);
  const [stmtData, setStmtData] = useState<SupStmt | null>(null);
  const [stmtLoading, setStmtLoading] = useState(false);
  const [stmtBusy, setStmtBusy] = useState(false);

  /* return-to-vendor form */
  const [rtvs, setRtvs] = useState<RTV[] | null>(null);
  const [stockRows, setStockRows] = useState<StockRow[] | null>(null);
  const [rtvForm, setRtvForm] = useState({ supplierId: "", storeId: "", reason: "Damaged", note: "" });
  const [rtvPick, setRtvPick] = useState(""); // product picker value
  const [rtvLines, setRtvLines] = useState<{ productId: number; name: string; emoji: string; qty: number; max: number; cost: number }[]>([]);

  const loadAll = useCallback(async () => {
    try {
      const [s, p, sup, rv] = await Promise.all([
        api.get<{ suggestions: Sugg[] }>("/api/purchase-orders?suggestions=1"),
        api.get<PO[]>("/api/purchase-orders"),
        api.get<Sup[]>("/api/suppliers"),
        api.get<RTV[]>("/api/supplier-returns"),
      ]);
      setSugg(s.suggestions);
      setPos(p);
      setSups(sup);
      setRtvs(rv);
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
      setSugg([]); setPos([]); setSups([]); setRtvs([]);
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

  /* checkbox include/exclude — unchecking zeroes the line's qty, checking
   * restores the suggested qty, so the draft-PO logic stays untouched. */
  const toggleLine = (stockLevelId: number, included: boolean, suggestedQty: number) =>
    setQtyOv((m) => ({ ...m, [stockLevelId]: included ? suggestedQty : 0 }));
  const allSelected = filteredSugg.length > 0 && filteredSugg.every((s) => (qtyOv[s.stockLevelId] ?? 0) > 0);
  const toggleAll = () =>
    setQtyOv((m) => {
      const next = { ...m };
      for (const s of filteredSugg) next[s.stockLevelId] = allSelected ? 0 : s.suggestedQty;
      return next;
    });

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

  /* ── supplier price list editor ─────────────────────────────── */

  const openPriceList = async (s: Sup) => {
    setPriceSup(s);
    setPriceQ("");
    setPriceBusy(true);
    try {
      const [catalog, rows] = await Promise.all([
        api.get<ProductDto[]>("/api/products"),
        api.get<{ productId: number; cost: number }[]>(`/api/suppliers/prices?supplierId=${s.id}`),
      ]);
      setPriceCatalog(catalog);
      const edits: Record<number, string> = {};
      for (const r of rows) edits[r.productId] = String(r.cost);
      setPriceEdits(edits);
    } catch (e) {
      toast({ title: "Could not load price list", description: err(e) });
      setPriceSup(null);
    } finally {
      setPriceBusy(false);
    }
  };

  const savePriceList = async () => {
    if (!priceSup) return;
    setPriceBusy(true);
    try {
      const prices = Object.entries(priceEdits).map(([pid, cost]) => ({
        productId: Number(pid),
        cost: cost.trim() === "" ? null : Number(cost),
      }));
      const d = await api.put<{ ok: boolean; saved: number; cleared: number; supplierName: string }>(
        "/api/suppliers/prices",
        { supplierId: priceSup.id, prices }
      );
      toast({
        title: `Price list saved — ${d.supplierName}`,
        description: `${d.saved} negotiated cost${d.saved === 1 ? "" : "s"} set • ${d.cleared} cleared`,
      });
      setPriceSup(null);
      await loadAll(); // suggestions re-quote with the new negotiated costs
    } catch (e) {
      toast({ title: "Save failed", description: err(e), variant: "destructive" });
    } finally {
      setPriceBusy(false);
    }
  };

  const priceFiltered = useMemo(() => {
    const needle = priceQ.trim().toLowerCase();
    return (priceCatalog ?? []).filter(
      (p) => !needle || p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle)
    );
  }, [priceCatalog, priceQ]);

  const priceSetCount = Object.values(priceEdits).filter((v) => v.trim() !== "" && Number(v) > 0).length;

  const suggTotal = selectedLines.reduce(
    (s, l) => s + (qtyOv[l.stockLevelId] ?? 0) * l.unitCost,
    0
  );

  /* ── return-to-vendor ── */

  /* load stock for the picked store when the RTV tab store changes */
  const loadRtvStock = useCallback(async (storeId: string) => {
    if (!storeId) { setStockRows(null); return; }
    try {
      const d = await api.get<{ rows: StockRow[] }>(`/api/inventory?storeId=${storeId}`);
      setStockRows(d.rows);
    } catch {
      setStockRows([]);
    }
  }, []);

  useEffect(() => {
    if (open) void loadRtvStock(rtvForm.storeId);
  }, [open, rtvForm.storeId, loadRtvStock]);

  const rtvStockOptions = useMemo(
    () => (stockRows ?? []).filter((r) => r.qty > 0 && !rtvLines.some((l) => l.productId === r.productId)),
    [stockRows, rtvLines]
  );

  const addRtvLine = () => {
    const row = (stockRows ?? []).find((r) => String(r.productId) === rtvPick);
    if (!row) return;
    setRtvLines((ls) => [...ls, { productId: row.productId, name: row.name, emoji: row.emoji, qty: 1, max: Math.floor(row.qty), cost: row.cost }]);
    setRtvPick("");
  };

  const rtvTotal = rtvLines.reduce((s, l) => s + l.qty * l.cost, 0);

  const submitRtv = async () => {
    if (!rtvForm.supplierId || !rtvForm.storeId || rtvLines.length === 0) return;
    setBusy(true);
    try {
      const d = await api.post<{ ok: boolean; rtnNo: string; debitNoteNo: string; total: number }>("/api/supplier-returns", {
        supplierId: Number(rtvForm.supplierId),
        storeId: Number(rtvForm.storeId),
        reason: rtvForm.reason,
        note: rtvForm.note,
        lines: rtvLines.map((l) => ({ productId: l.productId, qty: l.qty })),
      });
      toast({
        title: `${d.rtnNo} created — ${d.debitNoteNo} for ${KES(d.total)} ✓`,
        description: "Stock decremented and #stock-alerts notified.",
      });
      setRtvLines([]);
      setRtvForm((f) => ({ ...f, note: "" }));
      await loadAll();
      await onDone?.();
    } catch (e) {
      toast({ title: "Return failed", description: err(e) });
    } finally {
      setBusy(false);
    }
  };

  const creditRtv = async (r: RTV) => {
    setBusy(true);
    try {
      await api.patch("/api/supplier-returns", { id: r.id });
      toast({ title: `${r.debitNoteNo} marked credited ✓`, description: `${r.supplier.name} reconciled.` });
      await loadAll();
    } catch (e) {
      toast({ title: "Update failed", description: err(e) });
    } finally {
      setBusy(false);
    }
  };

  /* ── supplier statement: load → render → print ───────── */
  const openStatement = async (s: Sup) => {
    setStmtSup(s);
    setStmtData(null);
    setStmtLoading(true);
    try {
      const d = await api.get<SupStmt>(`/api/suppliers/${s.id}/statement`);
      setStmtData(d);
    } catch (e) {
      toast({ title: "Could not load statement", description: err(e) });
      setStmtSup(null);
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

  return (
    <>
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
            <TabsTrigger value="rtv" className="rounded-full px-3 text-[12px] font-semibold data-[state=active]:bg-[#172B4D] data-[state=active]:text-white">
              <PackageMinus className="mr-1 inline h-3 w-3" /> Return to vendor
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
              {filteredSugg.length > 0 && (
                <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] font-bold text-[#0052CC]">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 accent-[#0052CC]"
                    aria-label="Select every suggested line"
                  />
                  {allSelected ? "Deselect all" : "Select all"}
                </label>
              )}
            </div>

            <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl border border-[#DFE1E6] p-2">
              {sugg === null ? (
                <p className="py-6 text-center text-[12px] text-[#6B778C]"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Loading suggestions…</p>
              ) : filteredSugg.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-[#6B778C]">All stock is healthy — nothing to reorder. 🎉</p>
              ) : (
                filteredSugg.map((s) => (
                  <div key={s.stockLevelId} className={cn(
                    "flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
                    (qtyOv[s.stockLevelId] ?? 0) > 0 ? "bg-[#F0F7F0]" : "bg-[#FAFBFC] opacity-70 hover:opacity-100"
                  )}>
                    <input
                      type="checkbox"
                      checked={(qtyOv[s.stockLevelId] ?? 0) > 0}
                      onChange={(e) => toggleLine(s.stockLevelId, e.target.checked, s.suggestedQty)}
                      className="h-3.5 w-3.5 shrink-0 accent-[#0052CC]"
                      aria-label={`Include ${s.name} in the purchase order draft`}
                    />
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
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void openStatement(s)}
                    className="h-7 rounded-lg px-2 text-[10.5px] font-bold text-[#172B4D] hover:border-[#172B4D] hover:bg-[#F4F5F7]"
                  >
                    <FileText className="h-3 w-3" /> Statement
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void openPriceList(s)}
                    className="h-7 rounded-lg px-2 text-[10.5px] font-bold text-[#0052CC] hover:border-[#0052CC] hover:bg-[#E9F2FF]"
                  >
                    <Tag className="h-3 w-3" /> Price list
                  </Button>
                </div>
              ))}
            </div>

            {/* negotiated price list editor */}
            {priceSup && (
              <div className="rounded-xl border border-[#0052CC]/40 bg-[#F7FAFF] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0052CC] text-white">
                    <Tag size={13} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-bold text-[#172B4D]">Price list — {priceSup.name}</p>
                    <p className="text-[10px] text-[#6B778C]">
                      Negotiated costs override the catalog on reorder suggestions &amp; new POs. Blank = fall back to catalog.
                    </p>
                  </div>
                  <span className="rounded-full bg-[#E9F2FF] px-2 py-0.5 text-[10px] font-bold text-[#0052CC]">{priceSetCount} set</span>
                  <Button size="sm" variant="ghost" onClick={() => setPriceSup(null)} className="h-7 rounded-lg px-2 text-[11px] font-bold text-[#6B778C] hover:bg-white">
                    <X className="h-3 w-3" /> Close
                  </Button>
                </div>
                <div className="mt-2">
                  <Input
                    value={priceQ}
                    onChange={(e) => setPriceQ(e.target.value)}
                    placeholder="Search products…"
                    className="h-8 rounded-lg bg-white text-[12px]"
                  />
                </div>
                {priceBusy && !priceCatalog ? (
                  <div className="flex items-center justify-center py-6 text-[#6B778C]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : (
                  <div className="df-scroll mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
                    {priceFiltered.map((p) => {
                      const edit = priceEdits[p.id] ?? "";
                      const negotiated = edit.trim() !== "" && Number(edit) > 0;
                      const saving = negotiated ? Math.round((p.cost - Number(edit)) * 100) / 100 : 0;
                      return (
                        <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-2 py-1.5 shadow-sm">
                          <span className="text-[14px]">{p.emoji}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11.5px] font-semibold text-[#172B4D]">{p.name}</p>
                            <p className="text-[9.5px] text-[#6B778C]">catalog cost {KES(p.cost)} / {p.unit}</p>
                          </div>
                          {negotiated && saving !== 0 && (
                            <span className={cn(
                              "rounded-full px-1.5 py-0.5 font-mono text-[9px] font-bold",
                              saving > 0 ? "bg-[#E8F5E9] text-[#1B7A2E]" : "bg-[#FFEBE8] text-[#C62828]"
                            )}>
                              {saving > 0 ? "−" : "+"}{KES(Math.abs(saving), true)} vs catalog
                            </span>
                          )}
                          <div className="relative w-24">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#6B778C]">KES</span>
                            <input
                              value={edit}
                              onChange={(e) => setPriceEdits((m) => ({ ...m, [p.id]: e.target.value.replace(/[^\d.]/g, "") }))}
                              inputMode="decimal"
                              placeholder="—"
                              aria-label={`Negotiated cost for ${p.name} from ${priceSup.name}`}
                              className={cn(
                                "h-7 w-full rounded-lg border pl-9 pr-1 text-center font-mono text-[11.5px] font-bold tabular-nums outline-none",
                                negotiated ? "border-[#0052CC]/50 text-[#0052CC]" : "border-[#DFE1E6] text-[#172B4D]"
                              )}
                            />
                          </div>
                        </div>
                      );
                    })}
                    {priceFiltered.length === 0 && (
                      <p className="py-4 text-center text-[11px] text-[#6B778C]">No products match.</p>
                    )}
                  </div>
                )}
                <div className="mt-2 flex items-center justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setPriceSup(null)} className="h-8 rounded-lg px-3 text-[11px] font-bold text-[#172B4D]">
                    Cancel
                  </Button>
                  <Button size="sm" disabled={priceBusy} onClick={() => void savePriceList()} className="h-8 rounded-lg bg-[#0052CC] px-4 text-[11px] font-bold text-white hover:bg-[#0041A8]">
                    {priceBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save price list
                  </Button>
                </div>
              </div>
            )}

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
          {/* ── RETURN TO VENDOR ── */}
          <TabsContent value="rtv" className="space-y-3">
            <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
              <Select value={rtvForm.supplierId} onValueChange={(v) => setRtvForm((f) => ({ ...f, supplierId: v }))}>
                <SelectTrigger className="h-8 rounded-lg text-[12px]"><SelectValue placeholder="Supplier *" /></SelectTrigger>
                <SelectContent>
                  {(sups ?? []).map((x) => (
                    <SelectItem key={x.id} value={String(x.id)}>{x.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={rtvForm.storeId} onValueChange={(v) => setRtvForm((f) => ({ ...f, storeId: v }))}>
                <SelectTrigger className="h-8 rounded-lg text-[12px]"><SelectValue placeholder="From store *" /></SelectTrigger>
                <SelectContent>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={rtvForm.reason} onValueChange={(v) => setRtvForm((f) => ({ ...f, reason: v }))}>
                <SelectTrigger className="h-8 rounded-lg text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Damaged", "Wrong item", "Warranty", "Overstock"].map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={rtvForm.note} onChange={(e) => setRtvForm((f) => ({ ...f, note: e.target.value }))} placeholder="Note (optional)" className="h-8 rounded-lg text-[12px]" />
            </div>

            {/* product picker (needs a store first) */}
            {rtvForm.storeId ? (
              <div className="flex items-center gap-2">
                <Select value={rtvPick} onValueChange={setRtvPick}>
                  <SelectTrigger className="h-8 flex-1 rounded-lg text-[12px]">
                    <SelectValue placeholder={stockRows === null ? "Loading stock…" : "Pick a product to return"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-56">
                    {rtvStockOptions.length === 0 ? (
                      <p className="px-3 py-2 text-center text-[11px] text-[#6B778C]">Everything here is already picked or out of stock.</p>
                    ) : (
                      rtvStockOptions.map((r) => (
                        <SelectItem key={r.productId} value={String(r.productId)}>
                          {r.emoji} {r.name} — {Math.floor(r.qty)} in stock
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={!rtvPick} onClick={addRtvLine} className="h-8 rounded-lg bg-[#0052CC] px-3 text-[11px] font-bold text-white hover:bg-[#0041A8] disabled:opacity-40">
                  <Plus className="h-3 w-3" /> Add
                </Button>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-[#DFE1E6] py-6 text-center text-[12px] text-[#6B778C]">
                Pick the supplier and the store you’re returning from to load its stock.
              </p>
            )}

            {/* lines */}
            {rtvLines.length > 0 && (
              <div className="space-y-1 rounded-xl border border-[#DFE1E6] p-2">
                {rtvLines.map((l, idx) => (
                  <div key={l.productId} className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#F4F5F7]">
                    <span className="text-[16px]">{l.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-semibold text-[#172B4D]">{l.name}</p>
                      <p className="text-[10px] text-[#6B778C]">cost {KES(l.cost)} • max {l.max} on shelf</p>
                    </div>
                    <input
                      type="number" min={1} max={l.max}
                      value={l.qty}
                      onChange={(e) => setRtvLines((ls) => ls.map((x, i) => (i === idx ? { ...x, qty: Math.max(1, Math.min(x.max, Number(e.target.value) || 1)) } : x)))}
                      className="h-7 w-16 rounded-lg border border-[#DFE1E6] text-center font-mono text-[12px] font-bold tabular-nums text-[#172B4D] outline-none focus:border-[#FF5630]"
                      aria-label={`Return quantity for ${l.name}`}
                    />
                    <span className="w-20 text-right font-mono text-[11px] font-bold tabular-nums text-[#172B4D]">{KES(l.qty * l.cost)}</span>
                    <button
                      onClick={() => setRtvLines((ls) => ls.filter((_, i) => i !== idx))}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-[#6B778C] hover:bg-[#FFEBE8] hover:text-[#FF5630]"
                      aria-label={`Remove ${l.name} from return`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#172B4D] px-4 py-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Debit note total (at cost)</p>
                <p className="font-display text-[16px] font-bold text-white">{KES(rtvTotal)}</p>
              </div>
              <Button
                onClick={() => void submitRtv()}
                disabled={busy || !rtvForm.supplierId || !rtvForm.storeId || rtvLines.length === 0}
                className="h-10 rounded-xl bg-[#FF5630] px-5 text-[13px] font-bold text-white hover:bg-[#E84528] disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageMinus className="h-4 w-4" />}
                Create return &amp; debit note
              </Button>
            </div>

            {/* recent RTVs */}
            <div className="df-scroll max-h-40 space-y-1.5 overflow-y-auto pr-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Recent returns</p>
              {(rtvs ?? []).length === 0 ? (
                <p className="py-2 text-center text-[11px] text-[#6B778C]">No returns to vendor yet.</p>
              ) : (
                rtvs!.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#DFE1E6] bg-[#FAFBFC] px-2.5 py-1.5">
                    <span className="font-mono text-[11px] font-bold text-[#172B4D]">{r.rtnNo}</span>
                    <span className="rounded-full bg-[#FFEBE8] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#C62828]">{r.debitNoteNo}</span>
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold", STATUS_CLS[r.status] ?? "bg-[#F4F5F7] text-[#6B778C]")}>{r.status}</span>
                    <span className="min-w-0 flex-1 truncate text-[10px] text-[#6B778C]">
                      {r.supplier.name} • {r.reason} • {fmtDate(r.createdAt)} • {r.items.length} lines
                    </span>
                    <span className="font-mono text-[11px] font-bold text-[#172B4D]">{KES(r.total)}</span>
                    {r.status === "Sent" && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void creditRtv(r)} className="h-6 rounded-md px-2 text-[10px] font-bold text-[#1B7A2E]">
                        <Check className="h-2.5 w-2.5" /> Credit
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>

    {/* ══════════ Supplier statement dialog (printable A4) ══════════ */}
    <Dialog open={!!stmtSup} onOpenChange={(o) => !o && setStmtSup(null)}>
      <DialogContent className="rounded-[20px] sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="font-display">Supplier statement</DialogTitle>
          <DialogDescription>
            {stmtSup ? `${stmtSup.name} • reconciliation of purchase orders, debit notes & negotiated prices` : ""}
          </DialogDescription>
        </DialogHeader>

        {stmtLoading || !stmtData ? (
          <div className="flex h-56 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#0052CC]" />
          </div>
        ) : (
          <>
            <div className="df-scroll max-h-[60vh] overflow-y-auto pr-1">
              {/* the sheet — printable A4 area */}
              <div className="df-print-area df-print-area-a4 df-statement overflow-hidden rounded-xl border border-[#DFE1E6] shadow-sm">
                {/* navy gradient header band */}
                <div className="flex items-center justify-between bg-gradient-to-r from-[#172B4D] to-[#0E1B33] px-6 py-4 text-white">
                  <div>
                    <p className="font-display text-[16px] font-bold">DukaFlow Ltd</p>
                    <p className="text-[11px] text-white/80">Thika Road, Nairobi • +254 700 123 456</p>
                    <p className="font-mono text-[10px] text-white/70">KRA PIN: P051234567A</p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-[14px] font-bold tracking-wide">SUPPLIER STATEMENT</p>
                    <p className="text-[11px] text-white/80">
                      Generated {new Date(stmtData.summary.generatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                  </div>
                </div>

                {/* supplier + reconciliation summary */}
                <div className="grid grid-cols-2 gap-4 px-6 py-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Supplier</p>
                    <p className="font-display mt-1 flex items-center gap-2 text-[14px] font-bold text-[#172B4D]">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E9F2FF] text-[#0052CC]"><Building2 size={13} /></span>
                      {stmtData.supplier.name}
                    </p>
                    <p className="font-mono text-[12px] text-[#6B778C]">{stmtData.supplier.phone || "—"}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="rounded-full bg-[#F4F5F7] px-2 py-0.5 text-[10px] font-bold text-[#6B778C]">{stmtData.supplier.category}</span>
                      <span className="rounded-full bg-[#E9F2FF] px-2 py-0.5 text-[10px] font-bold text-[#0052CC]">{stmtData.supplier.leadDays}d lead</span>
                      {stmtData.supplier.kraPin && (
                        <span className="rounded-full bg-[#F4F5F7] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#6B778C]">{stmtData.supplier.kraPin}</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1 text-right text-[12px]">
                    <p className="text-[#6B778C]">Purchase orders: <b className="text-[#172B4D]">{stmtData.summary.poCount}</b> ({stmtData.summary.openPos} open)</p>
                    <p className="text-[#6B778C]">Debit notes: <b className="text-[#172B4D]">{stmtData.summary.rtvCount}</b></p>
                    <p className="text-[#6B778C]">Price list items: <b className="text-[#172B4D]">{stmtData.summary.priceListCount}</b></p>
                    <p className="text-[#6B778C]">
                      Net position: <b className={cn("font-mono", stmtData.summary.netTraded >= 0 ? "text-[#1B7A2E]" : "text-[#C62828]")}>{KES(stmtData.summary.netTraded, true)}</b>
                    </p>
                  </div>
                </div>

                {/* reconciliation tiles */}
                <div className="mx-6 mb-4 grid grid-cols-2 gap-2 @xl:grid-cols-4">
                  <div className="rounded-xl bg-[#E9F2FF] px-3 py-2.5">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[#0052CC]/70">Goods received</p>
                    <p className="font-display mt-0.5 text-[16px] font-extrabold tabular-nums text-[#0052CC]">{KES(stmtData.summary.purchasedValue, true)}</p>
                    <p className="text-[9.5px] text-[#0052CC]/60">of {KES(stmtData.summary.orderedValue, true)} ordered</p>
                  </div>
                  <div className="rounded-xl bg-[#FFEBE8] px-3 py-2.5">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[#C62828]/70">Returned (RTV)</p>
                    <p className="font-display mt-0.5 text-[16px] font-extrabold tabular-nums text-[#C62828]">−{KES(stmtData.summary.returnedValue, true)}</p>
                    <p className="text-[9.5px] text-[#C62828]/60">{KES(stmtData.summary.creditedValue, true)} credited</p>
                  </div>
                  <div className="rounded-xl bg-[#FFF8E1] px-3 py-2.5">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[#B8860B]/80">Open orders</p>
                    <p className="font-display mt-0.5 text-[16px] font-extrabold tabular-nums text-[#B8860B]">{KES(stmtData.summary.openOrdersValue, true)}</p>
                    <p className="text-[9.5px] text-[#B8860B]/70">awaiting delivery</p>
                  </div>
                  <div className="rounded-xl bg-[#E8F5E9] px-3 py-2.5">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[#1B7A2E]/80">Price savings</p>
                    <p className="font-display mt-0.5 text-[16px] font-extrabold tabular-nums text-[#1B7A2E]">{KES(stmtData.summary.priceListSavings, true)}</p>
                    <p className="text-[9.5px] text-[#1B7A2E]/60">per reorder cycle</p>
                  </div>
                </div>

                {/* pending credit alert */}
                {stmtData.summary.pendingCreditValue > 0 && (
                  <div className="mx-6 mb-4 flex items-center justify-between rounded-xl border border-[#FFE0B2] bg-[#FFF8E1] px-4 py-2.5">
                    <p className="text-[11.5px] font-semibold text-[#8D6708]">
                      ⚠ {KES(stmtData.summary.pendingCreditValue, true)} of debit notes not yet credited by the supplier
                    </p>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-[#B8860B]">follow up</span>
                  </div>
                )}

                {/* purchase orders */}
                <div className="px-6 pb-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Purchase orders</p>
                  <table className="mt-2 w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-[#DFE1E6] text-left text-[10px] uppercase tracking-wider text-[#6B778C]">
                        <th className="py-1.5 font-semibold">PO</th>
                        <th className="py-1.5 font-semibold">Date</th>
                        <th className="py-1.5 font-semibold">Store</th>
                        <th className="py-1.5 font-semibold">Status</th>
                        <th className="py-1.5 text-right font-semibold">Received</th>
                        <th className="py-1.5 text-right font-semibold">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stmtData.pos.length === 0 ? (
                        <tr><td colSpan={6} className="py-2 text-[11px] text-[#6B778C]">No purchase orders yet.</td></tr>
                      ) : (
                        stmtData.pos.map((po) => (
                          <tr key={po.id} className="border-b border-[#F4F5F7]">
                            <td className="py-1.5 font-mono font-semibold text-[#172B4D]">{po.poNo}</td>
                            <td className="py-1.5 text-[#6B778C]">{fmtDate(po.orderedAt)}</td>
                            <td className="py-1.5 text-[#6B778C]">{po.storeName}</td>
                            <td className="py-1.5">
                              <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold", STATUS_CLS[po.status] ?? "bg-[#F4F5F7] text-[#6B778C]")}>{po.status}</span>
                            </td>
                            <td className="py-1.5 text-right font-bold tabular-nums text-[#172B4D]">{KES(po.receivedValue)}</td>
                            <td className={cn("py-1.5 text-right font-semibold tabular-nums", po.outstandingValue > 0 ? "text-[#B8860B]" : "text-[#6B778C]")}>{KES(po.outstandingValue)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* debit notes */}
                {stmtData.rtvs.length > 0 && (
                  <div className="px-6 pb-2">
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Debit notes (returns to vendor)</p>
                    <table className="mt-2 w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-[#DFE1E6] text-left text-[10px] uppercase tracking-wider text-[#6B778C]">
                          <th className="py-1.5 font-semibold">DN</th>
                          <th className="py-1.5 font-semibold">Date</th>
                          <th className="py-1.5 font-semibold">Reason</th>
                          <th className="py-1.5 font-semibold">Credit</th>
                          <th className="py-1.5 text-right font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stmtData.rtvs.map((r) => (
                          <tr key={r.id} className="border-b border-[#F4F5F7]">
                            <td className="py-1.5 font-mono font-bold text-[#C62828]">{r.debitNoteNo}</td>
                            <td className="py-1.5 text-[#6B778C]">{fmtDate(r.createdAt)}</td>
                            <td className="py-1.5 text-[#6B778C]">{r.reason}</td>
                            <td className="py-1.5">
                              <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold", STATUS_CLS[r.status] ?? "bg-[#F4F5F7] text-[#6B778C]")}>{r.status}</span>
                            </td>
                            <td className="py-1.5 text-right font-bold tabular-nums text-[#C62828]">−{KES(r.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* negotiated price list */}
                {stmtData.prices.length > 0 && (
                  <div className="px-6 pb-2">
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Negotiated price list</p>
                    <table className="mt-2 w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-[#DFE1E6] text-left text-[10px] uppercase tracking-wider text-[#6B778C]">
                          <th className="py-1.5 font-semibold">Product</th>
                          <th className="py-1.5 text-right font-semibold">Catalog</th>
                          <th className="py-1.5 text-right font-semibold">Negotiated</th>
                          <th className="py-1.5 text-right font-semibold">Saving/unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stmtData.prices.map((p) => (
                          <tr key={p.productId} className="border-b border-[#F4F5F7]">
                            <td className="py-1.5 font-semibold text-[#172B4D]">{p.emoji} {p.name}</td>
                            <td className="py-1.5 text-right tabular-nums text-[#6B778C] line-through decoration-[#C62828]/40">{KES(p.catalogCost)}</td>
                            <td className="py-1.5 text-right font-bold tabular-nums text-[#0052CC]">{KES(p.negotiatedCost)}</td>
                            <td className="py-1.5 text-right font-bold tabular-nums text-[#1B7A2E]">−{KES(p.savingPerUnit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* footer */}
                <div className="border-t border-dashed border-[#DFE1E6] px-6 py-3 text-[10px] text-[#6B778C]">
                  Net traded = goods received − goods returned. Reconcile against the supplier&apos;s invoice and confirm pending credits. Generated by DukaFlow ERP.
                </div>
              </div>
            </div>

            <DialogFooter className="mt-1">
              <Button
                onClick={printStatement}
                disabled={stmtBusy}
                className="rounded-xl bg-[#172B4D] font-semibold hover:bg-[#0F1E38]"
              >
                {stmtBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Print / Save PDF
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
