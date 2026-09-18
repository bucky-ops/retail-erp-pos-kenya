"use client";

/**
 * POS Quick Return - cashier-facing returns at the till.
 *
 * Scan (barcode gun on an 80mm receipt) or type an INV number → the receipt's
 * lines appear with how many units are still refundable → pick qty per line,
 * choose a reason + refund method → POST /api/returns (the same endpoint the
 * back-office Returns workspace uses, so till refunds respect identical
 * business rules: never refund more than sold, refunds equal money actually
 * paid, cash refunds adjust the open till, credit notes reduce debt plans,
 * gift cards issue store credit).
 *
 * Shortcut: F4 from the POS screen. Refund total shown live uses the line
 * unit price (shelf price actually charged); the server's paidRatio math is
 * authoritative for the final figure.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  Banknote,
  Building2,
  Check,
  CreditCard,
  HandCoins,
  Landmark,
  Loader2,
  Minus,
  PackageCheck,
  Plus,
  RotateCcw,
  ScanBarcode,
  SearchX,
  Smartphone,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import { KES } from "@/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

/* ── contracts (mirror /api/sales/lookup + /api/returns) ──── */

interface LookupItem {
  id: number;
  productId: number | null;
  name: string;
  emoji: string;
  qty: number;
  unitPrice: number;
  alreadyReturned: number;
  refundable: number;
}

interface LookupSale {
  id: number;
  receiptNo: string;
  createdAt: string;
  paymentMethod: string;
  subtotal: number;
  total: number;
  storeName: string;
  customerName: string;
  customerPhone: string | null;
  kraStatus: string;
  items: LookupItem[];
}

const RETURN_REASONS = [
  "Customer changed mind",
  "Damaged / defective",
  "Wrong item sold",
  "Expired goods",
  "Warranty claim",
  "Other (see note)",
] as const;

const REFUND_METHODS = [
  { value: "Cash refund", label: "Cash refund", icon: Banknote, hint: "Adjusts the open till drawer" },
  { value: "M-Pesa B2C", label: "M-Pesa B2C", icon: Smartphone, hint: "Payout to customer's M-Pesa" },
  { value: "Credit note", label: "Credit note", icon: CreditCard, hint: "Reduces credit-sale debt" },
  { value: "Gift card", label: "Gift card", icon: HandCoins, hint: "Issues store credit GC" },
] as const;

interface DoneState {
  returnNo: string;
  total: number;
  method: string;
  creditNoteNo: string | null;
  giftCardCode: string | null;
  tillUpdated: boolean;
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/* ── component ────────────────────────────────────────────── */

export function PosQuickReturn({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [sale, setSale] = useState<LookupSale | null>(null);

  /* return builder */
  const [pick, setPick] = useState<Record<number, number>>({}); // saleItemId → qty to return
  const [reason, setReason] = useState<string>(RETURN_REASONS[0]);
  const [method, setMethod] = useState<string>(REFUND_METHODS[0].value);
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<DoneState | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const resetAll = useCallback(() => {
    setQuery("");
    setNotFound(null);
    setSale(null);
    setPick({});
    setReason(RETURN_REASONS[0]);
    setMethod(REFUND_METHODS[0].value);
    setRestock(true);
    setDone(null);
  }, []);

  /* focus the scan field whenever the dialog opens fresh */
  useEffect(() => {
    if (open && !sale) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open, sale]);

  const lookup = useCallback(
    async (rawQuery: string) => {
      const q = rawQuery.trim();
      if (!q || lookupBusy) return;
      setLookupBusy(true);
      setNotFound(null);
      try {
        const res = await api.get<{ ok: boolean; sale: LookupSale }>(
          `/api/sales/lookup?receiptNo=${encodeURIComponent(q)}`
        );
        if (!res.sale.items.some((i) => i.refundable > 0)) {
          setNotFound(`Everything on ${res.sale.receiptNo} has already been returned`);
          setSale(null);
          return;
        }
        setSale(res.sale);
        setPick({});
      } catch (e) {
        setSale(null);
        setNotFound(e instanceof Error ? e.message : "Receipt not found");
      } finally {
        setLookupBusy(false);
      }
    },
    [lookupBusy]
  );

  /* barcode guns fire Enter - also auto-lookup when the value looks complete */
  const onQueryKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void lookup(query);
    }
  };

  const setLine = (item: LookupItem, qty: number) => {
    const clamped = Math.max(0, Math.min(item.refundable, Math.round(qty) || 0));
    setPick((p) => ({ ...p, [item.id]: clamped }));
  };

  const returnAll = () => {
    if (!sale) return;
    const next: Record<number, number> = {};
    for (const i of sale.items) if (i.refundable > 0) next[i.id] = i.refundable;
    setPick(next);
  };

  const lines = sale ? sale.items.filter((i) => (pick[i.id] ?? 0) > 0) : [];
  const refundTotal = lines.reduce((s, i) => s + i.unitPrice * (pick[i.id] ?? 0), 0);
  const canProcess = lines.length > 0 && !busy;

  const process = async () => {
    if (!sale || !canProcess) return;
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; return: { returnNo: string; total: number }; creditNoteNo: string | null; giftCardCode: string | null; tillUpdated: boolean; receiptNo: string }>(
        "/api/returns",
        {
          saleId: sale.id,
          items: lines.map((i) => ({ saleItemId: i.id, qty: pick[i.id] })),
          reason,
          refundMethod: method,
          restock,
          staffName: "POS Quick Return",
        }
      );
      setDone({
        returnNo: res.return.returnNo,
        total: res.return.total,
        method,
        creditNoteNo: res.creditNoteNo,
        giftCardCode: res.giftCardCode,
        tillUpdated: res.tillUpdated,
      });
      toast({
        title: `↩️ ${res.return.returnNo} processed`,
        description: `${res.receiptNo} • ${method} • ${KES(res.return.total)}`,
      });
    } catch (e) {
      toast({
        title: "Return rejected",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setTimeout(resetAll, 150); // allow the close animation first
      }}
    >
      <DialogContent className="max-w-[560px] overflow-hidden rounded-2xl p-0">
        {/* ── header ── */}
        <div className="border-b border-[#DFE1E6] bg-[#FAFBFC] p-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-[15px] font-bold text-[#172B4D]">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FFEBEE] text-[#C62828]">
                <RotateCcw size={15} />
              </span>
              Quick Return
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              Scan the receipt barcode or type the INV number - refund straight from the till.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* ── stage 1: lookup ── */}
        {!sale && !done && (
          <div className="p-4">
            <div className="relative">
              <span
                className={cn(
                  "absolute left-2.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg",
                  lookupBusy ? "animate-pulse bg-[#E3F2FD] text-[#0052CC]" : "bg-[#F4F5F7] text-[#6B778C]"
                )}
              >
                {lookupBusy ? <Loader2 size={15} className="animate-spin" /> : <ScanBarcode size={15} />}
              </span>
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onQueryKey}
                placeholder="e.g. INV-2847 or 2847"
                disabled={lookupBusy}
                autoFocus
                className="h-12 rounded-xl border-[#DFE1E6] bg-white pl-12 font-mono text-[14px] font-bold tracking-wide"
              />
            </div>
            <Button
              onClick={() => void lookup(query)}
              disabled={!query.trim() || lookupBusy}
              className="mt-3 h-10 w-full rounded-xl bg-[#172B4D] text-[13px] font-bold hover:bg-[#0F1D33]"
            >
              {lookupBusy ? <Loader2 size={14} className="animate-spin" /> : <SearchX size={14} className="hidden" />}
              {lookupBusy ? "Looking up…" : "Find receipt"}
            </Button>

            {notFound && (
              <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-[#FFE0B2] bg-[#FFF8E1] p-3">
                <SearchX size={15} className="mt-0.5 shrink-0 text-[#B8860B]" />
                <p className="text-[12px] font-semibold leading-snug text-[#8D6708]">{notFound}</p>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-dashed border-[#DFE1E6] bg-[#FAFBFC] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B778C]">How it works</p>
              <ul className="mt-1.5 space-y-1 text-[11.5px] leading-relaxed text-[#6B778C]">
                <li className="flex gap-1.5"><Check size={12} className="mt-0.5 shrink-0 text-[#1B7A2E]" /> Cash refunds adjust the open till drawer automatically</li>
                <li className="flex gap-1.5"><Check size={12} className="mt-0.5 shrink-0 text-[#1B7A2E]" /> Refunds never exceed what the customer actually paid</li>
                <li className="flex gap-1.5"><Check size={12} className="mt-0.5 shrink-0 text-[#1B7A2E]" /> Partial returns supported - already-returned units are greyed out</li>
              </ul>
            </div>
          </div>
        )}

        {/* ── stage 2: return builder ── */}
        {sale && !done && (
          <div className="p-4">
            {/* receipt hero */}
            <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[#172B4D] to-[#0F1D33] p-3.5 text-white">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-[15px] font-bold tracking-wide">{sale.receiptNo}</p>
                  <p className="mt-0.5 text-[11px] text-white/70">
                    {fmtWhen(sale.createdAt)} • {sale.storeName}
                  </p>
                  <p className="text-[11px] text-white/70">
                    {sale.customerName}
                    {sale.customerPhone ? ` • ${sale.customerPhone}` : ""} • {sale.paymentMethod}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wide text-white/60">Paid</p>
                  <p className="font-display text-[17px] font-extrabold">{KES(sale.total)}</p>
                  {sale.kraStatus === "Verified" && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#00C853]/20 px-1.5 py-0.5 text-[9px] font-bold text-[#69F0AE]">
                      <BadgeCheck size={9} /> KRA
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* lines */}
            <div className="df-scroll mt-3 max-h-[240px] space-y-2 overflow-y-auto pr-0.5">
              {sale.items.map((i) => {
                const qty = pick[i.id] ?? 0;
                const none = i.refundable === 0;
                return (
                  <div
                    key={i.id}
                    className={cn(
                      "rounded-xl border p-2.5 transition",
                      none
                        ? "border-[#F4F5F7] bg-[#FAFBFC] opacity-60"
                        : qty > 0
                          ? "border-[#FFCDD2] bg-[#FFEBEE]"
                          : "border-[#DFE1E6] bg-white hover:border-[#0052CC]/40"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#DFE1E6] bg-[#FAFBFC] text-base">
                        {i.emoji}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-[13px] font-semibold text-[#172B4D]", none && "line-through")}>{i.name}</p>
                        <p className="text-[11px] text-[#6B778C]">
                          {KES(i.unitPrice)} each • sold {i.qty}
                          {i.alreadyReturned > 0 && (
                            <span className="font-semibold text-[#B8860B]"> • {i.alreadyReturned} returned</span>
                          )}
                        </p>
                      </div>
                      {none ? (
                        <span className="shrink-0 rounded-full bg-[#F4F5F7] px-2 py-1 text-[10px] font-bold text-[#6B778C]">Fully returned</span>
                      ) : (
                        <div className="flex shrink-0 items-center gap-1 rounded-full border border-[#DFE1E6] bg-white px-1">
                          <button
                            type="button"
                            aria-label={`Decrease return quantity for ${i.name}`}
                            onClick={() => setLine(i, qty - 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-[#6B778C] transition hover:bg-[#F4F5F7] hover:text-[#172B4D]"
                          >
                            <Minus size={12} />
                          </button>
                          <input
                            value={qty}
                            onChange={(e) => setLine(i, Number(e.target.value.replace(/\D/g, "")) || 0)}
                            inputMode="numeric"
                            aria-label={`Return quantity for ${i.name}`}
                            className={cn(
                              "w-9 border-0 bg-transparent text-center text-[12px] font-bold outline-none",
                              qty > 0 ? "text-[#C62828]" : "text-[#172B4D]"
                            )}
                          />
                          <button
                            type="button"
                            aria-label={`Increase return quantity for ${i.name}`}
                            onClick={() => setLine(i, qty + 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-[#6B778C] transition hover:bg-[#F4F5F7] hover:text-[#172B4D]"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                    {qty > 0 && (
                      <p className="mt-1.5 text-right font-mono text-[11px] font-bold text-[#C62828]">
                        refund {KES(i.unitPrice * qty)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* shortcuts */}
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={returnAll}
                className="text-[11px] font-bold text-[#0052CC] transition hover:underline"
              >
                Return all refundable
              </button>
              <button
                type="button"
                onClick={() => setPick({})}
                className="flex items-center gap-1 text-[11px] font-semibold text-[#6B778C] transition hover:text-[#FF5630]"
              >
                <Trash2 size={11} /> Clear picks
              </button>
            </div>

            {/* reason + method */}
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <div>
                <Label htmlFor="qr-reason" className="text-[10px] font-semibold uppercase tracking-wide text-[#6B778C]">
                  Reason
                </Label>
                <select
                  id="qr-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 h-9 w-full rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-2.5 text-[12px] font-semibold text-[#172B4D] outline-none focus:border-[#0052CC]"
                >
                  {RETURN_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="qr-method" className="text-[10px] font-semibold uppercase tracking-wide text-[#6B778C]">
                  Refund via
                </Label>
                <select
                  id="qr-method"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="mt-1 h-9 w-full rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-2.5 text-[12px] font-semibold text-[#172B4D] outline-none focus:border-[#0052CC]"
                >
                  {REFUND_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 flex items-center gap-1 text-[10px] text-[#6B778C]">
                  {(() => {
                    const m = REFUND_METHODS.find((x) => x.value === method);
                    const Icon = m?.icon ?? Landmark;
                    return (
                      <>
                        <Icon size={10} /> {m?.hint}
                      </>
                    );
                  })()}
                </p>
              </div>
            </div>

            {/* restock */}
            <div className="mt-3 flex items-center justify-between rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-3 py-2">
              <div className="flex items-center gap-2">
                <PackageCheck size={14} className="text-[#1B7A2E]" />
                <div>
                  <p className="text-[12px] font-semibold text-[#172B4D]">Restock returned goods</p>
                  <p className="text-[10px] text-[#6B778C]">Turn off for damaged / write-off items</p>
                </div>
              </div>
              <Switch checked={restock} onCheckedChange={setRestock} className="data-[state=checked]:bg-[#00C853]" />
            </div>

            {/* totals + CTA */}
            <div className="mt-3 rounded-xl bg-gradient-to-br from-[#172B4D] to-[#0F1D33] p-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-white/60">Refund total ({lines.length} line{lines.length === 1 ? "" : "s"})</p>
                  <p className="font-display text-[22px] font-extrabold text-white">{KES(refundTotal)}</p>
                </div>
                <Button
                  onClick={() => void process()}
                  disabled={!canProcess}
                  className="h-11 rounded-xl bg-[#D32F2F] px-5 text-[13px] font-bold shadow-[0_6px_18px_rgba(211,47,47,0.4)] hover:bg-[#B71C1C]"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
                  {busy ? "Processing…" : "Process refund"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── stage 3: success ── */}
        {done && (
          <div className="p-4">
            <div className="rounded-xl border border-[#C8E6C9] bg-[#E8F5E9] p-4 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#00C853] text-white shadow-[0_6px_18px_rgba(0,200,83,0.4)]">
                <Check size={20} />
              </span>
              <p className="mt-2 font-display text-[15px] font-bold text-[#1B7A2E]">{done.returnNo} processed</p>
              <p className="text-[12px] text-[#1B7A2E]/80">
                {KES(done.total)} refunded via {done.method}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                {done.creditNoteNo && (
                  <span className="rounded-full bg-[#172B4D] px-2.5 py-1 font-mono text-[10.5px] font-bold text-white">
                    {done.creditNoteNo}
                  </span>
                )}
                {done.giftCardCode && (
                  <span className="rounded-full bg-[#00C853] px-2.5 py-1 font-mono text-[10.5px] font-bold text-white">
                    {done.giftCardCode}
                  </span>
                )}
                {done.tillUpdated && (
                  <span className="rounded-full bg-white px-2.5 py-1 text-[10.5px] font-bold text-[#172B4D] shadow-sm">
                    💵 Open till adjusted
                  </span>
                )}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={resetAll}
                className="h-10 rounded-xl border-[#DFE1E6] bg-white text-[12px] font-bold text-[#172B4D]"
              >
                <RotateCcw size={13} /> Another return
              </Button>
              <Button
                onClick={() => onOpenChange(false)}
                className="h-10 rounded-xl bg-[#0052CC] text-[12px] font-bold hover:bg-[#0041A8]"
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
