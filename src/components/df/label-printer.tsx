"use client";

/**
 * Barcode Label Printer — per-product shelf labels (Inventory screen).
 *
 * Prints sheets of 50×30mm (default) or 38×25mm thermal stickers, each with:
 *  • company strip + shelf price (the big scannable number)
 *  • a scannable QR encoding the product's barcode value — a scanner gun (or
 *    phone) typing those digits straight into the POS scan field or the
 *    stock-take counter finds the product instantly
 *  • a decorative 1D barcode rendering (CSS bars derived from the digits)
 *  • SKU / product name / store
 *
 * Printing uses the same `.df-print-area-a4` isolation as the debtor
 * statement, so only the label sheet hits the paper.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Loader2, Minus, PackageOpen, Plus, Printer, ScanBarcode, X } from "lucide-react";
import { api } from "@/lib/api";
import { KES } from "@/types";
import { QrImage } from "@/components/df/qr";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface LabelProduct {
  id: number;
  name: string;
  sku: string;
  barcode: string;
  emoji: string;
  price: number;
  category: string;
  qty: number;
  storeName: string | null;
}

interface LabelData {
  company: { name: string; kraPin: string | null };
  products: LabelProduct[];
}

/* Deterministic pseudo-Code128 bars from a digit string (decorative 1D look;
 * the QR above it is what actually scans). */
function barcodeBars(code: string): { w: number; on: boolean }[] {
  const bars: { w: number; on: boolean }[] = [];
  const src = (code || "0000000000000").padEnd(13, "0").slice(0, 13);
  for (let i = 0; i < src.length; i++) {
    const d = src.charCodeAt(i) - 48;
    bars.push({ w: 1 + (d % 3), on: i % 2 === 0 });
    bars.push({ w: 1 + ((d >> 1) % 2), on: false });
  }
  bars.push({ w: 2, on: true }); // guard
  return bars;
}

const fmtWhen = () =>
  new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export function LabelPrinter({
  open,
  onOpenChange,
  storeId,
  storeName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  storeId: number | "all";
  storeName: string;
}) {
  const [data, setData] = useState<LabelData | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("All");
  const [labelSize, setLabelSize] = useState<"50x30" | "38x25">("50x30");
  const [copies, setCopies] = useState<Record<number, number>>({});
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (storeId !== "all") params.set("storeId", String(storeId));
      const res = await api.get<LabelData>(`/api/labels?${params.toString()}`);
      setData(res);
    } catch (e) {
      toast({ title: "Could not load label data", description: e instanceof Error ? e.message : "Try again" });
    } finally {
      setBusy(false);
    }
  }, [storeId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const categories = useMemo(() => ["All", ...Array.from(new Set((data?.products ?? []).map((p) => p.category)))], [data]);

  const filtered = useMemo(() => {
    const list = data?.products ?? [];
    const needle = q.trim().toLowerCase();
    return list.filter(
      (p) =>
        (category === "All" || p.category === category) &&
        (!needle || p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle) || p.barcode.includes(needle))
    );
  }, [data, q, category]);

  const selected = filtered.filter((p) => (copies[p.id] ?? 0) > 0);
  const totalLabels = selected.reduce((s, p) => s + (copies[p.id] ?? 0), 0);

  const setCopiesOf = (id: number, n: number) =>
    setCopies((c) => ({ ...c, [id]: Math.max(0, Math.min(99, n)) }));

  const selectAll = () =>
    setCopies((c) => {
      const next = { ...c };
      for (const p of filtered) next[p.id] = Math.max(1, next[p.id] ?? 1);
      return next;
    });

  const clearAll = () => setCopies({});

  const doPrint = () => {
    if (totalLabels === 0) {
      toast({ title: "No labels selected", description: "Pick products and copies first." });
      return;
    }
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 80);
  };

  const labelW = labelSize === "50x30" ? 50 : 38;
  const labelH = labelSize === "50x30" ? 30 : 25;

  /* expand selected × copies into a flat print list */
  const printList: LabelProduct[] = useMemo(
    () => selected.flatMap((p) => Array.from({ length: copies[p.id] ?? 0 }, () => p)),
    [selected, copies]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[860px] overflow-hidden rounded-2xl p-0">
        <div className="border-b border-[#DFE1E6] bg-[#FAFBFC] p-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-[15px] font-bold text-[#172B4D]">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E3F2FD] text-[#0052CC]">
                <ScanBarcode size={15} />
              </span>
              Barcode Label Printer
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              Shelf stickers for {storeName} — QR scans straight into the POS scan field or stock-take counter.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid max-h-[70vh] grid-cols-1 overflow-hidden @4xl:grid-cols-12">
          {/* ── LEFT: picker ── */}
          <div className="flex min-h-0 flex-col border-[#DFE1E6] @4xl:col-span-7 @4xl:border-r">
            <div className="flex flex-wrap items-center gap-2 border-b border-[#DFE1E6] bg-white p-3">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name / SKU / barcode…"
                className="h-9 min-w-[160px] flex-1 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[12px]"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Filter by category"
                className="h-9 rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-2 text-[12px] font-semibold text-[#172B4D] outline-none focus:border-[#0052CC]"
              >
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between border-b border-[#DFE1E6] px-3 py-1.5">
              <button onClick={selectAll} className="text-[11px] font-bold text-[#0052CC] hover:underline">
                Select all ({filtered.length})
              </button>
              <button
                onClick={clearAll}
                className="flex items-center gap-1 text-[11px] font-semibold text-[#6B778C] hover:text-[#FF5630]"
              >
                <X size={11} /> Clear
              </button>
            </div>

            <div className="df-scroll min-h-0 flex-1 overflow-y-auto p-2">
              {busy || !data ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-11 rounded-xl" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <PackageOpen size={24} className="mb-2 text-[#6B778C]" />
                  <p className="text-[12px] font-semibold text-[#172B4D]">No products match this filter</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filtered.map((p) => {
                    const n = copies[p.id] ?? 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setCopiesOf(p.id, n > 0 ? 0 : 1)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition",
                          n > 0 ? "border-[#0052CC]/50 bg-[#E3F2FD]" : "border-transparent hover:border-[#DFE1E6] hover:bg-[#FAFBFC]"
                        )}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#DFE1E6] bg-white text-base">
                          {p.emoji}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-semibold text-[#172B4D]">{p.name}</span>
                          <span className="block truncate font-mono text-[10.5px] text-[#6B778C]">
                            {p.sku} • {p.barcode || "no barcode"} • {KES(p.price)}
                          </span>
                        </span>
                        <span
                          className="flex shrink-0 items-center gap-1 rounded-full border border-[#DFE1E6] bg-white px-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label={`Decrease copies for ${p.name}`}
                            onKeyDown={(e) => e.key === "Enter" && setCopiesOf(p.id, n - 1)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCopiesOf(p.id, n - 1);
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded-full text-[#6B778C] hover:bg-[#F4F5F7]"
                          >
                            <Minus size={11} />
                          </span>
                          <input
                            value={n}
                            onChange={(e) => setCopiesOf(p.id, Number(e.target.value.replace(/\D/g, "")) || 0)}
                            onClick={(e) => e.stopPropagation()}
                            inputMode="numeric"
                            aria-label={`Copies for ${p.name}`}
                            className={cn(
                              "w-8 border-0 bg-transparent text-center text-[12px] font-bold outline-none",
                              n > 0 ? "text-[#0052CC]" : "text-[#6B778C]"
                            )}
                          />
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label={`Increase copies for ${p.name}`}
                            onKeyDown={(e) => e.key === "Enter" && setCopiesOf(p.id, n + 1)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCopiesOf(p.id, n + 1);
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded-full text-[#6B778C] hover:bg-[#F4F5F7]"
                          >
                            <Plus size={11} />
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT: preview + print ── */}
          <div className="flex min-h-0 flex-col bg-[#F4F5F7] @4xl:col-span-5">
            <div className="flex items-center justify-between border-b border-[#DFE1E6] bg-white px-3 py-2">
              <div className="flex items-center gap-1">
                {(["50x30", "38x25"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setLabelSize(s)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 font-mono text-[10.5px] font-bold transition",
                      labelSize === s
                        ? "border-[#172B4D] bg-[#172B4D] text-white"
                        : "border-[#DFE1E6] bg-white text-[#6B778C] hover:text-[#172B4D]"
                    )}
                  >
                    {s.replace("x", "×")}mm
                  </button>
                ))}
              </div>
              <span className="rounded-full bg-[#E3F2FD] px-2.5 py-1 text-[11px] font-bold text-[#0052CC]">
                {totalLabels} label{totalLabels === 1 ? "" : "s"}
              </span>
            </div>

            {/* print sheet */}
            <div className="df-scroll min-h-0 flex-1 overflow-y-auto p-3">
              {totalLabels === 0 ? (
                <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-[#DFE1E6] bg-white/70 py-10 text-center">
                  <Copy size={24} className="mb-2 text-[#6B778C]" />
                  <p className="font-display text-[13px] font-semibold text-[#172B4D]">No labels yet</p>
                  <p className="mt-1 max-w-[220px] text-[11.5px] text-[#6B778C]">
                    Pick products on the left — each copy prints one sticker with price + scan code.
                  </p>
                </div>
              ) : (
                <div
                  className="df-print-area-a4 rounded-xl border border-[#DFE1E6] bg-[#E8EAED] p-3"
                  style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
                >
                  {printList.map((p, idx) => (
                    <div
                      key={`${p.id}-${idx}`}
                      className="df-label overflow-hidden rounded-[3px] border border-[#172B4D]/20 bg-white"
                      style={{ width: `${labelW}mm`, height: `${labelH}mm` }}
                    >
                      <div className="flex h-full flex-col px-1.5 py-1">
                        <div className="flex items-baseline justify-between gap-1">
                          <span className="truncate text-[6.5pt] font-bold uppercase tracking-wide text-[#172B4D]">
                            {data?.company.name ?? "DukaFlow"}
                          </span>
                          <span className="shrink-0 font-mono text-[5.5pt] text-[#6B778C]">{p.sku}</span>
                        </div>
                        <p className="truncate text-[7.5pt] font-semibold leading-tight text-[#172B4D]">{p.name}</p>
                        <div className="flex flex-1 items-center gap-1.5">
                          {labelSize === "50x30" ? (
                            <QrImage text={p.barcode || p.sku} size={30} className="shrink-0 rounded-[2px]" alt={`Scan code for ${p.name}`} />
                          ) : (
                            <QrImage text={p.barcode || p.sku} size={22} className="shrink-0 rounded-[2px]" alt={`Scan code for ${p.name}`} />
                          )}
                          <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex h-[9mm] items-end justify-center gap-[0.5px]">
                              {barcodeBars(p.barcode).map((b, i) => (
                                <span
                                  key={i}
                                  style={{
                                    width: `${b.w}px`,
                                    height: "100%",
                                    background: b.on ? "#172B4D" : "transparent",
                                  }}
                                />
                              ))}
                            </div>
                            <p className="text-center font-mono text-[5.5pt] tracking-[0.18em] text-[#172B4D]">
                              {p.barcode || p.sku}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-baseline justify-between border-t border-dashed border-[#DFE1E6] pt-0.5">
                          <span className="truncate text-[5.5pt] text-[#6B778C]">{p.storeName ?? "All stores"}</span>
                          <span className="font-display text-[11pt] font-extrabold leading-none text-[#172B4D]">
                            {KES(p.price)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-[#DFE1E6] bg-white p-3">
              <p className="text-[10.5px] leading-tight text-[#6B778C]">
                {labelSize === "50x30" ? "50×30mm" : "38×25mm"} thermal stickers • {fmtWhen()}
              </p>
              <Button
                onClick={doPrint}
                disabled={totalLabels === 0 || printing}
                className="h-9 rounded-xl bg-[#172B4D] px-4 text-[12px] font-bold hover:bg-[#0F1D33]"
              >
                {printing ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
                Print {totalLabels > 0 ? totalLabels : ""}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
