"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Gift, Landmark, Nfc, Phone, Printer, QrCode, Receipt, Smartphone, Sparkles, Tag, Loader2, Undo2,
} from "lucide-react";
import { api } from "@/lib/api";
import { CustomerDto, GiftCardDto, KES, SaleDto, SettingsDto } from "@/types";
import { ScreenHeader, Panel, EmptyState, TableSkeleton } from "@/components/df/shared";
import { KraBadge, TierBadge } from "@/components/df/badges";
import { QrImage } from "@/components/df/qr";
import { DukaMark, Logo } from "@/components/df/logo";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/* ── contracts & helpers ──────────────────────────────────── */

type GiftCardWithQr = GiftCardDto & { qr?: string };

/* Sales-return contracts (server: /api/returns) */
interface ReturnItemDto { id: number; name: string; emoji: string; qty: number; unitPrice: number; total: number; saleItemId?: number | null }
interface ReturnDto {
  id: number; returnNo: string; saleId: number; receiptNo: string; storeName: string; customerName: string;
  reason: string; refundMethod: string; restocked: boolean; total: number;
  creditNoteNo: string | null; giftCardCode: string | null; status: string; createdAt: string;
  items: ReturnItemDto[];
}

const GRADIENTS = ["blue-green", "navy", "gold", "blue", "green", "navy-gold"] as const;
type Gradient = (typeof GRADIENTS)[number];

const GC_CLASS: Record<Gradient, string> = {
  "blue-green": "df-gc-blue-green",
  navy: "df-gc-navy",
  gold: "df-gc-gold",
  blue: "df-gc-blue",
  green: "df-gc-green",
  "navy-gold": "df-gc-navy-gold",
};

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

const fmtExpiry = (iso: string | null) => {
  if (!iso) return "No expiry";
  const d = new Date(iso);
  return `Exp ${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
};

const isExpired = (iso: string | null) => !!iso && new Date(iso).getTime() < Date.now();

/* ── screen ───────────────────────────────────────────────── */

export default function ReceiptsScreen() {
  const [sales, setSales] = useState<SaleDto[] | null>(null);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [cards, setCards] = useState<GiftCardWithQr[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [printTarget, setPrintTarget] = useState<"thermal" | "a4" | null>(null);
  const [pngBusy, setPngBusy] = useState(false);
  const [etimsBusy, setEtimsBusy] = useState(false);

  /* returns workspace state */
  const [returns, setReturns] = useState<ReturnDto[] | null>(null);
  const [retQty, setRetQty] = useState<Record<number, number>>({}); // saleItemId → qty to return
  const [retReason, setRetReason] = useState("Customer changed mind");
  const [retMethod, setRetMethod] = useState("Cash refund");
  const [retRestock, setRetRestock] = useState(true);
  const [retBusy, setRetBusy] = useState(false);
  const [retDone, setRetDone] = useState<{ returnNo: string; total: number; method: string; creditNoteNo: string | null; giftCardCode: string | null; tillUpdated: boolean } | null>(null);

  /* branding form */
  const [branding, setBranding] = useState({ primary: "#0052CC", secondary: "#00C853", promoFooter: "" });
  const [savingBrand, setSavingBrand] = useState(false);

  /* new gift card dialog */
  const [gcOpen, setGcOpen] = useState(false);
  const [gcBusy, setGcBusy] = useState(false);
  const [gcForm, setGcForm] = useState({ value: "5000", customerId: "", months: "12", gradient: "blue-green" as Gradient });

  const load = useCallback(async () => {
    try {
      const [s, custs, cfg] = await Promise.all([
        api.get<SaleDto[]>("/api/sales?limit=20"),
        api.get<CustomerDto[]>("/api/customers"),
        api.get<SettingsDto>("/api/settings"),
      ]);
      setSales(s);
      setCustomers(custs);
      setSettings(cfg);
      setSelectedId((cur) => cur ?? s[0]?.id ?? null);
      setBranding({
        primary: cfg.receiptPrimaryColor || "#0052CC",
        secondary: cfg.receiptSecondaryColor || "#00C853",
        promoFooter: cfg.receiptPromoFooter || "",
      });
    } catch (e) {
      toast({ title: "Could not load receipts", description: err(e) });
      setSales([]);
    }
  }, []);

  const loadCards = useCallback(async () => {
    try {
      setCards(await api.get<GiftCardWithQr[]>("/api/gift-cards"));
    } catch (e) {
      toast({ title: "Could not load gift cards", description: err(e) });
      setCards([]);
    }
  }, []);

  /* return history — also powers the per-line "already returned" math */
  const loadReturns = useCallback(async () => {
    try {
      setReturns(await api.get<ReturnDto[]>("/api/returns?limit=200"));
    } catch {
      setReturns([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadCards();
    void loadReturns();
  }, [load, loadCards, loadReturns]);

  /* reset the return form whenever the selected receipt changes */
  useEffect(() => {
    setRetQty({});
    setRetDone(null);
  }, [selectedId]);

  const selected = useMemo(() => sales?.find((s) => s.id === selectedId) ?? null, [sales, selectedId]);
  const loyaltyBal = useMemo(() => {
    if (!selected?.customerId) return null;
    return customers.find((c) => c.id === selected.customerId)?.loyaltyPoints ?? null;
  }, [customers, selected]);

  /* refundable qty per line = sold − already returned (any prior return on this receipt) */
  const returnedByItem = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of returns ?? []) {
      if (r.saleId !== selectedId) continue;
      for (const it of r.items) {
        if (it.saleItemId != null) m.set(it.saleItemId, (m.get(it.saleItemId) ?? 0) + it.qty);
      }
    }
    return m;
  }, [returns, selectedId]);
  const saleHasReturns = useMemo(() => (returns ?? []).some((r) => r.saleId === selectedId), [returns, selectedId]);
  const myReturns = useMemo(() => (returns ?? []).filter((r) => r.saleId === selectedId), [returns, selectedId]);
  /* estimated refund total — mirrors the server's "actually paid" math:
   * line shelf price × (receipt total / receipt subtotal), which folds VAT in
   * and bill-level discounts / redeemed points out, per line. */
  const paidRatio = selected && selected.subtotal > 0 ? selected.total / selected.subtotal : 1;
  const retTotal = useMemo(
    () => (selected ? selected.items.reduce((s, it) => s + (retQty[it.id] ?? 0) * it.unitPrice * paidRatio, 0) : 0),
    [selected, retQty, paidRatio]
  );
  const retAny = Object.values(retQty).some((q) => q > 0);

  const submitReturn = async () => {
    if (!selected) return;
    const items = Object.entries(retQty)
      .filter(([, q]) => q > 0)
      .map(([id, qty]) => ({ saleItemId: Number(id), qty }));
    if (!items.length) return;
    setRetBusy(true);
    try {
      const d = await api.post<{
        ok: boolean; return: { returnNo: string; total: number }; receiptNo: string;
        giftCardCode: string | null; creditNoteNo: string | null; tillUpdated: boolean;
      }>("/api/returns", {
        saleId: selected.id,
        items,
        reason: retReason,
        refundMethod: retMethod,
        restock: retRestock,
      });
      setRetDone({
        returnNo: d.return.returnNo,
        total: d.return.total,
        method: retMethod,
        creditNoteNo: d.creditNoteNo,
        giftCardCode: d.giftCardCode,
        tillUpdated: d.tillUpdated,
      });
      setRetQty({});
      toast({
        title: `${d.return.returnNo} processed ✓`,
        description: `${KES(d.return.total)} via ${retMethod}${d.creditNoteNo ? ` • ${d.creditNoteNo}` : ""}${d.giftCardCode ? ` • ${d.giftCardCode} issued` : ""}${retRestock ? " • restocked" : ""}`,
      });
      void loadReturns();
    } catch (e) {
      toast({ title: "Return failed", description: err(e) });
    } finally {
      setRetBusy(false);
    }
  };

  const handlePrint = (target: "thermal" | "a4") => {
    setPrintTarget(target);
    window.setTimeout(() => {
      window.print();
      setPrintTarget(null);
    }, 120);
  };

  /** Renders the 80mm receipt to a real PNG via canvas and downloads it. */
  const downloadThermalPng = async (sale: SaleDto) => {
    setPngBusy(true);
    try {
      const W = 300;
      const lineH = 16;
      const rows = sale.items.length + 12;
      const H = 96 + rows * lineH + 200;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#172B4D";
      ctx.textAlign = "center";

      let y = 34;
      ctx.font = 'bold 20px Sora, sans-serif';
      ctx.fillText("DukaFlow", W / 2, y);
      y += 18;
      ctx.font = '11px monospace';
      ctx.fillStyle = "#6B778C";
      ctx.fillText(`KRA PIN P051234567A • ${sale.storeName ?? "Thika Road"}`, W / 2, y);
      y += 14;
      ctx.fillText("0712 345 678 • Thika Road, Nairobi", W / 2, y);
      y += 22;

      ctx.strokeStyle = "#DFE1E6";
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(12, y); ctx.lineTo(W - 12, y); ctx.stroke();
      ctx.setLineDash([]);
      y += 16;

      ctx.fillStyle = "#172B4D";
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = "left";
      ctx.fillText(sale.receiptNo, 14, y);
      ctx.textAlign = "right";
      ctx.font = '11px monospace';
      ctx.fillStyle = "#6B778C";
      ctx.fillText(new Date(sale.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }), W - 14, y);
      y += 16;
      ctx.textAlign = "left";
      ctx.fillStyle = "#172B4D";
      ctx.fillText(`Customer: ${sale.customerName ?? "Walk-in"}${sale.customerTier ? ` (${sale.customerTier})` : ""}`, 14, y);
      y += 20;

      // items
      ctx.font = '11px monospace';
      for (const it of sale.items) {
        ctx.fillStyle = "#172B4D";
        ctx.textAlign = "left";
        ctx.fillText(`${it.qty} x ${it.name.slice(0, 22)}`, 14, y);
        ctx.textAlign = "right";
        ctx.fillText(Math.round(it.total).toLocaleString(), W - 14, y);
        y += lineH;
      }

      y += 6;
      ctx.strokeStyle = "#DFE1E6";
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(12, y); ctx.lineTo(W - 12, y); ctx.stroke();
      ctx.setLineDash([]);
      y += 18;

      const kv = (label: string, value: string, bold = false, color = "#172B4D") => {
        ctx.font = bold ? 'bold 12px monospace' : '11px monospace';
        ctx.fillStyle = color;
        ctx.textAlign = "left";
        ctx.fillText(label, 14, y);
        ctx.textAlign = "right";
        ctx.fillText(value, W - 14, y);
        y += bold ? 20 : lineH;
      };
      kv("Subtotal", Math.round(sale.subtotal).toLocaleString());
      if (sale.discount > 0) kv("Discount", `-${Math.round(sale.discount).toLocaleString()}`, false, "#FF5630");
      kv("VAT 16%", Math.round(sale.vat).toLocaleString());
      kv("TOTAL", `KES ${Math.round(sale.total).toLocaleString()}`, true);
      kv("Payment", sale.paymentMethod);

      y += 10;
      ctx.textAlign = "center";
      ctx.fillStyle = "#0052CC";
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`Loyalty earned ${sale.pointsEarned} pts${loyaltyBal !== null ? ` | Bal ${loyaltyBal}` : ""}`, W / 2, y);
      y += 26;

      // QR (server PNG data URL)
      const qrSrc = sale.qrCodeBase64;
      if (qrSrc) {
        const img = new Image();
        await new Promise<void>((res) => {
          img.onload = () => res();
          img.onerror = () => res();
          img.src = qrSrc;
        });
        ctx.drawImage(img, W / 2 - 55, y, 110, 110);
        y += 118;
      }
      ctx.fillStyle = "#6B778C";
      ctx.font = '9px monospace';
      ctx.fillText(`KRA CU: ${sale.cuInvoiceNumber ?? "pending"}`, W / 2, y);
      y += 24;

      ctx.fillStyle = "#FF5630";
      ctx.font = 'bold 11px monospace';
      const promo = branding.promoFooter.slice(0, 44);
      ctx.fillText(promo, W / 2, y);
      y += 16;
      ctx.fillStyle = "#6B778C";
      ctx.font = '9px monospace';
      ctx.fillText("Karibu tena! • DukaFlow POS v2.4", W / 2, y);

      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sale.receiptNo}.png`;
      a.click();
      toast({ title: "Receipt PNG downloaded", description: `${sale.receiptNo}.png • 300px thermal render with KRA QR` });
    } catch (e) {
      toast({ title: "PNG render failed", description: e instanceof Error ? e.message : "Try again" });
    } finally {
      setPngBusy(false);
    }
  };

  const saveBranding = async () => {
    setSavingBrand(true);
    try {
      await api.put("/api/settings", {
        receiptPrimaryColor: branding.primary,
        receiptSecondaryColor: branding.secondary,
        receiptPromoFooter: branding.promoFooter,
      });
      toast({ title: "Branding saved", description: "Receipts and invoices now use the new colors & promo footer." });
      await load();
    } catch (e) {
      toast({ title: "Save failed", description: err(e) });
    } finally {
      setSavingBrand(false);
    }
  };

  const submitGiftCard = async () => {
    const value = Number(gcForm.value);
    if (!value || value <= 0) {
      toast({ title: "Enter a gift card value" });
      return;
    }
    setGcBusy(true);
    try {
      const res = await api.post<{ ok: boolean; card: { code: string } }>("/api/gift-cards", {
        initialBalance: value,
        months: Number(gcForm.months) || 12,
        customerId: gcForm.customerId ? Number(gcForm.customerId) : undefined,
        gradient: gcForm.gradient,
      });
      toast({ title: `Gift card ${res.card.code} issued`, description: `KES ${value.toLocaleString()} • expires in ${gcForm.months} months` });
      setGcOpen(false);
      await loadCards();
    } catch (e) {
      toast({ title: "Could not issue gift card", description: err(e) });
    } finally {
      setGcBusy(false);
    }
  };

  const dash = <div className="my-2 border-t border-dashed border-[#DFE1E6]" />;

  return (
    <div>
      <ScreenHeader
        title="Receipts & Print"
        subtitle="80mm thermal • A4 invoices • Gift cards"
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-[#C8E6C9] bg-[#E8F5E9] px-3 py-1.5 text-[11px] font-bold text-[#1B7A2E]">
            <Printer className="h-3.5 w-3.5" /> Print ready — 80mm & A4
          </span>
        }
      />

      <div className="grid grid-cols-12 gap-6">
        {/* ══════════ GALLERY ══════════ */}
        <div className="col-span-12 @4xl:col-span-4">
          <Panel padding={false} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#DFE1E6] px-4 py-3">
              <h3 className="font-display text-[14px] font-bold text-[#172B4D]">Recent receipts</h3>
              <Badge variant="outline" className="rounded-full border-[#DFE1E6] text-[10px] font-semibold text-[#6B778C]">
                {sales ? `${sales.length} sales` : "…"}
              </Badge>
            </div>
            <ScrollArea className="h-[620px]">
              <div className="df-scroll divide-y divide-[#F4F5F7]">
                {!sales ? (
                  <div className="space-y-2 p-3">
                    <TableSkeleton rows={8} cols={2} />
                  </div>
                ) : sales.length === 0 ? (
                  <div className="p-4">
                    <EmptyState icon={<Receipt className="h-6 w-6" />} title="No sales yet" sub="Complete a sale at the POS to see receipts here." />
                  </div>
                ) : (
                  sales.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className={cn(
                        "block w-full px-4 py-3 text-left transition",
                        selectedId === s.id ? "border-l-2 border-[#0052CC] bg-[#E9F2FF]" : "border-l-2 border-transparent hover:bg-[#F4F5F7]"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[12px] font-bold text-[#172B4D]">{s.receiptNo}</span>
                        <span className="font-display text-[13px] font-bold text-[#172B4D]">{KES(s.total)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] text-[#6B778C]">{s.customerName ?? "Walk-in"}</span>
                        <span className="inline-flex shrink-0 items-center gap-1.5">
                          {(returns ?? []).some((r) => r.saleId === s.id) && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-[#FFEBE8] px-1.5 py-0.5 text-[9px] font-bold text-[#FF5630]">
                              <Undo2 className="h-2.5 w-2.5" /> RET
                            </span>
                          )}
                          <span className="rounded-full bg-[#F4F5F7] px-2 py-0.5 text-[10px] font-semibold text-[#6B778C]">{s.paymentMethod}</span>
                          <KraBadge status={s.kraStatus} />
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
              <ScrollBar />
            </ScrollArea>
          </Panel>
        </div>

        {/* ══════════ PREVIEW ══════════ */}
        <div className="col-span-12 @4xl:col-span-8">
          <Tabs defaultValue="thermal">
            <TabsList className="mb-4 h-10 rounded-full border border-[#DFE1E6] bg-white p-1">
              {[
                ["thermal", "80mm Thermal"],
                ["a4", "A4 Invoice"],
                ["gift", "Gift Card"],
                ["returns", "Returns"],
              ].map(([v, l]) => (
                <TabsTrigger key={v} value={v} className="rounded-full px-4 text-[13px] font-semibold data-[state=active]:bg-[#172B4D] data-[state=active]:text-white">
                  {l}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* ── 80MM THERMAL ── */}
            <TabsContent value="thermal" className="space-y-4">
              <div className={cn("rounded-2xl border border-[#DFE1E6] bg-[#F4F5F7] p-6", printTarget === "thermal" && "df-print-area border-none bg-white p-0")}>
                {!sales ? (
                  <Skeleton className="mx-auto h-[520px] w-[300px] rounded-xl" />
                ) : !selected ? (
                  <EmptyState icon={<Receipt className="h-6 w-6" />} title="Select a receipt" sub="Pick a sale from the gallery to preview its 80mm thermal slip." />
                ) : (
                  <div className="df-thermal relative mx-auto w-[300px] p-4 text-[11px] leading-[1.4] text-[#172B4D] shadow-[0_10px_30px_rgba(23,43,77,0.15)]">
                    <div className="flex justify-center">
                      <Logo variant="full" size={28} />
                    </div>
                    <p className="mt-2 text-center font-semibold">{settings?.companyName ?? "DukaFlow Ltd"}</p>
                    <p className="text-center font-mono text-[10px] text-[#6B778C]">PIN {settings?.kraPin ?? "P051234567A"}</p>
                    <p className="text-center font-mono text-[10px] text-[#6B778C]">{selected.storeName ?? "Thika Road"} • 0712 345 678</p>
                    {dash}
                    <div className="flex justify-between">
                      <span className="font-bold">{selected.receiptNo}</span>
                      <span>{fmtDateTime(selected.createdAt)}</span>
                    </div>
                    <p>
                      Customer: <span className="font-semibold">{selected.customerName ?? "Walk-in"}</span>
                      {selected.customerTier ? <span className="ml-1 font-bold text-[#B8860B]">{selected.customerTier}</span> : null}
                    </p>
                    {dash}
                    <table className="w-full">
                      <tbody>
                        {selected.items.map((it) => (
                          <tr key={it.id}>
                            <td className="py-0.5">{it.qty} x {it.name}</td>
                            <td className="py-0.5 text-right tabular-nums">{it.total.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {dash}
                    <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{selected.subtotal.toLocaleString()}</span></div>
                    {selected.discount > 0 && (
                      <div className="flex justify-between text-[#FF5630]">
                        <span>Discount {selected.promoCode ?? ""}</span>
                        <span className="tabular-nums">−{selected.discount.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between"><span>VAT 16%</span><span className="tabular-nums">{selected.vat.toLocaleString()}</span></div>
                    <div className="mt-1 flex justify-between border-t border-dashed border-[#DFE1E6] pt-1 text-[14px] font-bold">
                      <span>TOTAL</span><span className="tabular-nums">{KES(selected.total)}</span>
                    </div>
                    <p className="mt-1">Payment: {selected.paymentMethod}</p>
                    <p className="text-[#0052CC]">
                      Loyalty Earned {selected.pointsEarned} pts{loyaltyBal !== null ? ` | Bal ${loyaltyBal}` : ""}
                    </p>
                    {selected.pointsRedeemed > 0 && (
                      <p className="text-[#0052CC]">Redeemed {selected.pointsRedeemed} pts</p>
                    )}
                    <div className="mt-3 flex flex-col items-center rounded-lg border border-[#DFE1E6] p-2">
                      {selected.qrCodeBase64 ? (
                        <img src={selected.qrCodeBase64} alt="KRA verification QR" width={140} height={140} className="mx-auto" />
                      ) : (
                        <QrImage text={`KRA:${selected.receiptNo}:TOTAL:${selected.total}`} size={140} className="mx-auto" />
                      )}
                      <p className="mt-1 text-center font-mono text-[10px] text-[#6B778C]">
                        KRA Verification QR — CU: {selected.cuInvoiceNumber ?? "pending"}
                      </p>
                    </div>
                    {branding.promoFooter && (
                      <p className="mt-3 text-center font-bold text-[#FF5630]">{branding.promoFooter}</p>
                    )}
                    <p className="mt-2 text-center font-mono text-[9px] text-[#6B778C]">Karibu tena! • DukaFlow POS v2.4</p>
                  </div>
                )}
              </div>
              {selected && (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => handlePrint("thermal")} className="h-9 rounded-xl bg-[#0052CC] text-[13px] font-semibold hover:bg-[#0041A8]">
                    <Printer className="h-4 w-4" /> Print 80mm
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void downloadThermalPng(selected)}
                    disabled={pngBusy}
                    className="h-9 rounded-xl text-[13px] font-semibold"
                  >
                    {pngBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />} Download PNG
                  </Button>
                  {selected.kraStatus !== "Verified" && (
                    <Button
                      variant="outline"
                      disabled={etimsBusy}
                      onClick={async () => {
                        setEtimsBusy(true);
                        try {
                          const r = await api.post<{ ok: boolean; message: string; sale: SaleDto }>(
                            `/api/sales/${selected.id}/etims`,
                            {}
                          );
                          toast({ title: "KRA eTIMS submitted ✅", description: r.message });
                          setSales((cur) => (cur ? cur.map((s) => (s.id === r.sale.id ? { ...s, ...r.sale } : s)) : cur));
                        } catch (e) {
                          toast({ title: "eTIMS submission failed", description: e instanceof Error ? e.message : "Try again" });
                        } finally {
                          setEtimsBusy(false);
                        }
                      }}
                      className="h-9 rounded-xl border-[#FFD54F] bg-[#FFF8E1] text-[13px] font-semibold text-[#B8860B] hover:bg-[#FFF3CD]"
                    >
                      {etimsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />} Retry eTIMS
                    </Button>
                  )}
                </div>
              )}
            </TabsContent>

            {/* ── A4 INVOICE ── */}
            <TabsContent value="a4" className="space-y-4">
              <div className={cn("rounded-2xl border border-[#DFE1E6] bg-[#F4F5F7] p-6", printTarget === "a4" && "df-print-area border-none bg-white p-0")}>
                {!sales ? (
                  <Skeleton className="mx-auto h-[640px] w-full max-w-[700px] rounded-xl" />
                ) : !selected ? (
                  <EmptyState icon={<Receipt className="h-6 w-6" />} title="Select a receipt" sub="Pick a sale from the gallery to render its A4 tax invoice." />
                ) : (
                  <div className="mx-auto w-full max-w-[700px] border border-[#DFE1E6] bg-white p-8 shadow-[0_10px_30px_rgba(23,43,77,0.12)]">
                    {/* header band */}
                    <div className="flex items-center justify-between rounded-xl p-5 text-white" style={{ background: "linear-gradient(135deg,#0052CC 0%,#003d99 100%)" }}>
                      <div>
                        <Logo variant="white" size={22} />
                        <p className="mt-1.5 text-[11px] text-white/85">{settings?.companyName ?? "DukaFlow Ltd"} • PIN {settings?.kraPin ?? "P051234567A"}</p>
                        <p className="text-[11px] text-white/85">{selected.storeName ?? "Thika Road"}, Nairobi • 0712 345 678</p>
                      </div>
                      <p className="font-display text-2xl font-extrabold tracking-tight">TAX INVOICE</p>
                    </div>

                    {/* bill-to + meta */}
                    <div className="mt-5 grid grid-cols-2 gap-4">
                      <div className="rounded-xl border border-[#DFE1E6] p-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Bill To</p>
                        <p className="mt-1 flex items-center gap-2 text-[14px] font-bold text-[#172B4D]">
                          {selected.customerName ?? "Walk-in"}
                          <TierBadge tier={selected.customerTier} />
                        </p>
                        <p className="text-[12px] text-[#6B778C]">
                          {customers.find((c) => c.id === selected.customerId)?.phone ?? "—"}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl border border-[#DFE1E6] p-3 text-[11px]">
                        <span className="text-[#6B778C]">Invoice #</span><span className="text-right font-mono font-bold text-[#172B4D]">{selected.receiptNo}</span>
                        <span className="text-[#6B778C]">Date</span><span className="text-right text-[#172B4D]">{fmtDateTime(selected.createdAt)}</span>
                        <span className="text-[#6B778C]">Payment</span><span className="text-right font-semibold text-[#172B4D]">{selected.paymentMethod}</span>
                        <span className="text-[#6B778C]">KRA CU</span><span className="text-right font-mono text-[#172B4D]">{selected.cuInvoiceNumber ?? "pending"}</span>
                        <span className="text-[#6B778C]">eTIMS</span>
                        <span className="text-right"><KraBadge status={selected.kraStatus} /></span>
                      </div>
                    </div>

                    {/* items */}
                    <table className="mt-5 w-full overflow-hidden rounded-xl border border-[#DFE1E6] text-[12px]">
                      <thead>
                        <tr className="text-white" style={{ background: "#0052CC" }}>
                          <th className="px-3 py-2 text-left font-semibold">Item</th>
                          <th className="px-3 py-2 text-center font-semibold">Qty</th>
                          <th className="px-3 py-2 text-right font-semibold">Unit Price</th>
                          <th className="px-3 py-2 text-right font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.items.map((it, i) => (
                          <tr key={it.id} className={cn(i % 2 === 1 && "bg-[#FAFBFC]")}>
                            <td className="px-3 py-2 font-medium text-[#172B4D]">{it.emoji} {it.name}</td>
                            <td className="px-3 py-2 text-center tabular-nums text-[#172B4D]">{it.qty}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-[#172B4D]">{it.unitPrice.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right font-bold tabular-nums text-[#172B4D]">{it.total.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* totals + QR */}
                    <div className="mt-5 flex flex-wrap items-start justify-end gap-6">
                      <div className="w-[220px] space-y-1 text-[12px]">
                        <div className="flex justify-between text-[#6B778C]"><span>Subtotal</span><span className="tabular-nums">{KES(selected.subtotal)}</span></div>
                        {selected.discount > 0 && (
                          <div className="flex justify-between font-semibold text-[#FF5630]">
                            <span>Discount{selected.promoCode ? ` ${selected.promoCode}` : ""}</span>
                            <span className="tabular-nums">−{KES(selected.discount)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-[#6B778C]"><span>VAT 16%</span><span className="tabular-nums">{KES(selected.vat)}</span></div>
                        <div className="flex justify-between border-t border-[#DFE1E6] pt-1.5">
                          <span className="font-display text-[14px] font-bold text-[#172B4D]">GRAND TOTAL</span>
                          <span className="font-display text-[16px] font-extrabold text-[#172B4D]">{KES(selected.total)}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-center">
                        {selected.qrCodeBase64 ? (
                          <img src={selected.qrCodeBase64} alt="KRA verification QR" width={150} height={150} className="rounded-lg border border-[#DFE1E6]" />
                        ) : (
                          <QrImage text={`KRA:${selected.receiptNo}:TOTAL:${selected.total}`} size={150} />
                        )}
                        <p className="mt-1 text-center text-[10px] font-semibold text-[#6B778C]">Scan to verify with KRA</p>
                      </div>
                    </div>

                    {/* loyalty strip */}
                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-[#E9F2FF] px-4 py-2.5 text-[11px] font-semibold text-[#0052CC]">
                      <span className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" /> Loyalty earned: {selected.pointsEarned} pts</span>
                      {selected.pointsRedeemed > 0 && <span>Redeemed: {selected.pointsRedeemed} pts</span>}
                      {loyaltyBal !== null && <span>Balance: {loyaltyBal} pts</span>}
                      {selected.tierAtSale && <span>Tier at sale: {selected.tierAtSale}</span>}
                    </div>

                    {/* terms + payments + signature */}
                    <div className="mt-5 grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Payment details</p>
                        <div className="mt-1.5 space-y-1 text-[11px] text-[#172B4D]">
                          <p className="flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5 text-[#00C853]" /> M-Pesa Till 123456</p>
                          <p className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-[#0052CC]" /> Paybill 654321</p>
                          <p className="flex items-center gap-1.5"><Landmark className="h-3.5 w-3.5 text-[#172B4D]" /> Bank: Equity 1234567890</p>
                        </div>
                        <p className="mt-3 max-w-[280px] text-[10px] leading-relaxed text-[#6B778C]">
                          Payment due in 30 days. Goods sold are not returnable after 7 days. This invoice is generated
                          electronically and verified by KRA eTIMS. Thank you for your business!
                        </p>
                      </div>
                      <div className="flex flex-col items-end justify-end">
                        <div className="w-48 border-t border-[#DFE1E6] pt-1 text-right text-[10px] text-[#6B778C]">Authorised Signature</div>
                        <p className="font-display mt-3 text-[12px] font-bold text-[#0052CC]">Sell Smart. Stock Smart.</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {selected && (
                <Button onClick={() => handlePrint("a4")} className="h-9 rounded-xl bg-[#0052CC] text-[13px] font-semibold hover:bg-[#0041A8]">
                  <Printer className="h-4 w-4" /> Print A4
                </Button>
              )}
            </TabsContent>

            {/* ── GIFT CARDS ── */}
            <TabsContent value="gift">
              <div className="grid grid-cols-12 gap-4">
                <div className="col-span-12 @6xl:col-span-8">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-display text-[14px] font-bold text-[#172B4D]">Gift cards issued</h3>
                    <Button onClick={() => setGcOpen(true)} className="h-8 rounded-xl bg-[#0052CC] px-3 text-[12px] font-semibold hover:bg-[#0041A8]">
                      <Gift className="h-3.5 w-3.5" /> New Gift Card
                    </Button>
                  </div>
                  {!cards ? (
                    <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
                      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[210px] rounded-2xl" />)}
                    </div>
                  ) : cards.length === 0 ? (
                    <EmptyState icon={<Gift className="h-6 w-6" />} title="No gift cards yet" sub="Issue the first DukaFlow gift card to a loyal customer." action={<Button onClick={() => setGcOpen(true)} className="rounded-xl bg-[#0052CC] hover:bg-[#0041A8]">New Gift Card</Button>} />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
                      {cards.map((c) => {
                        const dead = c.status !== "Active" || isExpired(c.expiry);
                        return (
                          <div
                            key={c.id}
                            className={cn(
                              "relative h-[210px] w-full max-w-[336px] overflow-hidden rounded-2xl p-5 text-white shadow-lg",
                              GC_CLASS[(c.gradient as Gradient) in GC_CLASS ? (c.gradient as Gradient) : "blue-green"]
                            )}
                          >
                            {/* holographic sheen */}
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-white/0 via-white/25 to-white/0" />
                            <div className="relative flex h-full flex-col justify-between">
                              <div className="flex items-start justify-between">
                                <DukaMark white className="h-7 w-7" />
                                <Nfc className="h-6 w-6 text-white/80" />
                              </div>
                              <div>
                                <p className="font-display text-[26px] font-bold leading-none">{KES(c.balance)}</p>
                                <p className="mt-1 font-mono text-[11px] opacity-90">{c.code} • {fmtExpiry(c.expiry)}</p>
                              </div>
                              <div className="flex items-end justify-between">
                                <div>
                                  <p className="text-[10px] opacity-80">DukaFlow • Gift Card</p>
                                  <p className="text-[11px] font-semibold">{c.customerName ?? "Unassigned"}</p>
                                </div>
                                <div className="rounded-lg bg-white p-1">
                                  <QrImage text={`DUKAFLOW-GIFT:${c.code}:${c.balance}`} size={64} className="rounded" />
                                </div>
                              </div>
                            </div>
                            {dead && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                                <span className="-rotate-12 rounded-lg border-2 border-white/80 px-4 py-1 font-display text-lg font-extrabold tracking-widest text-white">
                                  {c.status === "Active" ? "EXPIRED" : c.status.toUpperCase()}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* customization rail */}
                <div className="col-span-12 @6xl:col-span-4">
                  <Panel className="h-fit">
                    <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Customization</h3>
                    <p className="mt-0.5 text-[12px] text-[#6B778C]">Branding applied to every receipt & invoice</p>
                    <div className="mt-4 space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="primary-color" className="text-[11px] font-semibold text-[#172B4D]">Primary color</Label>
                        <div className="flex items-center gap-2">
                          <input
                            id="primary-color"
                            type="color"
                            value={branding.primary}
                            onChange={(e) => setBranding((b) => ({ ...b, primary: e.target.value }))}
                            className="h-9 w-10 cursor-pointer rounded-lg border border-[#DFE1E6] bg-white p-1"
                            aria-label="Primary color"
                          />
                          <Input value={branding.primary} onChange={(e) => setBranding((b) => ({ ...b, primary: e.target.value }))} className="h-9 flex-1 rounded-xl font-mono text-[12px]" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="secondary-color" className="text-[11px] font-semibold text-[#172B4D]">Secondary color</Label>
                        <div className="flex items-center gap-2">
                          <input
                            id="secondary-color"
                            type="color"
                            value={branding.secondary}
                            onChange={(e) => setBranding((b) => ({ ...b, secondary: e.target.value }))}
                            className="h-9 w-10 cursor-pointer rounded-lg border border-[#DFE1E6] bg-white p-1"
                            aria-label="Secondary color"
                          />
                          <Input value={branding.secondary} onChange={(e) => setBranding((b) => ({ ...b, secondary: e.target.value }))} className="h-9 flex-1 rounded-xl font-mono text-[12px]" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="promo-footer" className="flex items-center gap-1 text-[11px] font-semibold text-[#172B4D]">
                          <Tag className="h-3 w-3" /> Footer promo text
                        </Label>
                        <Textarea
                          id="promo-footer"
                          value={branding.promoFooter}
                          onChange={(e) => setBranding((b) => ({ ...b, promoFooter: e.target.value }))}
                          placeholder="Thank You! You saved KES 300 with points! Come again!"
                          className="h-20 resize-none rounded-xl text-[13px]"
                        />
                      </div>
                      <div className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Live promo preview</p>
                        <p className="mt-1 text-center text-[12px] font-bold text-[#FF5630]">
                          {branding.promoFooter || "Thank You! You saved KES 300 with points!"}
                        </p>
                      </div>
                      <Button onClick={() => void saveBranding()} disabled={savingBrand} className="h-10 w-full rounded-xl bg-[#0052CC] font-semibold hover:bg-[#0041A8]">
                        {savingBrand && <Loader2 className="h-4 w-4 animate-spin" />} Save & Preview Live
                      </Button>
                    </div>
                  </Panel>
                </div>
              </div>
            </TabsContent>

            {/* ── RETURNS & REFUNDS ─────────────────────────────────────── */}
            <TabsContent value="returns" className="space-y-4">
              {!selected ? (
                <Panel>
                  <EmptyState icon={<Undo2 className="h-6 w-6" />} title="Select a receipt" sub="Pick a receipt from the gallery to process a return or refund against it." />
                </Panel>
              ) : (
                <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
                  {/* ── NEW RETURN ── */}
                  <Panel>
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-display flex items-center gap-2 text-[14px] font-bold text-[#172B4D]">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#FFEBE8] text-[#FF5630]">
                          <Undo2 size={14} />
                        </span>
                        Return items — {selected.receiptNo}
                      </h3>
                      {saleHasReturns && (
                        <Badge className="rounded-full bg-[#FFEBE8] text-[10px] font-bold text-[#FF5630] hover:bg-[#FFEBE8]">
                          partially returned
                        </Badge>
                      )}
                    </div>

                    {retDone ? (
                      /* success card */
                      <div className="space-y-3">
                        <div className="rounded-xl border border-[#C8E6C9] bg-[#E8F5E9] p-4">
                          <p className="flex items-center gap-2 text-[14px] font-bold text-[#1B7A2E]">
                            ✓ {retDone.returnNo} — {KES(retDone.total)} refunded
                          </p>
                          <p className="mt-1 text-[12px] text-[#1B7A2E]">
                            Method: {retDone.method}
                            {retDone.creditNoteNo ? ` • Credit note ${retDone.creditNoteNo} issued` : ""}
                            {retDone.giftCardCode ? ` • Gift card ${retDone.giftCardCode} activated with the refund balance` : ""}
                            {retDone.method === "Cash refund" ? (retDone.tillUpdated ? " • open till adjusted" : " • no till shift open — drawer payout logged") : ""}
                          </p>
                        </div>
                        <Button variant="outline" onClick={() => setRetDone(null)} className="h-9 w-full rounded-xl text-[13px] font-semibold">
                          Process another return on this receipt
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* line pickers */}
                        <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-xl border border-[#DFE1E6] p-2">
                          {selected.items.map((it) => {
                            const returned = returnedByItem.get(it.id) ?? 0;
                            const refundable = it.qty - returned;
                            const fullyDone = refundable <= 0;
                            return (
                              <div
                                key={it.id}
                                className={cn(
                                  "flex items-center gap-2.5 rounded-lg px-2 py-1.5",
                                  fullyDone ? "opacity-45" : "hover:bg-[#F4F5F7]"
                                )}
                              >
                                <span className="text-[15px]">{it.emoji}</span>
                                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#172B4D]">{it.name}</span>
                                <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#6B778C]">
                                  sold {Math.round(it.qty)}{returned > 0 ? ` · ret ${Math.round(returned)}` : ""}
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  max={refundable}
                                  value={retQty[it.id] ?? 0}
                                  disabled={fullyDone}
                                  onChange={(e) => {
                                    const v = Math.max(0, Math.min(refundable, Number(e.target.value) || 0));
                                    setRetQty((q) => ({ ...q, [it.id]: v }));
                                  }}
                                  className="h-7 w-16 rounded-lg border border-[#DFE1E6] bg-white text-center font-mono text-[12px] font-bold tabular-nums text-[#172B4D] outline-none focus:border-[#0052CC] disabled:cursor-not-allowed"
                                  aria-label={`Qty to return for ${it.name}`}
                                />
                              </div>
                            );
                          })}
                        </div>

                        {/* reason + method + restock */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[11px] font-semibold text-[#6B778C]">Reason</Label>
                            <Select value={retReason} onValueChange={setRetReason}>
                              <SelectTrigger className="h-8 rounded-lg text-[12px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {["Customer changed mind", "Damaged / defective", "Wrong item sold", "Expired", "Overcharged", "Other"].map((r) => (
                                  <SelectItem key={r} value={r}>{r}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[11px] font-semibold text-[#6B778C]">Refund method</Label>
                            <Select value={retMethod} onValueChange={setRetMethod}>
                              <SelectTrigger className="h-8 rounded-lg text-[12px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Cash refund">Cash refund (from drawer)</SelectItem>
                                <SelectItem value="M-Pesa B2C">M-Pesa B2C payout</SelectItem>
                                <SelectItem value="Credit note">Credit note {selected.paymentMethod === "Credit Sale" ? "(reduces debt)" : ""}</SelectItem>
                                <SelectItem value="Gift card">Gift card (store credit)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="flex items-center justify-between rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-3 py-2">
                          <div>
                            <p className="text-[12px] font-bold text-[#172B4D]">Restock returned goods</p>
                            <p className="text-[10px] text-[#6B778C]">Off for damaged/expired stock (written off)</p>
                          </div>
                          <Switch checked={retRestock} onCheckedChange={setRetRestock} aria-label="Toggle restock" />
                        </div>

                        {/* total + submit */}
                        <div className="flex items-center justify-between rounded-xl bg-[#172B4D] px-4 py-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Refund total</p>
                            <p className="font-display text-[18px] font-bold text-white">{KES(retTotal)}</p>
                          </div>
                          <Button
                            onClick={() => void submitReturn()}
                            disabled={retBusy || !retAny || retTotal <= 0}
                            className="h-10 rounded-xl bg-[#FF5630] px-5 text-[13px] font-bold text-white hover:bg-[#E64526] disabled:opacity-40"
                          >
                            {retBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                            Process return
                          </Button>
                        </div>
                      </div>
                    )}
                  </Panel>

                  {/* ── HISTORY: this receipt + global ── */}
                  <Panel>
                    <h3 className="font-display mb-3 text-[14px] font-bold text-[#172B4D]">
                      Return history
                      <span className="ml-2 text-[11px] font-semibold text-[#6B778C]">{(returns ?? []).length} all-time</span>
                    </h3>
                    <div className="df-scroll max-h-[420px] space-y-2 overflow-y-auto pr-1">
                      {returns === null ? (
                        <TableSkeleton rows={4} cols={2} />
                      ) : returns.length === 0 ? (
                        <EmptyState icon={<Undo2 className="h-6 w-6" />} title="No returns yet" sub="Processed refunds will appear here with their credit notes and payout methods." />
                      ) : (
                        [...myReturns, ...(returns ?? []).filter((r) => r.saleId !== selectedId)].map((r) => (
                          <div key={r.id} className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-[12px] font-bold text-[#172B4D]">{r.returnNo}</span>
                              <span className="font-display text-[13px] font-bold text-[#FF5630]">−{KES(r.total)}</span>
                            </div>
                            <p className="mt-0.5 truncate text-[11px] text-[#6B778C]">
                              {r.receiptNo} • {r.customerName} • {r.storeName}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className="rounded-full bg-[#F4F5F7] px-2 py-0.5 text-[10px] font-semibold text-[#6B778C]">{r.reason}</span>
                              <span className="rounded-full bg-[#E9F2FF] px-2 py-0.5 text-[10px] font-bold text-[#0052CC]">{r.refundMethod}</span>
                              {r.creditNoteNo && (
                                <span className="rounded-full bg-[#172B4D] px-2 py-0.5 font-mono text-[10px] font-bold text-white">{r.creditNoteNo}</span>
                              )}
                              {r.giftCardCode && (
                                <span className="rounded-full bg-[#E8F5E9] px-2 py-0.5 font-mono text-[10px] font-bold text-[#1B7A2E]">{r.giftCardCode}</span>
                              )}
                              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", r.restocked ? "bg-[#E8F5E9] text-[#1B7A2E]" : "bg-[#FFEBE8] text-[#FF5630]")}>
                                {r.restocked ? "restocked" : "written off"}
                              </span>
                              <span className="ml-auto text-[10px] text-[#6B778C]">{fmtDateTime(r.createdAt)}</span>
                            </div>
                            <p className="mt-1 text-[11px] text-[#6B778C]">
                              {r.items.map((it) => `${it.qty} × ${it.name}`).join(", ")}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </Panel>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* ══════════ New gift card dialog ══════════ */}
      <Dialog open={gcOpen} onOpenChange={setGcOpen}>
        <DialogContent className="rounded-[20px] sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="font-display">Issue gift card</DialogTitle>
            <DialogDescription>Prepaid store credit — usable at any DukaFlow till.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="gc-value" className="text-[12px] font-semibold text-[#172B4D]">Value (KES)</Label>
                <Input id="gc-value" type="number" min={100} value={gcForm.value} onChange={(e) => setGcForm((f) => ({ ...f, value: e.target.value }))} className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold text-[#172B4D]">Expiry</Label>
                <Select value={gcForm.months} onValueChange={(v) => setGcForm((f) => ({ ...f, months: v }))}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">3 months</SelectItem>
                    <SelectItem value="6">6 months</SelectItem>
                    <SelectItem value="12">12 months</SelectItem>
                    <SelectItem value="24">24 months</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold text-[#172B4D]">Customer (optional)</Label>
              <Select value={gcForm.customerId || "none"} onValueChange={(v) => setGcForm((f) => ({ ...f, customerId: v === "none" ? "" : v }))}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned — open card</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name} • {c.phone}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold text-[#172B4D]">Card gradient</Label>
              <div className="flex flex-wrap gap-2">
                {GRADIENTS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGcForm((f) => ({ ...f, gradient: g }))}
                    aria-label={g}
                    className={cn(
                      "h-9 w-14 rounded-lg border-2 transition",
                      GC_CLASS[g],
                      gcForm.gradient === g ? "border-[#172B4D] shadow-md" : "border-transparent"
                    )}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGcOpen(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={() => void submitGiftCard()} disabled={gcBusy} className="rounded-xl bg-[#0052CC] font-semibold hover:bg-[#0041A8]">
              {gcBusy && <Loader2 className="h-4 w-4 animate-spin" />} Issue card
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
