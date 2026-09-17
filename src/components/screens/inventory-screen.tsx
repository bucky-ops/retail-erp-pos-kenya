"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Boxes, ClipboardList, FileUp, Loader2, Package, PackageX, ScanBarcode, Search, ShoppingBag, SlidersHorizontal, TriangleAlert, Wallet, ArrowLeftRight,
} from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/lib/store";
import { ProcurementDialog } from "@/components/df/procurement";
import { StockTakeDialog } from "@/components/df/stock-take";
import { LabelPrinter } from "@/components/df/label-printer";
import { BulkImportDialog } from "@/components/df/bulk-import";
import { KES } from "@/types";
import { ScreenHeader, KpiCard, EmptyState, TableSkeleton } from "@/components/df/shared";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

/* ── types ────────────────────────────────────────────────── */

interface InvRow {
  id: number;
  productId: number;
  name: string;
  emoji: string;
  sku: string;
  barcode: string;
  category: string;
  price: number;
  cost: number;
  margin: number;
  qty: number;
  reorderPoint: number;
  storeId: number;
  store: string;
}

interface InvTransfer {
  id: number;
  productId: number;
  qty: number;
  status: string;
  createdAt: string;
  fromStoreId: number;
  toStoreId: number;
}

interface InvStore {
  id: number;
  name: string;
}

interface InvSummary {
  totalValue: number;
  lowStock: number;
  outOfStock: number;
  skuCount: number;
}

interface InvResponse {
  rows: InvRow[];
  transfers: InvTransfer[];
  stores: InvStore[];
  summary: InvSummary;
}

type Tab = "All Items" | "Low Stock" | "Out of Stock" | "Transfers";
const TABS: Tab[] = ["All Items", "Low Stock", "Out of Stock", "Transfers"];

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** Guard against null/NaN numbers from the API (e.g. server-side summary edge cases). */
const safeNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/* ── pills ────────────────────────────────────────────────── */

function MarginBadge({ m }: { m: number }) {
  const cls =
    m >= 25
      ? "bg-[#E8F5E9] text-[#1B7A2E]"
      : m >= 10
        ? "bg-[#FFF8E1] text-[#B8860B]"
        : "bg-[#FFEBEE] text-[#C62828]";
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", cls)}>{m}%</span>;
}

function StockPill({ qty, reorder }: { qty: number; reorder: number }) {
  const [label, cls] =
    qty <= 0
      ? (["Out", "bg-[#FFEBEE] text-[#C62828]"] as const)
      : qty <= reorder
        ? (["Low", "bg-[#FFF8E1] text-[#B8860B]"] as const)
        : (["In stock", "bg-[#E8F5E9] text-[#2E7D32]"] as const);
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", cls)}>{label}</span>;
}

/* ── screen ───────────────────────────────────────────────── */

export default function InventoryScreen() {
  const activeStoreId = useApp((s) => s.activeStoreId);
  const [tab, setTab] = useState<Tab>("All Items");
  const [storeId, setStoreId] = useState<number | "all">(typeof activeStoreId === "number" ? activeStoreId : "all");
  const [q, setQ] = useState("");
  const [data, setData] = useState<InvResponse | null>(null);
  const [nameMap, setNameMap] = useState<Map<number, string>>(new Map());

  /* product drawer */
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [perStore, setPerStore] = useState<InvRow[] | null>(null);
  const selected = useMemo(() => data?.rows.find((r) => r.id === selectedId) ?? null, [data, selectedId]);

  /* transfer dialog */
  const [transferOpen, setTransferOpen] = useState(false);
  /* procurement workspace (suppliers / reorder suggestions / POs) */
  const [procOpen, setProcOpen] = useState(false);
  /* stock take / cycle count workspace */
  const [stOpen, setStOpen] = useState(false);
  /* barcode label printer (shelf stickers) */
  const [labelsOpen, setLabelsOpen] = useState(false);
  /* bulk stock import (spreadsheet paste) */
  const [importOpen, setImportOpen] = useState(false);
  const [tfProducts, setTfProducts] = useState<InvRow[] | null>(null);
  const [tfProduct, setTfProduct] = useState<number | null>(null);
  const [tfFrom, setTfFrom] = useState<number | null>(null);
  const [tfTo, setTfTo] = useState<number | null>(null);
  const [tfQty, setTfQty] = useState("");
  const [adjQty, setAdjQty] = useState("");
  const [adjReason, setAdjReason] = useState("Recount");
  const [adjBusy, setAdjBusy] = useState(false);
  const [tfBusy, setTfBusy] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ storeId: String(storeId), tab });
    if (q.trim()) params.set("q", q.trim());
    try {
      const [d, full] = await Promise.all([
        api.get<InvResponse>(`/api/inventory?${params.toString()}`),
        tab === "Transfers"
          ? api.get<InvResponse>("/api/inventory?storeId=all")
          : Promise.resolve(null),
      ]);
      setData({
        ...d,
        summary: {
          totalValue: safeNum(d.summary?.totalValue),
          lowStock: safeNum(d.summary?.lowStock),
          outOfStock: safeNum(d.summary?.outOfStock),
          skuCount: safeNum(d.summary?.skuCount),
        },
      });
      if (full) {
        const m = new Map<number, string>();
        for (const r of full.rows) if (!m.has(r.productId)) m.set(r.productId, r.name);
        setNameMap(m);
      }
    } catch (e) {
      toast({ title: "Could not load inventory", description: err(e) });
      setData((prev) => prev ?? { rows: [], transfers: [], stores: [], summary: { totalValue: 0, lowStock: 0, outOfStock: 0, skuCount: 0 } });
    }
  }, [storeId, tab, q]);

  /* debounced fetch on filter change */
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const stores = data?.stores ?? [];
  const storeName = useCallback(
    (id: number) => stores.find((s) => s.id === id)?.name ?? `Store ${id}`,
    [stores]
  );

  /* ── product drawer: fetch stock across all stores ── */
  const openProduct = useCallback(
    async (row: InvRow) => {
      setSelectedId(row.id);
      setPerStore(null);
      try {
        const fresh = await api.get<InvResponse>(
          `/api/inventory?storeId=all&q=${encodeURIComponent(row.sku)}`
        );
        setPerStore(fresh.rows.filter((r) => r.productId === row.productId));
      } catch {
        setPerStore([row]);
      }
    },
    []
  );

  /* ── transfer dialog ── */
  const openTransfer = useCallback(async (prefill?: { productId: number; fromStoreId: number }) => {
    setTransferOpen(true);
    setTfProducts(null);
    setTfQty("");
    setTfProduct(prefill?.productId ?? null);
    setTfFrom(prefill?.fromStoreId ?? null);
    setTfTo(null);
    try {
      const fresh = await api.get<InvResponse>("/api/inventory?storeId=all");
      setTfProducts(fresh.rows);
      if (!prefill && fresh.rows.length > 0) setTfProduct(fresh.rows[0].productId);
    } catch (e) {
      toast({ title: "Could not load products", description: err(e) });
      setTfProducts([]);
    }
  }, []);

  const tfProductRows = useMemo(
    () => (tfProducts ?? []).filter((r) => r.productId === tfProduct),
    [tfProducts, tfProduct]
  );
  const tfAvailability = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of tfProductRows) m.set(r.storeId, r.qty);
    return m;
  }, [tfProductRows]);
  const tfAvailableAtFrom = tfFrom !== null ? tfAvailability.get(tfFrom) ?? 0 : 0;
  const tfProductInfo = tfProductRows[0];

  const tfValid =
    tfProduct !== null && tfFrom !== null && tfTo !== null && tfFrom !== tfTo &&
    Number(tfQty) > 0 && Number(tfQty) <= tfAvailableAtFrom;

  const submitTransfer = useCallback(async () => {
    if (tfProduct === null || tfFrom === null || tfTo === null) return;
    if (tfFrom === tfTo) {
      toast({ title: "Pick two different stores" });
      return;
    }
    if (Number(tfQty) <= 0 || Number(tfQty) > tfAvailableAtFrom) {
      toast({ title: "Invalid quantity", description: `Only ${tfAvailableAtFrom} available at source.` });
      return;
    }
    setTfBusy(true);
    try {
      await api.post<{ ok: boolean }>("/api/inventory/transfer", {
        productId: tfProduct,
        fromStoreId: tfFrom,
        toStoreId: tfTo,
        qty: Number(tfQty),
      });
      toast({
        title: "Transfer completed — #stock-alerts notified",
        description: `${tfQty} × ${tfProductInfo?.name ?? "product"} • ${storeName(tfFrom)} → ${storeName(tfTo)}`,
      });
      setTransferOpen(false);
      await load();
    } catch (e) {
      toast({ title: "Transfer failed", description: err(e) });
    } finally {
      setTfBusy(false);
    }
  }, [tfProduct, tfFrom, tfTo, tfQty, tfAvailableAtFrom, tfProductInfo, storeName, load]);

  const loading = data === null;
  const rows = data?.rows ?? [];
  const summary = data?.summary ?? { totalValue: 0, lowStock: 0, outOfStock: 0, skuCount: 0 };

  return (
    <div className="space-y-4">
      {/* procurement workspace (reorder suggestions → POs → receive) */}
      <ProcurementDialog
        open={procOpen}
        onOpenChange={setProcOpen}
        stores={stores.map((s) => ({ id: s.id, name: s.name }))}
        onDone={load}
      />
      {/* stock take / cycle count workspace (snapshot → count → approve) */}
      <StockTakeDialog
        open={stOpen}
        onOpenChange={setStOpen}
        stores={stores.map((s) => ({ id: s.id, name: s.name }))}
        onDone={load}
      />
      {/* barcode label printer (shelf stickers) */}
      <LabelPrinter
        open={labelsOpen}
        onOpenChange={setLabelsOpen}
        storeId={storeId}
        storeName={storeId === "all" ? "All Stores" : (stores.find((s) => s.id === storeId)?.name ?? "store")}
      />
      {/* bulk stock import (spreadsheet paste → preview → apply) */}
      <BulkImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        stores={stores.map((s) => ({ id: s.id, name: s.name }))}
        defaultStoreId={storeId === "all" ? (stores[0]?.id ?? 1) : storeId}
        onDone={load}
      />
      <ScreenHeader
        title="Inventory"
        subtitle="Multi-store stock, margins & transfers"
        actions={
          <>
            <span className="hidden rounded-full border border-[#DFE1E6] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#6B778C] @md:inline-flex">
              Value <b className="ml-1 text-[#172B4D]">{KES(summary.totalValue, true)}</b>
            </span>
            <span className="hidden rounded-full border border-[#DFE1E6] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#6B778C] @md:inline-flex">
              <b className="mr-1 text-[#172B4D]">{summary.skuCount}</b> SKUs
            </span>
            <Button
              onClick={() => setStOpen(true)}
              className="h-9 rounded-xl border border-[#DFE1E6] bg-white px-4 text-[13px] font-semibold text-[#172B4D] shadow-sm hover:border-[#0052CC] hover:text-[#0052CC]"
            >
              <ClipboardList size={15} /> Stock Take
            </Button>
            <Button
              onClick={() => setLabelsOpen(true)}
              className="h-9 rounded-xl border border-[#DFE1E6] bg-white px-4 text-[13px] font-semibold text-[#172B4D] shadow-sm hover:border-[#0052CC] hover:text-[#0052CC]"
            >
              <ScanBarcode size={15} /> Labels
            </Button>
            <Button
              onClick={() => setImportOpen(true)}
              className="h-9 rounded-xl border border-[#DFE1E6] bg-white px-4 text-[13px] font-semibold text-[#172B4D] shadow-sm hover:border-[#00C853] hover:text-[#1B7A2E]"
            >
              <FileUp size={15} /> Import
            </Button>
            <Button
              onClick={() => setProcOpen(true)}
              className="h-9 rounded-xl bg-[#00C853] px-4 text-[13px] font-semibold text-[#052E14] shadow-sm hover:bg-[#00B34A]"
            >
              <ShoppingBag size={15} /> Procurement
              {summary.lowStock > 0 && (
                <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#FF5630] px-1 text-[10px] font-bold text-white">
                  {summary.lowStock}
                </span>
              )}
            </Button>
            <Button
              onClick={() => void openTransfer()}
              className="h-9 rounded-xl bg-[#0052CC] px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-[#0041A8]"
            >
              <ArrowLeftRight size={15} /> Transfer Stock
            </Button>
          </>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 @6xl:grid-cols-4">
        <KpiCard icon={<Wallet size={17} />} label="Stock value (at cost)" value={KES(summary.totalValue, true)} loading={loading} />
        <KpiCard icon={<Boxes size={17} />} label="Distinct SKUs" value={String(summary.skuCount)} loading={loading} />
        <KpiCard
          icon={<TriangleAlert size={17} />}
          label="Low stock items"
          value={String(summary.lowStock)}
          loading={loading}
          iconBg="#FFF8E1"
          iconColor="#B8860B"
        />
        <KpiCard
          icon={<PackageX size={17} />}
          label="Out of stock"
          value={String(summary.outOfStock)}
          loading={loading}
          iconBg="#FFEBEE"
          iconColor="#FF5630"
        />
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-full border px-4 py-2 text-[12px] font-semibold transition",
                tab === t
                  ? "border-[#172B4D] bg-[#172B4D] text-white"
                  : "border-[#DFE1E6] bg-[#F4F5F7] text-[#6B778C] hover:text-[#172B4D]"
              )}
            >
              {t}
              {t === "Low Stock" && !loading && ` (${summary.lowStock})`}
              {t === "Out of Stock" && !loading && ` (${summary.outOfStock})`}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            <StorePill active={storeId === "all"} onClick={() => setStoreId("all")} label="All Stores" />
            {stores.map((s) => (
              <StorePill key={s.id} active={storeId === s.id} onClick={() => setStoreId(s.id)} label={s.name} />
            ))}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B778C]" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, SKU or barcode…"
              className="h-9 w-56 rounded-xl border-[#DFE1E6] bg-white pl-8 text-[12px]"
            />
          </div>
        </div>
      </div>

      {/* main area */}
      {tab === "Transfers" ? (
        <div className="overflow-hidden rounded-2xl border border-[#DFE1E6] bg-white shadow-sm">
          <div className="border-b border-[#DFE1E6] p-4">
            <h3 className="font-display text-[14px] font-bold text-[#172B4D]">Stock Transfers</h3>
            <p className="text-[12px] text-[#6B778C]">Latest 20 movements between stores — every transfer posts to #stock-alerts.</p>
          </div>
          {loading ? (
            <div className="p-4"><TableSkeleton rows={5} cols={5} /></div>
          ) : (data?.transfers.length ?? 0) === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<ArrowLeftRight size={22} />}
                title="No transfers yet"
                sub="Move stock between Thika Road and Kiambu with the Transfer Stock button."
                action={
                  <Button onClick={() => void openTransfer()} className="rounded-xl bg-[#0052CC] text-white hover:bg-[#0041A8]">
                    <ArrowLeftRight size={15} /> Transfer Stock
                  </Button>
                }
              />
            </div>
          ) : (
            <Table className="text-[12px]">
              <TableHeader>
                <TableRow className="bg-[#FAFBFC] hover:bg-[#FAFBFC]">
                  {["Date", "Product", "Qty", "Route", "Status"].map((h) => (
                    <TableHead key={h} className="p-3 text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.transfers ?? []).map((t) => (
                  <TableRow key={t.id} className="border-t border-[#F4F5F7] hover:bg-[#FAFBFC]">
                    <TableCell className="p-3 text-[#6B778C]">
                      {new Date(t.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}{" "}
                      {new Date(t.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}
                    </TableCell>
                    <TableCell className="p-3 font-semibold text-[#172B4D]">
                      {nameMap.get(t.productId) ?? `Product #${t.productId}`}
                    </TableCell>
                    <TableCell className="p-3 font-bold">{t.qty}</TableCell>
                    <TableCell className="p-3">
                      <span className="inline-flex items-center gap-1.5 text-[12px]">
                        {storeName(t.fromStoreId)} <ArrowRight size={13} className="text-[#0052CC]" /> {storeName(t.toStoreId)}
                      </span>
                    </TableCell>
                    <TableCell className="p-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-bold",
                          t.status === "Completed" ? "bg-[#E8F5E9] text-[#1B7A2E]" : "bg-[#FFF8E1] text-[#B8860B]"
                        )}
                      >
                        {t.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      ) : loading ? (
        <div className="rounded-2xl border border-[#DFE1E6] bg-white p-4 shadow-sm">
          <TableSkeleton rows={8} cols={6} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Package size={22} />}
          title="No items match"
          sub="Try clearing the search or switching store — stock lives in Thika Road and Kiambu."
          action={
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                setQ("");
                setStoreId("all");
                setTab("All Items");
              }}
            >
              Reset filters
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#DFE1E6] bg-white shadow-sm">
          <Table className="text-[12px]">
            <TableHeader>
              <TableRow className="bg-[#FAFBFC] hover:bg-[#FAFBFC]">
                {["Product", "Category", "Barcode", "Store", "Qty", "Reorder", "Price", "Cost", "Margin", "Status"].map((h) => (
                  <TableHead key={h} className="p-3 text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  onClick={() => void openProduct(r)}
                  className="cursor-pointer border-t border-[#F4F5F7] hover:bg-[#FAFBFC]"
                >
                  <TableCell className="p-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F4F5F7] text-[15px]">{r.emoji}</span>
                      <span>
                        <span className="block font-semibold text-[#172B4D]">{r.name}</span>
                        <span className="block font-mono text-[11px] text-[#6B778C]">{r.sku}</span>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="p-3 text-[#6B778C]">{r.category}</TableCell>
                  <TableCell className="p-3 font-mono text-[11px] text-[#6B778C]">{r.barcode}</TableCell>
                  <TableCell className="p-3">{r.store}</TableCell>
                  <TableCell
                    className={cn(
                      "p-3 font-bold",
                      r.qty <= 0 ? "text-[#FF5630]" : r.qty <= r.reorderPoint ? "text-[#B8860B]" : "text-[#172B4D]"
                    )}
                  >
                    {r.qty}
                  </TableCell>
                  <TableCell className="p-3 text-[#6B778C]">{r.reorderPoint}</TableCell>
                  <TableCell className="p-3">{KES(r.price)}</TableCell>
                  <TableCell className="p-3 text-[#6B778C]">{KES(r.cost)}</TableCell>
                  <TableCell className="p-3"><MarginBadge m={r.margin} /></TableCell>
                  <TableCell className="p-3"><StockPill qty={r.qty} reorder={r.reorderPoint} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── product drawer ── */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[400px] df-scroll" side="right">
          {selected && (
            <>
              <SheetHeader className="gap-1 border-b border-[#DFE1E6] p-5 pr-12 text-left">
                <SheetTitle className="font-display text-[16px] font-bold text-[#172B4D]">{selected.name}</SheetTitle>
                <SheetDescription className="font-mono text-[11px] text-[#6B778C]">
                  {selected.sku} • {selected.barcode}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 p-5">
                <div className="flex h-[120px] items-center justify-center rounded-xl bg-[#F4F5F7] text-5xl">
                  {selected.emoji}
                </div>

                {/* per-store stock */}
                <div>
                  <h4 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">Stock by store</h4>
                  {perStore === null ? (
                    <div className="space-y-2">
                      <div className="h-16 animate-pulse rounded-xl bg-[#F4F5F7]" />
                      <div className="h-16 animate-pulse rounded-xl bg-[#F4F5F7]" />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {perStore.map((r) => {
                        const pct = r.qty <= 0 ? 0 : Math.min(100, Math.round((r.qty / Math.max(1, r.reorderPoint * 2)) * 100));
                        return (
                          <div key={r.id} className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
                            <div className="flex items-center justify-between text-[12px]">
                              <span className="font-semibold text-[#172B4D]">{r.store}</span>
                              <span className={cn("font-bold", r.qty <= 0 ? "text-[#FF5630]" : r.qty <= r.reorderPoint ? "text-[#B8860B]" : "text-[#172B4D]")}>
                                {r.qty} units
                              </span>
                            </div>
                            <div className="mt-2 h-1.5 rounded-full bg-[#DFE1E6]">
                              <div
                                className="h-1.5 rounded-full"
                                style={{
                                  width: `${pct}%`,
                                  background: r.qty <= 0 ? "#FF5630" : r.qty <= r.reorderPoint ? "#FFAB00" : "#0052CC",
                                }}
                              />
                            </div>
                            <p className="mt-1.5 text-[10px] text-[#6B778C]">Reorder at {r.reorderPoint} • {pct}% of target</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* pricing */}
                <div>
                  <h4 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">Pricing & margin</h4>
                  <div className="grid grid-cols-3 gap-2 text-[12px]">
                    <div className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
                      <p className="text-[10px] uppercase text-[#6B778C]">Price</p>
                      <p className="font-display mt-0.5 font-bold text-[#172B4D]">{KES(selected.price)}</p>
                    </div>
                    <div className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
                      <p className="text-[10px] uppercase text-[#6B778C]">Cost</p>
                      <p className="font-display mt-0.5 font-bold text-[#172B4D]">{KES(selected.cost)}</p>
                    </div>
                    <div className="flex flex-col items-start justify-center rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
                      <p className="text-[10px] uppercase text-[#6B778C]">Margin</p>
                      <div className="mt-1"><MarginBadge m={selected.margin} /></div>
                    </div>
                  </div>
                </div>

                {/* stock adjustments (audit-logged to #stock-alerts) */}
                <div>
                  <h4 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">Stock adjustment</h4>
                  <div className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={adjQty}
                        onChange={(e) => setAdjQty(e.target.value)}
                        placeholder="± qty"
                        className="h-9 w-24 rounded-lg border-[#DFE1E6] text-center text-[13px] font-bold"
                      />
                      <Select value={adjReason} onValueChange={setAdjReason}>
                        <SelectTrigger className="h-9 flex-1 rounded-lg border-[#DFE1E6] text-[12px]">
                          <SelectValue placeholder="Reason" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Recount">Recount</SelectItem>
                          <SelectItem value="Received shipment">Received shipment</SelectItem>
                          <SelectItem value="Damaged">Damaged</SelectItem>
                          <SelectItem value="Theft / loss">Theft / loss</SelectItem>
                          <SelectItem value="Return to supplier">Return to supplier</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        disabled={adjBusy || !adjQty || Number(adjQty) === 0}
                        onClick={async () => {
                          if (!selected) return;
                          setAdjBusy(true);
                          try {
                            const r = await api.post<{ ok: boolean; product: string; store: string }>("/api/inventory/adjust", {
                              productId: selected.productId,
                              storeId: selected.storeId,
                              delta: Number(adjQty),
                              reason: adjReason,
                            });
                            toast({
                              title: `Stock adjusted: ${r.product}`,
                              description: `${Number(adjQty) > 0 ? "+" : ""}${adjQty} at ${r.store} • ${adjReason} • #stock-alerts notified`,
                            });
                            setAdjQty("");
                            // refresh drawer + table
                            const fresh = await api.get<InvResponse>(
                              `/api/inventory?storeId=${storeId === "all" ? "all" : storeId}&tab=${encodeURIComponent(tab)}&q=${encodeURIComponent(q)}`
                            );
                            setData(fresh);
                            const row = fresh.rows.find((x) => x.productId === selected.productId);
                            setSelectedId(row?.id ?? selected.id);
                          } catch (e) {
                            toast({ title: "Adjustment failed", description: e instanceof Error ? e.message : "Try again" });
                          } finally {
                            setAdjBusy(false);
                          }
                        }}
                        className="h-9 rounded-lg bg-[#0052CC] px-3 text-[12px] font-bold text-white hover:bg-[#0041A8]"
                      >
                        {adjBusy ? <Loader2 size={13} className="animate-spin" /> : <SlidersHorizontal size={13} />} Apply
                      </Button>
                    </div>
                    <p className="mt-2 text-[10px] text-[#6B778C]">Use − to write off damages/loss, + for recounts &amp; unlogged deliveries. Every adjustment is posted to #stock-alerts.</p>
                  </div>
                </div>

                <Button
                  onClick={() => selected && void openTransfer({ productId: selected.productId, fromStoreId: selected.storeId })}
                  className="h-10 w-full rounded-xl bg-[#0052CC] text-[13px] font-semibold text-white hover:bg-[#0041A8]"
                >
                  <ArrowLeftRight size={15} /> Transfer stock
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── transfer dialog ── */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="rounded-2xl sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="font-display text-[16px] font-bold text-[#172B4D]">Transfer Stock</DialogTitle>
            <DialogDescription className="text-[12px] text-[#6B778C]">
              Move units between stores — a notification is posted to #stock-alerts automatically.
            </DialogDescription>
          </DialogHeader>
          {tfProducts === null ? (
            <div className="space-y-2">
              <div className="h-10 animate-pulse rounded-xl bg-[#F4F5F7]" />
              <div className="h-10 animate-pulse rounded-xl bg-[#F4F5F7]" />
              <div className="h-10 animate-pulse rounded-xl bg-[#F4F5F7]" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-1.5">
                <Label className="text-[12px] font-semibold text-[#172B4D]">Product</Label>
                <Select
                  value={tfProduct !== null ? String(tfProduct) : undefined}
                  onValueChange={(v) => {
                    setTfProduct(Number(v));
                    setTfQty("");
                  }}
                >
                  <SelectTrigger className="h-10 rounded-xl bg-[#FAFBFC]">
                    <SelectValue placeholder="Select product" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {Object.values(
                      tfProducts.reduce<Record<number, InvRow>>((acc, r) => {
                        if (!acc[r.productId]) acc[r.productId] = r;
                        return acc;
                      }, {})
                    ).map((p) => (
                      <SelectItem key={p.productId} value={String(p.productId)}>
                        {p.emoji} {p.name} — {p.sku}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-[12px] font-semibold text-[#172B4D]">From store</Label>
                  <Select
                    value={tfFrom !== null ? String(tfFrom) : undefined}
                    onValueChange={(v) => {
                      setTfFrom(Number(v));
                      setTfQty("");
                      if (tfTo === Number(v)) setTfTo(null);
                    }}
                  >
                    <SelectTrigger className="h-10 rounded-xl bg-[#FAFBFC]">
                      <SelectValue placeholder="Source" />
                    </SelectTrigger>
                    <SelectContent>
                      {tfAvailability.size === 0
                        ? stores.map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                          ))
                        : [...tfAvailability.entries()].map(([sid, qty]) => (
                            <SelectItem key={sid} value={String(sid)}>
                              {storeName(sid)} ({qty})
                            </SelectItem>
                          ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-[12px] font-semibold text-[#172B4D]">To store</Label>
                  <Select
                    value={tfTo !== null ? String(tfTo) : undefined}
                    onValueChange={(v) => setTfTo(Number(v))}
                  >
                    <SelectTrigger className="h-10 rounded-xl bg-[#FAFBFC]">
                      <SelectValue placeholder="Destination" />
                    </SelectTrigger>
                    <SelectContent>
                      {stores
                        .filter((s) => s.id !== tfFrom)
                        .map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tf-qty" className="text-[12px] font-semibold text-[#172B4D]">Quantity</Label>
                <Input
                  id="tf-qty"
                  type="number"
                  min={1}
                  value={tfQty}
                  onChange={(e) => setTfQty(e.target.value)}
                  placeholder="1"
                  className="h-10 rounded-xl bg-[#FAFBFC]"
                />
                <p className={cn("text-[11px]", tfValid ? "text-[#1B7A2E]" : "text-[#6B778C]")}>
                  {tfProduct === null
                    ? "Select a product first."
                    : tfFrom === null
                      ? "Select a source store to see availability."
                      : `Available at ${storeName(tfFrom)}: ${tfAvailableAtFrom} units.`}
                </p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTransferOpen(false)} className="rounded-xl">Cancel</Button>
            <Button
              onClick={() => void submitTransfer()}
              disabled={!tfValid || tfBusy}
              className="rounded-xl bg-[#0052CC] text-white hover:bg-[#0041A8]"
            >
              {tfBusy ? "Transferring…" : "Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StorePill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[11px] font-semibold transition",
        active
          ? "border-[#0052CC] bg-white text-[#0052CC] shadow-sm"
          : "border-[#DFE1E6] bg-[#FAFBFC] text-[#6B778C] hover:text-[#172B4D]"
      )}
    >
      {label}
    </button>
  );
}
