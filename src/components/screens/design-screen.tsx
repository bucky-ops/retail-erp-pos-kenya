"use client";

import { Download, ShoppingCart, X } from "lucide-react";
import { KES } from "@/types";
import { KpiCard, Panel, ScreenHeader } from "@/components/df/shared";
import { Logo, DukaMark } from "@/components/df/logo";
import { TierBadge, StockBadge, KraBadge } from "@/components/df/badges";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

/* ── tokens ────────────────────────────────────────────────── */

const COLORS: { name: string; hex: string }[] = [
  { name: "Primary — Trust Blue", hex: "#0052CC" },
  { name: "Success — M-Pesa", hex: "#00C853" },
  { name: "Alert / Danger", hex: "#FF5630" },
  { name: "Navy / Dark", hex: "#172B4D" },
  { name: "Warning", hex: "#FFAB00" },
  { name: "Muted text", hex: "#6B778C" },
  { name: "Border", hex: "#DFE1E6" },
  { name: "Surface", hex: "#F4F5F7" },
];

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

const TYPE_USAGE = [
  { token: "h1 — page title", spec: "Sora 24px / 700", sample: "text-[24px] font-bold" },
  { token: "h2 — section", spec: "Sora 20px / 700", sample: "text-[20px] font-bold" },
  { token: "body — tables & forms", spec: "Inter 14px / 400", sample: "text-[14px]" },
  { token: "caption — labels, meta", spec: "Inter 12px / 500", sample: "text-[12px] font-medium" },
];

const TIERS = [
  {
    tier: "Bronze",
    min: "0 pts",
    perk: "1% back in points • birthday SMS",
    bg: "bg-[#EFEBE9]",
    text: "text-[#8D6E63]",
    bar: "#8D6E63",
  },
  {
    tier: "Silver",
    min: "2,000 pts",
    perk: "Free delivery within 5km • 5% tier discount",
    bg: "bg-[#ECEFF1]",
    text: "text-[#546E7A]",
    bar: "#78909C",
  },
  {
    tier: "Gold",
    min: "5,000 pts",
    perk: "10% tier discount • priority service • birthday 10% voucher",
    bg: "bg-[#FFF8E1]",
    text: "text-[#B8860B]",
    bar: "#FFD700",
  },
];

/** DukaMark SVG source — used to produce a real downloadable logo file. */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="512" height="512" fill="none">
  <path d="M7 5.5C7 4.67157 7.67157 4 8.5 4H16.2C22.5 4 27 8.8 27 16C27 23.2 22.5 28 16.2 28H8.5C7.67157 28 7 27.3284 7 26.5V5.5Z" fill="#0052CC" stroke="#0052CC" stroke-width="1.2" stroke-linejoin="round"/>
  <rect x="12.5" y="9.5" width="1.8" height="13" rx="0.9" fill="white" opacity="0.9"/>
  <rect x="15.2" y="9.5" width="1.8" height="13" rx="0.9" fill="white" opacity="0.6"/>
  <rect x="17.9" y="9.5" width="1.8" height="8" rx="0.9" fill="#00C853"/>
  <path d="M13 7.2L16 4L19 7.2" stroke="#00C853" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M16 4V11.5" stroke="#00C853" stroke-width="2.2" stroke-linecap="round"/>
  <circle cx="16.5" cy="22.2" r="1.8" fill="white" opacity="0.95"/>
</svg>`;

/* ── screen ────────────────────────────────────────────────── */

export default function DesignScreen() {
  const downloadLogo = () => {
    const url = URL.createObjectURL(new Blob([LOGO_SVG], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "dukaflow-logo.svg";
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Logo pack downloaded — 4 variants", description: "dukaflow-logo.svg (512×512 master)." });
  };

  return (
    <div className="space-y-8">
      <ScreenHeader
        title="Design System"
        subtitle="DukaFlow brand v2.4 — components, tokens & logo rules"
        actions={
          <Button
            onClick={downloadLogo}
            className="h-9 rounded-xl bg-[#0052CC] px-4 text-[13px] font-bold text-white hover:bg-[#0041A8]"
          >
            <Download size={14} /> Download SVG
          </Button>
        }
      />

      {/* ROW 1 — logo suite + colors/typography */}
      <div className="grid grid-cols-12 gap-6">
        <Panel className="col-span-12 lg:col-span-5">
          <h3 className="font-display text-[16px] font-bold text-[#172B4D]">Logo Suite</h3>
          <div className="mt-4 space-y-4">
            {[
              { label: "Full color on white", body: <Logo variant="full" />, box: "border border-[#DFE1E6] bg-white", usage: "Sidebar / headers" },
              { label: "White on #0052CC", body: <Logo variant="white" />, box: "bg-[#0052CC]", usage: "Navy surfaces" },
            ].map((v) => (
              <div key={v.label}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-[#6B778C]">{v.label}</p>
                <div className={cn("flex items-center rounded-xl p-5", v.box)}>
                  {v.body}
                  <span
                    className={cn(
                      "ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold",
                      v.label.startsWith("White") ? "bg-white/15 text-white" : "bg-[#F4F5F7] text-[#6B778C]"
                    )}
                  >
                    {v.usage}
                  </span>
                </div>
              </div>
            ))}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-[#6B778C]">Icon only 56px</p>
                <div className="flex h-[88px] items-center justify-center rounded-xl border border-[#DFE1E6] bg-[#F4F5F7]">
                  <Logo variant="icon" />
                </div>
                <p className="mt-1.5 text-[11px] text-[#6B778C]">POS dock</p>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-[#6B778C]">Favicon 32px</p>
                <div className="flex h-[88px] flex-col items-center justify-center gap-2.5 rounded-xl border border-[#DFE1E6] bg-[#F4F5F7]">
                  <Logo variant="favicon" />
                  <span className="flex items-center gap-1.5 rounded-full border border-[#DFE1E6] bg-white px-2.5 py-1 text-[11px] text-[#172B4D] shadow-sm">
                    <span className="h-3.5 w-3.5">
                      <DukaMark />
                    </span>
                    DukaFlow • POS
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] text-[#6B778C]">Browser tab</p>
              </div>
            </div>

            {/* clearspace */}
            <div className="rounded-xl bg-[#F4F5F7] p-4">
              <p className="text-[12px] font-bold text-[#172B4D]">Clear space</p>
              <p className="mt-0.5 text-[11px] text-[#6B778C]">
                Minimum padding = height of the “D” mark. Nothing enters the dashed zone.
              </p>
              <div className="mt-3 flex justify-center">
                <div className="rounded-lg border-2 border-dashed border-[#0052CC]/50 p-3">
                  <Logo variant="full" size={24} />
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <div className="col-span-12 space-y-6 lg:col-span-7">
          <Panel>
            <h3 className="font-display text-[16px] font-bold text-[#172B4D]">Colors</h3>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {COLORS.map((c) => {
                const lum = luminance(c.hex);
                const onWhite = Math.abs(lum - 1) > 0.35;
                return (
                  <div key={c.hex} className="overflow-hidden rounded-xl border border-[#DFE1E6]">
                    <div className="flex h-16 items-end justify-end p-2" style={{ background: c.hex }}>
                      <span className="flex items-center gap-1">
                        <span
                          className={cn("h-3 w-3 rounded-full border", onWhite ? "border-black/20 bg-white" : "border-white/40 bg-black")}
                          title={onWhite ? "Use white text" : "Use black text"}
                        />
                      </span>
                    </div>
                    <div className="bg-white p-2">
                      <p className="text-[11px] font-bold text-[#172B4D]">{c.name}</p>
                      <p className="font-mono text-[10px] text-[#6B778C]">{c.hex.toUpperCase()}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel>
            <h3 className="font-display text-[16px] font-bold text-[#172B4D]">Typography</h3>
            <div className="mt-4 flex items-start gap-5">
              <div className="font-display flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-[#172B4D] text-[40px] font-extrabold text-white">
                Aa
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-bold uppercase tracking-widest text-[#6B778C]">Sora — Display</p>
                <div className="mt-1 space-y-0.5">
                  {[
                    { w: 800, cls: "font-extrabold" },
                    { w: 700, cls: "font-bold" },
                    { w: 600, cls: "font-semibold" },
                    { w: 400, cls: "font-normal" },
                  ].map((r) => (
                    <p key={r.w} className={cn("font-display text-[15px] text-[#172B4D]", r.cls)}>
                      Sora {r.w} — Sell Smart. Stock Smart.
                    </p>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4">
              <p className="text-[12px] font-bold uppercase tracking-widest text-[#6B778C]">Inter — Body</p>
              <p className="mt-1 text-[14px] text-[#172B4D]">
                Inter Regular 14 — body text for tables, forms and receipts. KRA eTIMS compliant invoicing, M-Pesa
                reconciliation and stock transfers all render in Inter.
              </p>
            </div>
            <div className="mt-4 overflow-hidden rounded-xl border border-[#DFE1E6]">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[#FAFBFC] text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">
                    <th className="px-3 py-2">Token</th>
                    <th className="px-3 py-2">Spec</th>
                    <th className="px-3 py-2">Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {TYPE_USAGE.map((t) => (
                    <tr key={t.token} className="border-t border-[#DFE1E6]">
                      <td className="px-3 py-2 text-[12px] font-semibold text-[#172B4D]">{t.token}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-[#6B778C]">{t.spec}</td>
                      <td className={cn("px-3 py-2 text-[#172B4D]", t.sample)}>DukaFlow</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>

      {/* ROW 2 — components + tier ladder */}
      <div className="grid grid-cols-12 gap-6">
        <Panel className="col-span-12 xl:col-span-7">
          <h3 className="font-display text-[16px] font-bold text-[#172B4D]">Components</h3>

          <p className="mt-4 text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">Buttons</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button className="rounded-xl bg-[#0052CC] font-semibold text-white hover:bg-[#0041A8]">Primary</Button>
            <Button variant="outline" className="rounded-xl border-[#DFE1E6] bg-white font-semibold text-[#172B4D]">
              Secondary
            </Button>
            <Button className="rounded-xl bg-[#FF5630] font-semibold text-white hover:bg-[#E64A19]">Destructive</Button>
            <Button variant="ghost" className="rounded-xl font-semibold text-[#172B4D]">Ghost</Button>
            <Button disabled className="rounded-xl font-semibold">Disabled</Button>
            <Button className="h-[52px] rounded-xl bg-[#00C853] px-5 text-[14px] font-bold text-white hover:bg-[#00A844]">
              <ShoppingCart size={18} /> PAY {KES(12450)}
            </Button>
          </div>

          <p className="mt-5 text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">Badges</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TierBadge tier="Gold" />
            <TierBadge tier="Silver" />
            <TierBadge tier="Bronze" />
            <StockBadge qty={45} />
            <StockBadge qty={3} />
            <StockBadge qty={0} />
            <KraBadge status="Verified" />
            <KraBadge status="Pending" />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">KPI card</p>
              <KpiCard
                className="mt-2"
                icon={<ShoppingCart size={15} />}
                label="Today's sales"
                value={KES(124500)}
                delta="+12%"
                sub="vs yesterday same time"
              />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">Inputs & switches</p>
              <div className="mt-2 space-y-3 rounded-2xl border border-[#DFE1E6] bg-white p-4 shadow-sm">
                <div>
                  <Label className="text-[11px] font-semibold text-[#172B4D]">Search products, SKU, barcode…</Label>
                  <Input placeholder="Scan or type here" className="mt-1 h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px]" />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] font-semibold text-[#172B4D]">Apply loyalty points</Label>
                  <Switch defaultChecked />
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel className="col-span-12 xl:col-span-5">
          <h3 className="font-display text-[16px] font-bold text-[#172B4D]">Tier Ladder</h3>
          <p className="mt-0.5 text-[12px] text-[#6B778C]">Loyalty tiers — auto-upgrade on lifetime points.</p>
          <div className="mt-4 space-y-3">
            {TIERS.map((t) => (
              <div key={t.tier} className="overflow-hidden rounded-2xl border border-[#DFE1E6] bg-white shadow-sm">
                <div className="h-1.5" style={{ background: t.bar }} />
                <div className="flex items-center justify-between p-4">
                  <div>
                    <span className={cn("mb-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", t.bg, t.text)}>
                      {t.tier}
                    </span>
                    <p className="text-[13px] text-[#172B4D]">{t.perk}</p>
                  </div>
                  <span className="font-display shrink-0 text-[15px] font-bold text-[#172B4D]">{t.min}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* ROW 3 — wrong usage + do tiles */}
      <Panel>
        <h3 className="font-display text-[16px] font-bold text-[#172B4D]">Logo Guidelines — Wrong Usage</h3>
        <p className="mt-0.5 text-[12px] text-[#6B778C]">Never stretch, recolor, rotate or low-contrast the mark.</p>

        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            {
              label: "Stretched",
              body: (
                <div className="bg-white p-4">
                  <div className="scale-x-125">
                    <Logo variant="full" size={22} />
                  </div>
                </div>
              ),
            },
            {
              label: "Wrong color bg",
              body: (
                <div className="bg-[#00C853] p-4">
                  <DukaMark className="h-9 w-9" color="#0052CC" accent="#0052CC" />
                </div>
              ),
            },
            {
              label: "Rotated 15°",
              body: (
                <div className="bg-white p-4">
                  <div className="rotate-15">
                    <Logo variant="full" size={22} />
                  </div>
                </div>
              ),
            },
            {
              label: "Low contrast",
              body: (
                <div className="bg-[#172B4D] p-4">
                  <DukaMark className="h-9 w-9" color="#172B4D" accent="#172B4D" />
                </div>
              ),
            },
          ].map((t) => (
            <div key={t.label} className="relative overflow-hidden rounded-xl border border-[#DFE1E6]">
              {t.body}
              <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#FF5630] text-white shadow">
                <X size={12} strokeWidth={3} />
              </span>
              <p className="border-t border-[#DFE1E6] bg-[#FFF0F0] px-3 py-1.5 text-[11px] font-bold text-[#FF5630]">
                Don&apos;t — {t.label}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-6 text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">Correct usage</p>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="overflow-hidden rounded-xl border border-[#DFE1E6]">
            <div className="flex h-24 items-center justify-center bg-white p-4">
              <Logo variant="full" size={22} />
            </div>
            <p className="border-t border-[#DFE1E6] bg-[#E8F5E9] px-3 py-1.5 text-[11px] font-bold text-[#1B7A2E]">
              Do — on white
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border border-[#DFE1E6]">
            <div className="flex h-24 items-center justify-center bg-[#172B4D] p-4">
              <Logo variant="white" size={22} />
            </div>
            <p className="border-t border-[#DFE1E6] bg-[#E8F5E9] px-3 py-1.5 text-[11px] font-bold text-[#1B7A2E]">
              Do — on navy
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border border-[#DFE1E6]">
            <div
              className="relative flex h-24 items-center justify-center p-4"
              style={{
                background:
                  "linear-gradient(rgba(23,43,77,0.72), rgba(23,43,77,0.72)), url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='%23B08968'/%3E%3Crect x='6' y='10' width='12' height='20' fill='%2380553B'/%3E%3Crect x='24' y='6' width='10' height='28' fill='%239C6F4E'/%3E%3C/svg%3E\")",
              }}
            >
              <Logo variant="white" size={22} />
            </div>
            <p className="border-t border-[#DFE1E6] bg-[#E8F5E9] px-3 py-1.5 text-[11px] font-bold text-[#1B7A2E]">
              Do — on photo (overlay ≥70%)
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
