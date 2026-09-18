"use client";

import { type ChangeEvent, type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList, FileText, Gift, LayoutTemplate, Maximize2, MessageCircle, Printer, Receipt,
  RotateCcw, ShieldCheck, Smartphone, Upload, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { KES, SaleDto, SaleItemDto } from "@/types";
import { KpiCard, Panel, ScreenHeader } from "@/components/df/shared";
import { DukaMark } from "@/components/df/logo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

/* ── contracts & constants ────────────────────────────────── */

type TemplateId = "thermal" | "a4" | "giftcard" | "quotation";

interface BrandToggles {
  tier: boolean;
  loyalty: boolean;
  kraQr: boolean;
  barcode: boolean;
  signature: boolean;
}

interface BrandConfig {
  logo: string | null;
  primary: string;
  accent: string;
  kraPin: string;
  branch: string;
  till: string;
  promo: string;
  toggles: BrandToggles;
}

const DEFAULTS = {
  primary: "#0052CC",
  accent: "#00C853",
  kraPin: "P051234567X",
  branch: "Thika Road",
  till: "Till 123456",
  promo: "Asante! You saved {saved} today - karibu tena",
};

const DEFAULT_TOGGLES: BrandToggles = { tier: true, loyalty: true, kraQr: true, barcode: true, signature: true };

/* Sample hardware lines - used for the Walk-in pseudo sale and as a
   fallback when a sale DTO arrives without items. */
const SAMPLE_ITEMS: SaleItemDto[] = [
  { id: 901, productId: 11, name: "BOMA Cement 32.5N 50kg", emoji: "🧱", qty: 4, unitPrice: 780, discount: 0, total: 3120 },
  { id: 902, productId: 12, name: "Wire Nails 2kg", emoji: "🔨", qty: 2, unitPrice: 355, discount: 60, total: 650 },
  { id: 903, productId: 13, name: "Steel Tape Measure 5m", emoji: "📏", qty: 1, unitPrice: 430, discount: 0, total: 430 },
  { id: 904, productId: 14, name: "Paint Brush 4in", emoji: "🖌️", qty: 3, unitPrice: 150, discount: 0, total: 450 },
];
const WALKIN_SUBTOTAL = SAMPLE_ITEMS.reduce((s, i) => s + i.total, 0); // 4650
const WALKIN_DISCOUNT = 350;
const WALKIN_VAT = Math.round((WALKIN_SUBTOTAL - WALKIN_DISCOUNT) * 0.16); // 688

const WALKIN_SALE: SaleDto = {
  id: -1,
  receiptNo: "INV-2026-001",
  storeId: 1,
  storeName: "DukaFlow Thika Road",
  customerId: null,
  customerName: "Walk-in Customer",
  customerTier: null,
  staffName: "Grace Wanjiru",
  subtotal: WALKIN_SUBTOTAL,
  discount: WALKIN_DISCOUNT,
  vat: WALKIN_VAT,
  total: WALKIN_SUBTOTAL - WALKIN_DISCOUNT + WALKIN_VAT,
  paymentMethod: "M-Pesa",
  pointsEarned: 49,
  pointsRedeemed: 0,
  tierAtSale: null,
  promoCode: null,
  status: "Completed",
  kraStatus: "Verified",
  cuInvoiceNumber: "KE0214829-2716-0038217",
  qrCodeBase64: null,
  offlineCreated: false,
  createdAt: new Date().toISOString(),
  items: SAMPLE_ITEMS,
};

const TEMPLATES: { id: TemplateId; label: string; sub: string; icon: ReactNode }[] = [
  { id: "thermal", label: "80mm Thermal", sub: "Till roll", icon: <Receipt size={16} /> },
  { id: "a4", label: "A4 Invoice", sub: "Tax invoice", icon: <FileText size={16} /> },
  { id: "giftcard", label: "Gift Card", sub: "Card + labels", icon: <Gift size={16} /> },
  { id: "quotation", label: "Quotation", sub: "Estimate doc", icon: <ClipboardList size={16} /> },
];

const TOGGLE_ITEMS: { key: keyof BrandToggles; label: string; hint: string }[] = [
  { key: "tier", label: "Tier badge", hint: "Gold / Silver / Bronze star beside the customer" },
  { key: "loyalty", label: "Loyalty line", hint: "Points earned summary under totals" },
  { key: "kraQr", label: "KRA QR", hint: "eTIMS verification QR + CU invoice number" },
  { key: "barcode", label: "Barcode", hint: "Scannable receipt barcode strip" },
  { key: "signature", label: "Signature line", hint: "Cashier / customer sign-off" },
];

const TIER_STYLE: Record<string, { bg: string; fg: string; border: string }> = {
  Gold: { bg: "#FFF8E1", fg: "#B8860B", border: "#FFD54F" },
  Silver: { bg: "#ECEFF1", fg: "#546E7A", border: "#B0BEC5" },
  Bronze: { bg: "#EFEBE9", fg: "#8D6E63", border: "#BCAAA4" },
};

/* ── helpers ──────────────────────────────────────────────── */

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

const num = (n: number) => Math.round(n).toLocaleString("en-KE");

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const hexParts = (hex: string): [number, number, number] => {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h || "000000", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const hexToRgba = (hex: string, alpha: number) => {
  const [r, g, b] = hexParts(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const darken = (hex: string, amount: number) => {
  const [r, g, b] = hexParts(hex);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 - amount))));
  return `#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

/** Replaces the {saved} variable with the sale's actual discount. */
const promoLine = (text: string, discount: number) => {
  const saved = discount > 0 ? `KES ${Math.round(discount).toLocaleString("en-KE")}` : "KES 0";
  return text.split("{saved}").join(saved);
};

/* Deterministic pseudo-random barcode bar widths (1-4px) from a seed string. */
const barcodeBars = (seed: string, count = 38) =>
  Array.from({ length: count }, (_, i) => {
    const c = seed.length ? seed.charCodeAt(i % seed.length) : 65;
    return 1 + ((c * (i + 7)) % 4);
  });

/* Zigzag clip-path for the thermal roll tear edge (teeth pointing up). */
const TEAR_CLIP = (() => {
  const teeth = 20;
  const step = 100 / teeth;
  const pts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    pts.push(`${(i * step).toFixed(2)}% 100%`);
    pts.push(`${(i * step + step / 2).toFixed(2)}% 0%`);
  }
  pts.push("100% 100%");
  return `polygon(${pts.join(", ")})`;
})();

/* ── small building blocks ────────────────────────────────── */

/** Dashed perforation rule used inside the thermal paper. */
function TearRule() {
  return <div aria-hidden style={{ borderTop: "1px dashed #C9CFDA", margin: "9px 0" }} />;
}

/** Scales a fixed-size canvas (e.g. 794×1123 A4) down to fit its container. */
function ScaledBox({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div ref={outer} className="overflow-hidden" style={{ height: height * scale }}>
      <div style={{ width: width * scale, height: height * scale, margin: "0 auto" }}>
        <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}>{children}</div>
      </div>
    </div>
  );
}

/** Brand logo: uploaded image when present, else the DukaFlow "D" mark. */
function BrandLogo({ brand, size = 32 }: { brand: BrandConfig; size?: number }) {
  if (brand.logo) {
    return <img src={brand.logo} alt="Store logo" style={{ height: size, maxWidth: size * 2.4, objectFit: "contain" }} />;
  }
  return (
    <div style={{ width: size, height: size }}>
      <DukaMark color={brand.primary} accent={brand.accent} />
    </div>
  );
}

/** Hex color field: swatch (native color input) + hex text box. */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [syncedFrom, setSyncedFrom] = useState(value);
  if (syncedFrom !== value) {
    // external value changed (color picker or studio reset) → resync the draft
    setSyncedFrom(value);
    setDraft(value);
  }
  return (
    <div>
      <Label className="text-[11px] font-medium text-[#6B778C]">{label}</Label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-9 cursor-pointer rounded-lg border border-[#DFE1E6] bg-white p-1"
        />
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            const v = e.target.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase());
          }}
          className="h-9 font-mono text-[12px] uppercase"
          aria-label={`${label} hex value`}
        />
      </div>
    </div>
  );
}

/** Shared QR renderer: real eTIMS QR when the sale has one, else a bordered box. */
function QrBlock({ sale, size, brand }: { sale: SaleDto; size: number; brand: BrandConfig }) {
  if (sale.qrCodeBase64) {
    return <img src={sale.qrCodeBase64} alt="KRA eTIMS verification QR" style={{ width: size, height: size }} />;
  }
  return (
    <div
      aria-label="QR placeholder"
      style={{
        width: size,
        height: size,
        border: `1.5px solid ${brand.primary}`,
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.22,
        fontWeight: 800,
        letterSpacing: "0.2em",
        color: "#172B4D",
        background: "#FFFFFF",
      }}
    >
      QR
    </div>
  );
}

/* ── 80mm thermal preview ─────────────────────────────────── */

function ThermalPreview({ sale, brand }: { sale: SaleDto; brand: BrandConfig }) {
  const t = brand.toggles;
  const items = sale.items?.length ? sale.items : SAMPLE_ITEMS;
  const tier = sale.customerTier ?? sale.tierAtSale ?? null;
  const tierStyle = (tier && TIER_STYLE[tier]) || { bg: "#F4F5F7", fg: "#6B778C", border: "#DFE1E6" };
  const bars = barcodeBars(sale.receiptNo, 40);
  const verified = (sale.kraStatus ?? "").toLowerCase() === "verified";

  return (
    <div className="mx-auto w-[302px] font-mono" style={{ filter: "drop-shadow(0 10px 18px rgba(23,43,77,0.14))" }}>
      {/* perforated tear edge (top) */}
      <div aria-hidden style={{ height: 10, background: "#FFFFFF", clipPath: TEAR_CLIP }} />
      {/* paper body with subtle thermal texture */}
      <div
        style={{
          background: "#FFFFFF",
          padding: "12px 16px 16px",
          color: "#172B4D",
          backgroundImage: "repeating-linear-gradient(0deg, rgba(23,43,77,0.03) 0px, rgba(23,43,77,0.03) 1px, transparent 1px, transparent 4px)",
          boxShadow: "inset 0 0 24px rgba(23,43,77,0.07)",
        }}
      >
        {/* header */}
        <div className="flex flex-col items-center text-center">
          <BrandLogo brand={brand} size={brand.logo ? 32 : 28} />
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.3em", marginTop: 4 }}>DUKAFLOW</div>
          <div style={{ fontSize: 10, color: "#6B778C" }}>Dukaflow Retail Ltd</div>
          <div style={{ fontSize: 10, color: "#6B778C" }}>{brand.branch} • Tel +254 700 123 456</div>
          <div style={{ fontSize: 10, color: "#6B778C" }}>KRA PIN: {brand.kraPin}</div>
        </div>

        <TearRule />

        {/* meta */}
        <div className="flex justify-between" style={{ fontSize: 10.5 }}>
          <span style={{ fontWeight: 700 }}>{sale.receiptNo}</span>
          <span style={{ color: "#6B778C" }}>{fmtDateTime(sale.createdAt)}</span>
        </div>
        <div className="flex justify-between" style={{ fontSize: 10.5 }}>
          <span style={{ color: "#6B778C" }}>Cashier: {sale.staffName}</span>
          <span style={{ color: "#6B778C" }}>{brand.till}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" style={{ fontSize: 10.5, marginTop: 3 }}>
          <span>Cust: {sale.customerName ?? "Walk-in"}</span>
          {t.tier && (
            <span
              style={{
                background: tierStyle.bg,
                color: tierStyle.fg,
                border: `1px solid ${tierStyle.border}`,
                borderRadius: 4,
                fontSize: 8.5,
                fontWeight: 700,
                letterSpacing: "0.08em",
                padding: "1px 5px",
                whiteSpace: "nowrap",
              }}
            >
              {tier ? `★ ${tier.toUpperCase()}` : "WALK-IN"}
            </span>
          )}
        </div>

        <TearRule />

        {/* items */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((it) => (
            <div key={it.id}>
              <div className="flex justify-between" style={{ fontSize: 10.5 }}>
                <span style={{ fontWeight: 600 }}>
                  {it.qty} x {num(it.unitPrice)}
                </span>
                <span style={{ fontWeight: 600 }}>{num(it.total)}</span>
              </div>
              <div style={{ fontSize: 10, color: "#6B778C" }}>
                {it.name}
                {it.discount > 0 ? ` (disc ${num(it.discount)})` : ""}
              </div>
            </div>
          ))}
        </div>

        <TearRule />

        {/* totals */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10.5 }}>
          <div className="flex justify-between">
            <span style={{ color: "#6B778C" }}>Subtotal</span>
            <span>{num(sale.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "#6B778C" }}>Discount</span>
            <span>-{num(sale.discount)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "#6B778C" }}>VAT 16%</span>
            <span>{num(sale.vat)}</span>
          </div>
        </div>
        <div style={{ borderTop: "2px solid #172B4D", margin: "8px 0 6px" }} />
        <div className="flex justify-between" style={{ fontSize: 16, fontWeight: 700 }}>
          <span>TOTAL KES</span>
          <span>{num(sale.total)}</span>
        </div>
        <div className="flex justify-between" style={{ fontSize: 10.5, marginTop: 5 }}>
          <span style={{ color: "#6B778C" }}>Payment</span>
          <span style={{ fontWeight: 700 }}>{sale.paymentMethod}</span>
        </div>

        {/* loyalty */}
        {t.loyalty && (
          <div
            style={{
              marginTop: 8,
              fontSize: 10,
              color: "#1B7A2E",
              background: hexToRgba(brand.accent, 0.14),
              borderRadius: 4,
              padding: "4px 6px",
              textAlign: "center",
            }}
          >
            ★ Loyalty: +{sale.pointsEarned} pts earned{tier ? ` · ${tier} member` : ""}
          </div>
        )}

        {/* KRA eTIMS */}
        {t.kraQr && (
          <div style={{ marginTop: 10, textAlign: "center" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: verified ? "#1B7A2E" : "#B8860B" }}>
              KRA eTIMS {(sale.kraStatus ?? "PENDING").toUpperCase()}
            </div>
            <div style={{ fontSize: 9.5, color: "#6B778C" }}>CU No: {sale.cuInvoiceNumber ?? "-"}</div>
            <div className="flex justify-center" style={{ marginTop: 8 }}>
              <QrBlock sale={sale} size={sale.qrCodeBase64 ? 84 : 56} brand={brand} />
            </div>
          </div>
        )}

        {/* barcode */}
        {t.barcode && (
          <div style={{ marginTop: 12, textAlign: "center" }}>
            <div className="mx-auto flex items-end justify-center" style={{ width: 200, height: 34, gap: 1.5 }}>
              {bars.map((w, i) => (
                <div key={i} style={{ width: w, height: i % 9 === 0 ? 34 : 29, background: "#111827" }} />
              ))}
            </div>
            <div style={{ fontSize: 9, letterSpacing: "0.35em", color: "#6B778C", marginTop: 3 }}>{sale.receiptNo}</div>
          </div>
        )}

        {/* promo footer */}
        {brand.promo.trim() && (
          <div style={{ borderTop: "1px dashed #C9CFDA", marginTop: 12, paddingTop: 8, fontSize: 10, fontStyle: "italic", textAlign: "center" }}>
            {promoLine(brand.promo, sale.discount)}
          </div>
        )}

        {/* signature */}
        {t.signature && (
          <div className="flex items-end justify-between" style={{ marginTop: 14, fontSize: 10, color: "#6B778C" }}>
            <span>Served by: {sale.staffName}</span>
            <span style={{ borderTop: "1px dotted #6B778C", minWidth: 88, textAlign: "center" }}>Signature</span>
          </div>
        )}

        <div style={{ marginTop: 12, textAlign: "center", fontSize: 9, color: "#6B778C" }}>
          Powered by DukaFlow • Karibu tena!
        </div>
      </div>
      {/* perforated tear edge (bottom) */}
      <div aria-hidden style={{ height: 10, background: "#FFFFFF", clipPath: TEAR_CLIP, transform: "scaleY(-1)" }} />
    </div>
  );
}

/* ── A4 invoice / quotation sheet ─────────────────────────── */

function A4Sheet({ sale, brand, mode }: { sale: SaleDto; brand: BrandConfig; mode: "invoice" | "quotation" }) {
  const t = brand.toggles;
  const isQuote = mode === "quotation";
  const items = (sale.items?.length ? sale.items : SAMPLE_ITEMS).slice(0, 13);
  const docNo = isQuote ? sale.receiptNo.replace(/^INV/i, "QT") : sale.receiptNo;
  const totalDiscount = items.reduce((s, i) => s + (i.discount ?? 0), 0);

  const thStyle: CSSProperties = { padding: "8px 10px", fontSize: 10, letterSpacing: "0.08em", fontWeight: 700 };
  const tdStyle: CSSProperties = { padding: "7px 10px" };

  return (
    <div style={{ width: 794, height: 1123, background: "#FFFFFF", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 14px 34px rgba(23,43,77,0.16)" }}>
      {/* header band */}
      <div
        style={{
          background: `linear-gradient(120deg, ${brand.primary}, ${darken(brand.primary, 0.3)})`,
          color: "#FFFFFF",
          padding: "24px 36px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "rgba(255,255,255,0.16)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {brand.logo ? (
              <img src={brand.logo} alt="Store logo" style={{ maxHeight: 40, maxWidth: 44, objectFit: "contain" }} />
            ) : (
              <div style={{ width: 30, height: 30 }}>
                <DukaMark white />
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "0.02em" }}>DUKAFLOW RETAIL LTD</div>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
              {brand.branch}, Nairobi • Tel +254 700 123 456 • KRA PIN {brand.kraPin}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "0.06em" }}>{isQuote ? "QUOTATION" : "TAX INVOICE"}</div>
          <div style={{ fontSize: 12, opacity: 0.92, marginTop: 2 }}>{docNo}</div>
          {isQuote && <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>Valid for 14 days</div>}
        </div>
      </div>

      {/* body */}
      <div style={{ flex: 1, padding: "22px 36px 18px", display: "flex", flexDirection: "column", color: "#172B4D" }}>
        {/* meta row */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", color: "#6B778C", marginBottom: 6 }}>
              {isQuote ? "QUOTE FOR" : "BILL TO"}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{sale.customerName ?? "Walk-in Customer"}</div>
            <div style={{ fontSize: 11, color: "#6B778C", marginTop: 2 }}>{brand.branch} branch • {brand.till}</div>
            <div style={{ fontSize: 11, color: "#6B778C" }}>KRA PIN: {brand.kraPin}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 11 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", color: "#6B778C", marginBottom: 6 }}>DETAILS</div>
            <div style={{ color: "#6B778C" }}>Date: <span style={{ color: "#172B4D", fontWeight: 600 }}>{fmtDate(sale.createdAt)}</span></div>
            <div style={{ color: "#6B778C" }}>{isQuote ? "Quote" : "Invoice"} No: <span style={{ color: "#172B4D", fontWeight: 600 }}>{docNo}</span></div>
            {!isQuote && (
              <div style={{ color: "#6B778C" }}>Payment: <span style={{ color: "#172B4D", fontWeight: 600 }}>{sale.paymentMethod}</span></div>
            )}
            {isQuote && (
              <div style={{ marginTop: 4 }}>
                <span style={{ display: "inline-block", background: "#FFF8E1", color: "#B8860B", border: "1px solid #FFD54F", borderRadius: 999, padding: "2px 10px", fontSize: 10, fontWeight: 700 }}>
                  Valid for 14 days
                </span>
              </div>
            )}
          </div>
        </div>

        {/* items table */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ background: brand.primary, color: "#FFFFFF" }}>
              <th style={{ ...thStyle, width: 30, textAlign: "center" }}>#</th>
              <th style={{ ...thStyle, textAlign: "left" }}>ITEM</th>
              <th style={{ ...thStyle, width: 50, textAlign: "center" }}>QTY</th>
              <th style={{ ...thStyle, width: 90, textAlign: "right" }}>UNIT PRICE</th>
              {isQuote && <th style={{ ...thStyle, width: 80, textAlign: "right" }}>DISCOUNT</th>}
              <th style={{ ...thStyle, width: 110, textAlign: "right" }}>AMOUNT (KES)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id} style={{ background: i % 2 === 1 ? hexToRgba(brand.accent, 0.07) : "transparent", borderBottom: "1px solid #DFE1E6" }}>
                <td style={{ ...tdStyle, textAlign: "center", color: "#6B778C" }}>{i + 1}</td>
                <td style={tdStyle}>
                  {it.emoji} {it.name}
                </td>
                <td style={{ ...tdStyle, textAlign: "center" }}>{it.qty}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{num(it.unitPrice)}</td>
                {isQuote && <td style={{ ...tdStyle, textAlign: "right", color: it.discount > 0 ? "#B8860B" : "#6B778C" }}>{it.discount > 0 ? num(it.discount) : "-"}</td>}
                <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>{num(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* totals */}
        <div style={{ marginTop: 16, marginLeft: "auto", width: 300, fontSize: 11.5 }}>
          <div className="flex justify-between" style={{ padding: "3px 0" }}>
            <span style={{ color: "#6B778C" }}>Subtotal</span>
            <span style={{ fontWeight: 600 }}>{num(sale.subtotal)}</span>
          </div>
          <div className="flex justify-between" style={{ padding: "3px 0" }}>
            <span style={{ color: "#6B778C" }}>Discount</span>
            <span style={{ fontWeight: 600 }}>-{num(sale.discount)}</span>
          </div>
          <div className="flex justify-between" style={{ padding: "3px 0" }}>
            <span style={{ color: "#6B778C" }}>VAT (16%)</span>
            <span style={{ fontWeight: 600 }}>{num(sale.vat)}</span>
          </div>
          <div style={{ borderTop: "2px solid #172B4D", marginTop: 4 }} />
          <div
            className="flex justify-between"
            style={{ background: hexToRgba(brand.accent, 0.12), borderRadius: 8, padding: "10px 12px", marginTop: 6, fontWeight: 800, fontSize: 14 }}
          >
            <span>GRAND TOTAL</span>
            <span>KES {num(sale.total)}</span>
          </div>
        </div>

        {/* payment / terms box */}
        <div
          style={{
            marginTop: 16,
            marginLeft: "auto",
            width: 300,
            border: "1px solid #DFE1E6",
            borderRadius: 10,
            padding: "10px 12px",
            background: "#FAFBFC",
            fontSize: 11,
            color: "#172B4D",
          }}
        >
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.12em", color: "#6B778C", marginBottom: 4 }}>
            {isQuote ? "TERMS" : "PAYMENT DETAILS"}
          </div>
          {isQuote ? (
            <>
              <div>• Quotation valid for 14 days from issue date</div>
              <div>• Prices in KES, inclusive of 16% VAT</div>
              <div>• Delivery: 2-3 working days within Nairobi</div>
            </>
          ) : (
            <>
              <div>Bank: Equity Bank - A/C 1234567</div>
              <div>M-Pesa Till: {brand.till}</div>
              <div>Paid via: {sale.paymentMethod}</div>
            </>
          )}
        </div>

        {/* QR footer block */}
        {t.kraQr && (
          <div style={{ marginTop: "auto", display: "flex", alignItems: "flex-end", gap: 12 }}>
            <QrBlock sale={sale} size={76} brand={brand} />
            <div style={{ fontSize: 10, color: "#6B778C", paddingBottom: 2 }}>
              <div style={{ fontWeight: 700, color: "#172B4D" }}>Scan to verify with KRA eTIMS</div>
              <div>CU Invoice No: {sale.cuInvoiceNumber ?? "-"}</div>
              <div>Status: {sale.kraStatus}{!isQuote && totalDiscount > 0 ? ` • Line discounts applied: KES ${num(totalDiscount)}` : ""}</div>
            </div>
          </div>
        )}
      </div>

      {/* approve & convert band (quotation only) */}
      {isQuote && (
        <div style={{ background: brand.primary, color: "#FFFFFF", padding: "13px 36px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ fontSize: 12 }}>Happy with the figures? Approve to convert this quotation into a tax invoice.</div>
          <div style={{ background: brand.accent, color: "#FFFFFF", fontWeight: 700, fontSize: 12, padding: "8px 16px", borderRadius: 8, whiteSpace: "nowrap" }}>
            Approve &amp; Convert →
          </div>
        </div>
      )}

      {/* sheet footer */}
      <div style={{ borderTop: "1px solid #DFE1E6", padding: "11px 36px", display: "flex", justifyContent: "space-between", gap: 12, fontSize: 10, color: "#6B778C", background: "#FAFBFC" }}>
        <span>KRA PIN: {brand.kraPin} • Branch: {brand.branch} • {brand.till}</span>
        <span>This is an electronic invoice generated by DukaFlow eTIMS</span>
      </div>
    </div>
  );
}

/* ── gift card + label sheet preview ──────────────────────── */

function GiftCardPreview({ brand }: { brand: BrandConfig }) {
  const bars = barcodeBars("GC-4821-DUKAFLOW", 30);
  const labelBars = barcodeBars("DUKAFLOW-LABEL", 14);
  return (
    <div className="flex flex-col items-center gap-6">
      {/* card front */}
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{ width: 380, height: 220, background: `linear-gradient(135deg, ${brand.primary} 0%, ${darken(brand.primary, 0.38)} 100%)`, boxShadow: "0 16px 32px rgba(23,43,77,0.25)", color: "#FFFFFF" }}
      >
        <div aria-hidden style={{ position: "absolute", right: -34, top: -46, width: 150, height: 150, borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.18)" }} />
        <div aria-hidden style={{ position: "absolute", right: 40, bottom: -58, width: 120, height: 120, borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.12)" }} />
        <div style={{ position: "relative", height: "100%", padding: 18, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div className="flex items-start justify-between">
            <div className="flex items-center" style={{ gap: 8 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.92)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                {brand.logo ? (
                  <img src={brand.logo} alt="Store logo" style={{ maxHeight: 26, maxWidth: 30, objectFit: "contain" }} />
                ) : (
                  <div style={{ width: 20, height: 20 }}>
                    <DukaMark color={brand.primary} accent={brand.accent} />
                  </div>
                )}
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.18em" }}>DUKAFLOW</div>
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.3em", opacity: 0.9 }}>GIFT CARD</div>
          </div>
          <div>
            <div style={{ display: "inline-block", background: "#FFFFFF", color: brand.primary, borderRadius: 999, padding: "4px 14px", fontSize: 15, fontWeight: 800 }}>
              KES 5,000
            </div>
            <div style={{ marginTop: 10, fontFamily: "ui-monospace, monospace", fontSize: 15, letterSpacing: "0.14em" }}>GC-•••• •••• 4821</div>
          </div>
          <div className="flex items-end justify-between">
            <div style={{ background: "#FFFFFF", borderRadius: 6, padding: "5px 8px" }}>
              <div className="flex items-end" style={{ gap: 1.5, height: 22 }}>
                {bars.map((w, i) => (
                  <div key={i} style={{ width: w, height: "100%", background: "#111827" }} />
                ))}
              </div>
            </div>
            <div style={{ fontSize: 9, opacity: 0.85, textAlign: "right", lineHeight: 1.5 }}>
              Valid 12 months
              <br />
              Redeem in-store &amp; online
            </div>
          </div>
        </div>
      </div>

      {/* label sheet */}
      <div className="w-full max-w-[520px] rounded-2xl border border-[#DFE1E6] bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B778C]">Shelf labels - 3 × 8 sheet</div>
          <Badge variant="outline" className="text-[10px]">24 labels</Badge>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 24 }).map((_, i) => {
            const accentOn = i % 4 === 3;
            return (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded-md px-1.5"
                style={{
                  height: 50,
                  border: `1px dotted ${accentOn ? brand.accent : "#C9CFDA"}`,
                  background: accentOn ? hexToRgba(brand.accent, 0.1) : "#FFFFFF",
                }}
              >
                <div style={{ width: 13, height: 13, flexShrink: 0 }}>
                  <DukaMark color={accentOn ? darken(brand.accent, 0.2) : brand.primary} accent={accentOn ? brand.accent : "#00C853"} />
                </div>
                <div className="min-w-0">
                  <div style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: "0.14em", color: "#172B4D" }}>DUKAFLOW</div>
                  <div className="flex items-end" style={{ gap: 1, height: 9, marginTop: 2 }}>
                    {labelBars.map((w, j) => (
                      <div key={j} style={{ width: w, height: "100%", background: accentOn ? darken(brand.accent, 0.15) : "#172B4D" }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 6.5, color: "#6B778C", marginTop: 1 }}>GC-{String(4821 + i).slice(-4)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── shared canvas router ─────────────────────────────────── */

function PreviewCanvas({ template, sale, brand }: { template: TemplateId; sale: SaleDto; brand: BrandConfig }) {
  if (template === "thermal") return <ThermalPreview sale={sale} brand={brand} />;
  if (template === "a4")
    return (
      <ScaledBox width={794} height={1123}>
        <A4Sheet sale={sale} brand={brand} mode="invoice" />
      </ScaledBox>
    );
  if (template === "quotation")
    return (
      <ScaledBox width={794} height={1123}>
        <A4Sheet sale={sale} brand={brand} mode="quotation" />
      </ScaledBox>
    );
  return <GiftCardPreview brand={brand} />;
}

/* ── screen ───────────────────────────────────────────────── */

export default function ReceiptsScreen() {
  /* studio state */
  const [template, setTemplate] = useState<TemplateId>("thermal");
  const [logo, setLogo] = useState<string | null>(null);
  const [primary, setPrimary] = useState(DEFAULTS.primary);
  const [accent, setAccent] = useState(DEFAULTS.accent);
  const [kraPin, setKraPin] = useState(DEFAULTS.kraPin);
  const [branch, setBranch] = useState(DEFAULTS.branch);
  const [till, setTill] = useState(DEFAULTS.till);
  const [promo, setPromo] = useState(DEFAULTS.promo);
  const [toggles, setToggles] = useState<BrandToggles>(DEFAULT_TOGGLES);

  /* sample data */
  const [sales, setSales] = useState<SaleDto[] | null>(null);
  const [sampleKey, setSampleKey] = useState<string | null>(null);
  const [fullOpen, setFullOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<SaleDto[]>("/api/sales?limit=8")
      .then((s) => {
        if (!alive) return;
        setSales(s);
        setSampleKey((cur) => cur ?? (s[0] ? String(s[0].id) : "walkin"));
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setSales([]);
        setSampleKey((cur) => cur ?? "walkin");
        toast({ title: "Could not load recent sales", description: err(e), variant: "destructive" });
      });
    return () => {
      alive = false;
    };
  }, []);

  const brand: BrandConfig = useMemo(
    () => ({ logo, primary, accent, kraPin, branch, till, promo, toggles }),
    [logo, primary, accent, kraPin, branch, till, promo, toggles]
  );

  const selected = useMemo<SaleDto>(() => {
    if (sampleKey === "walkin") return WALKIN_SALE;
    const found = sales?.find((s) => String(s.id) === sampleKey);
    return found ?? sales?.[0] ?? WALKIN_SALE;
  }, [sampleKey, sales]);

  const items = selected.items?.length ? selected.items : SAMPLE_ITEMS;

  /* KPI figures */
  const verifiedCount = sales?.filter((s) => (s.kraStatus ?? "").toLowerCase() === "verified").length ?? 0;
  const verifiedPct = sales && sales.length > 0 ? Math.round((verifiedCount / sales.length) * 100) : 0;
  const lastExport = sales?.[0] ?? null;

  /* sharing */
  const shareText = useMemo(
    () =>
      [
        `DukaFlow Receipt ${selected.receiptNo}`,
        `Customer: ${selected.customerName ?? "Walk-in"}`,
        `Total: ${KES(selected.total)} (VAT incl.)`,
        `Items: ${items.length}`,
        `Paid via: ${selected.paymentMethod}`,
        `KRA eTIMS: ${selected.kraStatus}`,
        promoLine(brand.promo, selected.discount),
      ].join("\n"),
    [selected, items.length, brand.promo]
  );
  const openWhatsApp = () => window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank", "noopener");
  const smsHref = `sms:?body=${encodeURIComponent(shareText)}`;

  /* logo upload */
  const onLogoFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Unsupported file", description: "Please choose a PNG or JPG image.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setLogo(reader.result);
        toast({ title: "Logo added", description: "It now appears across every live preview." });
      }
    };
    reader.readAsDataURL(file);
  };

  const resetStudio = () => {
    setLogo(null);
    setPrimary(DEFAULTS.primary);
    setAccent(DEFAULTS.accent);
    setKraPin(DEFAULTS.kraPin);
    setBranch(DEFAULTS.branch);
    setTill(DEFAULTS.till);
    setPromo(DEFAULTS.promo);
    setToggles(DEFAULT_TOGGLES);
    toast({ title: "Studio reset", description: "All templates are back to DukaFlow defaults." });
  };

  const toggle = (key: keyof BrandToggles, checked: boolean) => setToggles((t) => ({ ...t, [key]: checked }));

  return (
    <div>
      <ScreenHeader
        title="Receipt Studio"
        subtitle="Design receipts, invoices, gift cards and quotations - live previews update as you type."
        actions={
          <Button variant="outline" size="sm" onClick={resetStudio}>
            <RotateCcw size={14} /> Reset studio
          </Button>
        }
      />

      {/* KPI strip */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard icon={<LayoutTemplate size={17} />} label="Templates available" value="4" sub="80mm · A4 · Gift card · Quotation" />
        <KpiCard
          icon={<Printer size={17} />}
          label="Last exported"
          loading={!sales}
          value={lastExport ? lastExport.receiptNo : "-"}
          sub={lastExport ? `Printed ${fmtDate(lastExport.createdAt)}` : "Awaiting first export"}
        />
        <KpiCard
          icon={<ShieldCheck size={17} />}
          label="eTIMS verified"
          loading={!sales}
          value={`${verifiedPct}%`}
          sub={`${verifiedCount} of ${sales?.length ?? 0} recent receipts stamped`}
        />
      </div>

      {/* split view: editor (40%) + previews (60%) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-6">
        {/* ── editor controls ── */}
        <div className="df-scroll lg:sticky lg:top-2 lg:col-span-2 lg:max-h-[calc(100vh-2.5rem)] lg:space-y-4 lg:overflow-y-auto lg:pr-1">
          {/* template selector */}
          <Panel className="p-4">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6B778C]">Template</div>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map((tp) => (
                <button
                  key={tp.id}
                  type="button"
                  onClick={() => setTemplate(tp.id)}
                  aria-pressed={template === tp.id}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all",
                    template === tp.id
                      ? "border-[#0052CC] bg-[#0052CC]/5 ring-1 ring-[#0052CC]"
                      : "border-[#DFE1E6] bg-white hover:border-[#C9CFDA] hover:bg-[#FAFBFC]"
                  )}
                >
                  <span className={cn("flex items-center gap-2 text-[13px] font-semibold", template === tp.id ? "text-[#0052CC]" : "text-[#172B4D]")}>
                    {tp.icon}
                    {tp.label}
                  </span>
                  <span className="text-[11px] text-[#6B778C]">{tp.sub}</span>
                </button>
              ))}
            </div>
          </Panel>

          {/* branding */}
          <Panel className="p-4">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6B778C]">Branding</div>
            <div className="flex items-center gap-3">
              {logo ? (
                <div className="flex items-center gap-2 rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-2">
                  <img src={logo} alt="Uploaded logo preview" className="h-9 w-auto max-w-[80px] rounded object-contain" />
                  <button
                    type="button"
                    onClick={() => setLogo(null)}
                    aria-label="Remove logo"
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FFEBEE] text-[#FF5630] transition hover:bg-[#FFCDD2]"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-dashed border-[#DFE1E6] bg-[#FAFBFC] px-3 py-2">
                  <div className="h-6 w-6">
                    <DukaMark color={primary} accent={accent} />
                  </div>
                  <span className="text-[11px] font-bold tracking-[0.22em] text-[#172B4D]">DUKAFLOW</span>
                </div>
              )}
              <div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onLogoFile} />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload size={13} /> Upload logo
                </Button>
                <p className="mt-1 text-[10px] text-[#6B778C]">PNG/JPG - shown on all four templates</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <ColorField label="Primary color" value={primary} onChange={setPrimary} />
              <ColorField label="Accent color" value={accent} onChange={setAccent} />
            </div>
          </Panel>

          {/* receipt details */}
          <Panel className="p-4">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6B778C]">Receipt details</div>
            <div className="space-y-3">
              <div>
                <Label htmlFor="studio-kra" className="text-[11px] font-medium text-[#6B778C]">KRA PIN</Label>
                <Input id="studio-kra" value={kraPin} onChange={(e) => setKraPin(e.target.value)} className="mt-1.5 h-9 font-mono text-[12px]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="studio-branch" className="text-[11px] font-medium text-[#6B778C]">Branch</Label>
                  <Input id="studio-branch" value={branch} onChange={(e) => setBranch(e.target.value)} className="mt-1.5 h-9 text-[12px]" />
                </div>
                <div>
                  <Label htmlFor="studio-till" className="text-[11px] font-medium text-[#6B778C]">Till number</Label>
                  <Input id="studio-till" value={till} onChange={(e) => setTill(e.target.value)} className="mt-1.5 h-9 text-[12px]" />
                </div>
              </div>
            </div>
          </Panel>

          {/* promo footer */}
          <Panel className="p-4">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6B778C]">Footer promo</div>
            <Label htmlFor="studio-promo" className="text-[11px] font-medium text-[#6B778C]">Promo message</Label>
            <Input id="studio-promo" value={promo} onChange={(e) => setPromo(e.target.value)} className="mt-1.5 h-9 text-[12px]" placeholder="e.g. Asante! You saved {saved} today" />
            <p className="mt-1.5 text-[10px] text-[#6B778C]">
              Available variable: <code className="rounded bg-[#F4F5F7] px-1 py-0.5 font-mono text-[10px] text-[#0052CC]">{"{saved}"}</code> - replaced with the actual discount (or “KES 0”).
            </p>
          </Panel>

          {/* elements */}
          <Panel className="p-4">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#6B778C]">Receipt elements</div>
            <div>
              {TOGGLE_ITEMS.map((it, idx) => (
                <div key={it.key} className={cn("flex items-center justify-between gap-3 py-2.5", idx < TOGGLE_ITEMS.length - 1 && "border-b border-[#F4F5F7]")}>
                  <div>
                    <div className="text-[12.5px] font-medium text-[#172B4D]">{it.label}</div>
                    <div className="text-[10.5px] text-[#6B778C]">{it.hint}</div>
                  </div>
                  <Switch checked={toggles[it.key]} onCheckedChange={(v) => toggle(it.key, v)} aria-label={`Toggle ${it.label}`} />
                </div>
              ))}
            </div>
          </Panel>

          {/* sample data */}
          <Panel className="p-4">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6B778C]">Sample data</div>
            <Label className="text-[11px] font-medium text-[#6B778C]">Preview sale</Label>
            <Select value={sampleKey ?? "loading"} onValueChange={(v) => setSampleKey(v)}>
              <SelectTrigger className="mt-1.5 h-9 w-full text-[12px]" aria-label="Select a sale to preview">
                <SelectValue placeholder="Pick a receipt" />
              </SelectTrigger>
              <SelectContent>
                {sales === null && (
                  <SelectItem value="loading" disabled>
                    Loading receipts…
                  </SelectItem>
                )}
                <SelectItem value="walkin">Walk-in (sample data)</SelectItem>
                {(sales ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.receiptNo} - {s.customerName ?? "Walk-in"} · {KES(s.total, true)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[10px]">{selected.receiptNo}</Badge>
              <Badge variant="outline" className="text-[10px]">{items.length} items</Badge>
              <Badge variant="outline" className="text-[10px]">{KES(selected.total)}</Badge>
              <Badge variant="outline" className="text-[10px]">{selected.paymentMethod}</Badge>
              <Badge variant="outline" className="text-[10px]">KRA {selected.kraStatus}</Badge>
            </div>
          </Panel>
        </div>

        {/* ── live previews ── */}
        <div className="lg:col-span-3">
          <Panel className="p-4 md:p-5">
            <Tabs value={template} onValueChange={(v) => setTemplate(v as TemplateId)} className="flex min-h-0 flex-col">
              {/* toolbar */}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <TabsList className="h-9 bg-[#F4F5F7] p-1">
                  {TEMPLATES.map((tp) => (
                    <TabsTrigger key={tp.id} value={tp.id} className="gap-1.5 px-2.5 text-[12px] md:px-3">
                      {tp.icon}
                      <span className="hidden sm:inline">{tp.label}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={openWhatsApp}>
                    <MessageCircle size={14} /> <span className="hidden sm:inline">WhatsApp</span>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a href={smsHref} aria-label="Share receipt summary via SMS">
                      <Smartphone size={14} /> <span className="hidden sm:inline">SMS</span>
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setFullOpen(true)}>
                    <Maximize2 size={14} /> <span className="hidden sm:inline">Fullscreen</span>
                  </Button>
                </div>
              </div>

              <TabsContent value="thermal" className="mt-0">
                <div className="rounded-xl border border-[#DFE1E6] bg-[#F4F5F7] p-4 md:p-8">
                  <ThermalPreview sale={selected} brand={brand} />
                </div>
              </TabsContent>

              <TabsContent value="a4" className="mt-0">
                <div className="rounded-xl border border-[#DFE1E6] bg-[#F4F5F7] p-4 md:p-6">
                  <ScaledBox width={794} height={1123}>
                    <A4Sheet sale={selected} brand={brand} mode="invoice" />
                  </ScaledBox>
                </div>
              </TabsContent>

              <TabsContent value="giftcard" className="mt-0">
                <div className="rounded-xl border border-[#DFE1E6] bg-[#F4F5F7] p-4 md:p-8">
                  <GiftCardPreview brand={brand} />
                </div>
              </TabsContent>

              <TabsContent value="quotation" className="mt-0">
                <div className="rounded-xl border border-[#DFE1E6] bg-[#F4F5F7] p-4 md:p-6">
                  <ScaledBox width={794} height={1123}>
                    <A4Sheet sale={selected} brand={brand} mode="quotation" />
                  </ScaledBox>
                </div>
              </TabsContent>
            </Tabs>
          </Panel>
        </div>
      </div>

      {/* fullscreen dialog */}
      <Dialog open={fullOpen} onOpenChange={setFullOpen}>
        <DialogContent className="sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle className="font-display">
              {TEMPLATES.find((tp) => tp.id === template)?.label} - live preview
            </DialogTitle>
            <DialogDescription>
              {selected.receiptNo} · {selected.customerName ?? "Walk-in"} · {KES(selected.total)}
            </DialogDescription>
          </DialogHeader>
          <div className="df-scroll max-h-[68vh] overflow-y-auto rounded-xl bg-[#F4F5F7] p-4 md:p-6">
            <PreviewCanvas template={template} sale={selected} brand={brand} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
