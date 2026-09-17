# DukaFlow POS — Complete Design & Data Spec

**Source of truth:** beautified compiled prototype bundle (`/tmp/app_pretty.js`, 5,592 lines, extracted from `/home/z/my-project/upload/Dukaflow-Prototype.html`).
**Target:** Next.js 16 + TypeScript + Tailwind 4 + shadcn/ui rebuild.
**Scope:** This document describes *everything the prototype contains* — layouts, every mock datum, every color, every handler — so the app can be rebuilt pixel-faithfully **without the prototype**. Anything marked ⚠️ NOT-IN-PROTOTYPE is explicitly absent from the code and must not be invented.

The prototype is a **single-page client-side app**: one root component `App` holds `page` state (one of 14 screen ids) and renders one of 14 screen functions inside a persistent shell (sidebar + topbar + device switcher). There is no router. Navigation = `setPage(id)`.

---

## 0. GLOBAL DESIGN TOKENS

### 0.1 Color palette (all used values)

| Token | Hex | Usage |
|---|---|---|
| Primary "Trust Blue" | `#0052CC` | Logo, primary buttons, active states, links, bars, focus rings, sidebar active icon |
| Primary hover/dark | `#0041A8` | Add-to-cart button hover |
| Accent "M-Pesa" green | `#00C853` | Success, M-Pesa, online dots, PAY button, to-green gradients |
| Danger / Alert | `#FF5630` | Danger buttons, debt/overdue text, credit sale icon |
| Navy / Dark | `#172B4D` | Sidebar, headings text, dark cards, avatars, login left panel, device frames |
| Page background | `#F4F5F7` | App bg, bars tracks, hover rows, chip bg |
| Card white | `#FFFFFF` | Cards |
| Border | `#DFE1E6` | All card/table borders |
| Muted text | `#6B778C` | Secondary text, labels |
| Input bg | `#FAFBFC` | Inputs, table headers, zebra rows |
| Amber / warning | `#FFAB00` | "Other" donut slice, Low Stock icon, KRA Pending text, gift-card icon color, Sales Order stage |
| Gold tier bg | `#FFF8E1` | Gold badge bg |
| Gold tier text | `#8B6D00` | Gold badge text |
| Gold border | `#FFE082` | Gold badge/discount card border |
| Pure gold | `#FFD700` | GOLD chip in POS customer card, Gold tier swatch |
| Silver bg / text | `#ECEFF1` / `#455A64` | Silver badge |
| Bronze bg / text | `#EFEBE9` / `#6D4C41` | Bronze badge |
| Bronze tier swatch | `#8D6E63` | Tier builder color dot (Bronze) |
| Silver tier swatch | `#78909C` | Tier builder color dot (Silver) |
| Success soft bg / text | `#E8F5E9` / `#2E7D32` | In-Stock badges, Online pills, M-Pesa pills, KRA connected pill |
| Danger soft bg / text | `#FFEBEE` / `#C62828` | Low stock, overdue, debt tiles |
| Danger border | `#FFCDD2` | Overdue chip borders, red keypad "C" |
| Red soft bg | `#FFF0F0` | Wrong-usage card, keypad Clear |
| Info soft bg / text | `#E3F2FD` / `#0D47A1` | SMS badges, "Thika Road Store" badge, PIN-filled boxes, chat doc card |
| Green border light | `#C8E6C9` | "Online • KRA Connected" pill border |
| White overlays | `white/5, white/10, white/20, white/30, white/50, white/60, white/70, white/90` | Sidebar cards, login shelf, gift-card chips, navy panels |

### 0.2 Typography

Loaded by a `FontLoader` component (injected `<link>` on mount):
`https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@400;600;700;800&display=swap`

- **Body:** `Inter, sans-serif` — set on the app root.
- **Display:** `Sora` via inline `style={{fontFamily:"Sora"}}` — page titles, card titles (h3/h4), KPI numbers, logo wordmark, GRAND TOTAL, big values.
- Sizes seen: 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 30, 32 px (arbitrary-value Tailwind classes like `text-[13px]`).
- Micro-label pattern: `text-[11px] uppercase tracking-widest text-[#6B778C] font-semibold` (KPI labels, table headers use `text-[11px] uppercase tracking-widest` on `bg-[#FAFBFC]`).

### 0.3 Radii

- `rounded-xl` (12px) — inputs, small buttons, tiles, inner boxes.
- `rounded-2xl` (16px) — **standard card radius**, kanban columns, chips-ish large buttons.
- `rounded-full` — pills, badges, avatars, category chips, view-switch pills, device switcher.
- `rounded-[14px]` — logo icon container; `rounded-[7px]` — favicon container.
- `rounded-[20px]` / `rounded-[24px]` — modals, login card, device frame; `rounded-[32px]`/`rounded-[36px]` — phone preview / mobile frame; `rounded-t-lg` — bar chart tops; `rounded-tl-sm`/`rounded-bl-sm` — chat bubbles; `rounded-sm` — sparkline bars.

### 0.4 Spacing & shadows

- Content padding: `p-4 lg:p-10` around screens; cards `p-4`/`p-5`/`p-6`; grids `gap-3`/`gap-4`/`gap-5`/`gap-6`.
- Sidebar width 280px expanded / 72px collapsed (`transition-all duration-300`), height `sticky top-0 h-screen`.
- Topbar height 64px (`h-[64px]`), sticky `top-0 z-20`; sidebar logo header also 64px.
- Shadows: `shadow-sm` (cards/buttons), `shadow` (default), `shadow-md` (hover on product/deal/report cards), `shadow-xl` (device switcher, phone preview), `shadow-2xl` (modals, device frames), PAY button glow `shadow-[0_8px_24px_rgba(0,200,83,0.35)]`, login card `shadow-[0_20px_60px_rgba(23,43,77,0.12)]`.

### 0.5 Animations / transitions

- `animate-pulse` — green "online/live" dots (topbar, dashboard live feed, login shelf, eTIMS status), POS **ScanBarcode** square button (the "barcode pulse").
- `animate-bounce` — success-modal check circle.
- `animate-[load_2s_ease-in-out]` + inline `@keyframes load{0%{width:0%}100%{width:100%; opacity:0}}` — 2px blue top loading bar (`fixed top-0 left-0 right-0 h-[2px] bg-[#0052CC]`, inline style `animation:"load 1.2s ease-out forwards"`).
- Hover transitions: `hover:shadow-md` + `transition` on product cards, deal cards, report cards; `hover:bg-white/10` sidebar items; `hover:bg-white` keypad keys.
- Kanban drag-and-drop: ⚠️ NOT-IN-PROTOTYPE (cards have `onClick` only → open detail drawer).
- Success-modal "50 points" is **static text** (`50 Points Earned!`), no counter animation. ⚠️ NOT-IN-PROTOTYPE: any counting animation.

### 0.6 Formatting conventions

- Money: `"KES " + n.toLocaleString()` (e.g. `KES 12,500`); some strings hardcode `KES 450k`, `KES 89k`, `KES +240k`.
- Receipt/invoice codes rendered `font-mono`.
- Avatars: initials in circles (`name.split(" ").map(w=>w[0]).join("")` or `name[0]`).

---

## 1. GLOBAL CHROME & SHARED COMPONENTS

### 1.1 Logo — `Ru` (exact SVG)

```tsx
function LogoMark({ color = "#0052CC", accent = "#00C853", white = false }) {
  return (
    <svg viewBox="0 0 32 32" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* "D" body — rounded-left rect open on right */}
      <path
        d="M7 5.5C7 4.67157 7.67157 4 8.5 4H16.2C22.5 4 27 8.8 27 16C27 23.2 22.5 28 16.2 28H8.5C7.67157 28 7 27.3284 7 26.5V5.5Z"
        fill={white ? "white" : color}
        stroke={white ? "white" : color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <g opacity={white ? "0.28" : "1"}>
        {/* barcode lines inside the D */}
        <rect x="12.5" y="9.5" width="1.8" height="13" rx="0.9" fill="white" opacity={white ? 0.9 : 0.9} />
        <rect x="15.2" y="9.5" width="1.8" height="13" rx="0.9" fill="white" opacity="0.6" />
        <rect x="17.9" y="9.5" width="1.8" height="8"  rx="0.9" fill={accent} />
      </g>
      {/* arrow up the middle */}
      <path d="M13 7.2L16 4L19 7.2" stroke={white ? "white" : accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 4V11.5" stroke={white ? "white" : accent} strokeWidth="2.2" strokeLinecap="round" />
      {/* pin / location dot */}
      <circle cx="16.5" cy="22.2" r="1.8" fill={white ? "#0052CC" : "white"} opacity={white ? 1 : 0.95} />
    </svg>
  );
}
```
Shape reads as a "D" = shopping cart + arrow + pin + barcode lines.

### 1.2 Logo variants — `Logo` component (`variant`, `size`, `className`)

| Variant | Structure |
|---|---|
| `icon` | `<div class="rounded-[14px] flex items-center justify-center shadow-sm" style={{width:size??56, height:size??56, background:"#0052CC"}}>` wrapping `<div class="w-[62%] h-[62%]"><LogoMark white/></div>` |
| `favicon` | `<div class="rounded-[7px] flex items-center justify-center" style={{width:32, height:32, background:"#0052CC"}}>` wrapping `<div class="w-[68%] h-[68%]"><LogoMark white/></div>` |
| `white` | Row `flex items-center gap-[10px]`: mark box `width:size*0.9 ?? 34` with `<LogoMark white color="white" accent="white"/>`, then Sora wordmark `fontSize: size*0.62 ?? 20`: `<span class="font-bold text-white">Duka</span><span class="font-normal text-white/90">Flow</span>` |
| `full` (default) | Row `flex items-center gap-[11px]`: mark box `width:size*0.92 ?? 36` with `<LogoMark/>`, then Sora wordmark `fontSize: size*0.64 ?? 22`: `<span style={{color:"#172B4D", fontWeight:800}} class="font-bold">Duka</span><span style={{color:"#0052CC", fontWeight:400}} class="font-normal">Flow</span>` |

Logo guidelines shown on the Design System screen: **Clearspace** ("x-height = icon height. No other element inside."), **Min Size** ("24px icon, 80px wordmark. Never smaller."), **Wrong Usage** ("No stretch, shadow, neon, rotated." — shown as stretched text `scale-x-150 opacity-50` in a red card).

### 1.3 Icon set

All icons are **lucide-react**. Exact mapping recovered from the bundle:

| Var | Lucide | Used for |
|---|---|---|
| `qr` | Palette | Sidebar: Design System |
| `Cn` | ShieldCheck | Sidebar: Login; password field; "KRA eTIMS Compliant" bullet |
| `Kr` | LayoutDashboard | Sidebar: Dashboard |
| `Gn` | ShoppingCart | Sidebar: POS; New Sale quick action; POS BIG PAY demo button |
| `Pn` | SquareKanban | Sidebar: Pipeline |
| `Mt` | Package | Sidebar: Inventory; Transfer quick action |
| `At` | Users | Sidebar: Customers; walk-in customer icon |
| `Xn` | HandCoins | Sidebar: Debts; Pay Supplier; CREDIT SALE pay mode |
| `Zn` | Receipt | Sidebar: Receipts; A4 Colored; chat ERP doc card icon |
| `ul` | Wallet | Sidebar: Payroll |
| `Dt` | MessageSquare | Sidebar: Messages; SMS Blast quick action |
| `Gr` | MessagesSquare | Sidebar: Raven Chat |
| `tn` | ChartColumn | Sidebar: Reports; report card icon |
| `nl` | Settings | Sidebar: Settings |
| `rl` / `tl` | TrendingUp / TrendingDown | KPI deltas |
| `zn` | TriangleAlert | Low Stock KPI |
| `Yn` | Check | Success check, KRA Verified, timeline ticks |
| `Ir` | Clock | KRA Pending |
| `Ft` | Eye | Row "view" actions (feed rows, customers rows) |
| `el` | Search | Search inputs |
| `jr` | ScanBarcode | POS search barcode button (pulsing) |
| `ll` | UserPlus | Add/Change Customer button |
| `Vt` / `Jr` | Plus / Minus | Add-to-cart, qty steppers |
| `qn` | X | Close drawer/customer chip |
| `Rt` | Gift | Promo code field icon; Loyalty QR label; gift cards |
| `Ar` | Banknote | CASH pay mode |
| `Bt` | Smartphone | M-PESA STK; "M-Pesa Daraja Integrated" bullet |
| `Lr` | Hash | TILL 123456 pay mode |
| `br` | Phone | PAYBILL pay mode |
| `Oe` | QrCode | All QR placeholders |
| `Br` | ArrowUpRight | PAY button trailing icon |
| `xr` | Printer | Thermal 80mm button |
| `$t` | Send | SMS / WhatsApp button; chat send |
| `Ht` | Wifi | "Offline Mode — Auto Sync"; "Offline Mode Enabled" badge |
| `Xr` | Mail | Email field |
| `Jn` | Store | Store selector; store cards |
| `Wr` | ChevronDown | Store selector trailing chevron |
| `Qr` | Calendar | Topbar date |
| `Yr` | LogOut | Sign Out |
| `Zr` | Menu | Sidebar collapse toggle |
| `Ur` | ChevronLeft | Back to Customers |
| `me` | SquarePen | Edit (customer detail) |
| `Hr` | Box | Deal card items count |

### 1.4 App shell layout

```
<div class="min-h-screen bg-[#F4F5F7] text-[#172B4D]" style={{fontFamily:"Inter, sans-serif"}}>
  <FontLoader/>                       {/* injects Google Fonts, renders null */}
  <div class="flex min-h-screen">
    <aside class="hidden lg:flex flex-col bg-[#172B4D] text-white transition-all duration-300
                  {collapsed ? 'w-[72px]' : 'w-[280px]'} sticky top-0 h-screen">…</aside>
    <div class="flex-1 min-w-0 flex flex-col">
      <topbar class="h-[64px] bg-white border-b border-[#DFE1E6] flex items-center justify-between px-4 lg:px-8 sticky top-0 z-20">…</topbar>
      <div class="flex-1 bg-[#F4F5F7] p-4 lg:p-10 overflow-auto">
        <div class="{deviceFrameClass} transition-all">   {/* device wrapper */}
          <div class="{device !== 'desktop' ? 'bg-[#F4F5F7] p-3' : ''}">
            {screen}
          </div>
        </div>
      </div>
    </div>
  </div>
  <DeviceSwitcher class="fixed bottom-4 right-4 z-30 …"/>
  <TopLoadBar/>  {/* 2px fixed blue progress */}
</div>
```

**Device frame classes** (state `device: "desktop" | "tablet" | "mobile"`, default `desktop`):
- desktop: `""` (no wrapper)
- tablet: `max-w-[1024px] mx-auto shadow-2xl rounded-[24px] overflow-hidden border-[10px] border-[#172B4D]`
- mobile: `max-w-[390px] mx-auto shadow-2xl rounded-[36px] overflow-hidden border-[10px] border-[#172B4D]`

### 1.5 Sidebar (`hidden lg:flex` — desktop only)

- Header row `h-[64px] flex items-center px-4 justify-between border-b border-white/10`:
  - expanded → `<Logo variant="white" size={28}/>`; collapsed → `<Logo variant="icon" size={40}/>`
  - toggle button `w-7 h-7 rounded-full bg-white/10` with **Menu** icon (size 14) → `setCollapsed(!collapsed)`
- Nav list `flex-1 overflow-auto py-3 px-2 space-y-1`. Each item is a full-width button:
  `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition`
  - **active:** `bg-white text-[#172B4D] shadow-sm border-l-4 border-l-[#0052CC]` (icon tinted `text-[#0052CC]`)
  - idle: `text-white/70 hover:bg-white/10 hover:text-white`
  - icon size 18; label hidden when collapsed; badge pill `text-[10px] bg-[#00C853] text-white px-2 py-0.5 rounded-full`
- **Nav items (exact order):**

| id | label | icon | badge |
|---|---|---|---|
| design | Design System | Palette | — |
| login | Login | ShieldCheck | — |
| dashboard | Dashboard | LayoutDashboard | — |
| pos | POS | ShoppingCart | `• Live` |
| pipeline | Pipeline | SquareKanban | — |
| inventory | Inventory | Package | — |
| customers | Customers | Users | — |
| debts | Debts | HandCoins | — |
| receipts | Receipts | Receipt | — |
| payroll | Payroll | Wallet | — |
| messages | Messages | MessageSquare | — |
| chat | Raven Chat | MessagesSquare | — |
| reports | Reports | ChartColumn | — |
| settings | Settings | Settings | — |

  (The only nav badge in the prototype is POS's "• Live". The red "3" badge lives on the chat channel # stock-alerts, not the sidebar.)
- Footer `p-3 border-t border-white/10`:
  - When **expanded**, device card: `bg-white/5 rounded-xl p-3 border border-white/10` → row [`w-8 h-8 rounded-full bg-[#0052CC] flex items-center justify-center font-bold` "DF"] + ["DukaFlow POS" `text-[12px] font-semibold`, "Tablet v2.4 • Online" `text-[11px] text-white/60`]; below: `mt-3 h-8 rounded-lg bg-[#0052CC] flex items-center justify-center` containing `<Logo variant="icon" size={28}/>`.
  - Sign Out button: `mt-3 w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-white/60 hover:bg-white/10` → LogOut icon 16 + "Sign Out" (label hidden when collapsed). No handler wired.

### 1.6 Topbar (64px, white, border-b)

- **Left group** `flex items-center gap-3`:
  - Mobile logo `lg:hidden`: `<Logo variant="full" size={20}/>`
  - Store selector `hidden md:flex items-center gap-2 bg-[#F4F5F7] border border-[#DFE1E6] rounded-full px-3 py-1.5`: **Store** icon 14 (`text-[#6B778C]`) + `<select class="bg-transparent text-[12px] font-semibold outline-none">` with options:
    1. `Thika Road • Kiambu • All Stores` (default)
    2. `Thika Road`
    3. `Kiambu`
    + **ChevronDown** icon 14 muted.
  - Status pill `hidden md:flex items-center gap-2 text-[11px] bg-[#E8F5E9] border border-[#C8E6C9] px-3 py-1.5 rounded-full`: pulsing `w-2 h-2 bg-[#00C853] rounded-full` + text **"Online • KRA Connected"**.
- **Right group** `flex items-center gap-3`:
  - Date `hidden md:flex items-center gap-2 text-[12px]`: **Calendar** icon 14 + `Sep 12, 2026`
  - Avatar: `w-8 h-8 rounded-full bg-[#172B4D] text-white flex items-center justify-center font-bold text-[11px]` → **"OK"**
  - Mobile quick nav `lg:hidden flex gap-1 bg-[#F4F5F7] rounded-full p-1 border`: nav items **slice(2,7)** (dashboard, pos, pipeline, inventory, customers) as `w-7 h-7 rounded-full flex items-center justify-center` icon buttons (icon 14), active = `bg-[#172B4D] text-white`.

### 1.7 Device switcher (fixed, all screens)

`fixed bottom-4 right-4 bg-white border border-[#DFE1E6] shadow-xl rounded-full p-1 flex gap-1 z-30`; three buttons `px-3 py-1.5 rounded-full text-[11px] font-bold`, active `bg-[#172B4D] text-white`, idle `text-[#6B778C]`:
- `Desktop` → device "desktop"
- `Tablet POS 1024` → device "tablet" (renders app in 1024×768-ish frame)
- `Mobile 390` → device "mobile" (390px frame)

### 1.8 Shared patterns

- **KPI card**: white `rounded-2xl border border-[#DFE1E6] p-5 shadow-sm`; label `text-[11px] uppercase tracking-widest text-[#6B778C] font-semibold`; value `text-[22px] font-bold` (Sora); optional delta pill (`flex items-center gap-1 text-[11px] font-bold … px-2 py-0.5 rounded-full`, green `text-[#00C853] bg-[#E8F5E9]` or red `text-[#FF5630] bg-[#FFEBEE]`); optional sparkline `flex items-end gap-[2px] h-[28px]` with `flex-1 bg-[#0052CC] rounded-sm` bars, `height: v*3+4 px`, `opacity: 0.2 + i*0.12`.
- **Data table**: wrapper `bg-white rounded-2xl border border-[#DFE1E6] overflow-hidden` + `overflow-auto`; `table w-full text-[13px]` (12px on dense tables); thead `bg-[#FAFBFC] text-[11px] uppercase tracking-widest text-[#6B778C]`, cells `p-3 text-left font-semibold`; rows `border-t border-[#F4F5F7] hover:bg-[#FAFBFC]` (+`cursor-pointer` when clickable).
- **Tier badge**: `px-2 py-0.5|1 rounded-full text-[10px]|text-[11px] font-bold` — Gold `bg-[#FFF8E1] text-[#8B6D00]`, Silver `bg-[#ECEFF1] text-[#455A64]`, Bronze `bg-[#EFEBE9] text-[#6D4C41]`.
- **Modal overlay**: `fixed inset-0 bg-[#172B4D]/40|/50 backdrop-blur-sm z-50 flex items-center justify-center p-4`; panel `bg-white rounded-[20px]|rounded-[24px] border border-[#DFE1E6] shadow-2xl`.
- **Right drawer**: `fixed inset-0 z-40 flex justify-end` + backdrop `flex-1 bg-[#172B4D]/30 (or /20) backdrop-blur-sm?` (pipeline uses `backdrop-blur-sm`, inventory plain) with `onClick close`; panel `w-[420px]|w-[380px] bg-white border-l border-[#DFE1E6] shadow-2xl p-6|p-5 overflow-auto`.

---

## 2. SCREEN: `design` — Design System

**Root:** `div.space-y-8`
**Header:** h1 `text-[28px] font-bold tracking-tight` (Sora, `#172B4D`) **"DukaFlow Design System"**; p `text-sm text-[#6B778C] mt-1` **"Modern • Clean • Kenyan but Global • Shopify POS + Linear + Stripe Dashboard"**.
**Body:** `grid grid-cols-12 gap-6`.

### 2.1 Left card — Logo Suite (`col-span-12 lg:col-span-5 bg-white rounded-2xl border p-6`)
- h3 (Sora) **"Logo Suite"**; stack of labeled samples (label = `text-[11px] uppercase tracking-widest text-[#6B778C] mb-2`):
  1. **"Full Color on White"** → `bg-white border rounded-xl p-5 flex items-center` with `<Logo variant="full"/>`
  2. **"White on Blue #0052CC"** → `bg-[#0052CC] rounded-xl p-5 flex items-center` with `<Logo variant="white"/>`
  3. Row of two: **"Icon Only 56×56"** → `<Logo variant="icon"/>` ; **"Favicon 32×32"** → `<Logo variant="favicon"/>` + below a fake browser pill `mt-3 flex items-center gap-2 bg-[#F4F5F7] border rounded-full px-3 py-1` = favicon logo + `text-[12px]` "DukaFlow • POS".
- **Logo Guidelines** (`mt-8`, h4 "Logo Guidelines", `grid grid-cols-3 gap-3 text-[11px]`):
  1. gray card (`bg-[#F4F5F7] rounded-xl p-3`) "Clearspace" — "x-height = icon height. No other element inside." + demo: dashed blue border box around `<Logo variant="full" size={24}/>`
  2. gray card "Min Size" — "24px icon, 80px wordmark. Never smaller." + `<Logo variant="icon" size={24}/>`
  3. red card (`bg-[#FFF0F0] rounded-xl p-3`, title `text-[#FF5630]`) "Wrong Usage" — "No stretch, shadow, neon, rotated." + stretched text demo: `mt-2 text-center opacity-50 scale-x-150` "DukaFlow"

### 2.2 Right column (`col-span-12 lg:col-span-7 space-y-6`)

**Colors card** (white, rounded-2xl, p-6): h3 **"Colors"**; `grid grid-cols-4 gap-3` of swatch tiles (`rounded-xl border overflow-hidden`, swatch `h-[54px]`, name+hex `p-2 text-[11px]`):

| Name | Hex | bottom border? |
|---|---|---|
| Primary Trust Blue | `#0052CC` | no |
| Accent M-Pesa | `#00C853` | no |
| Alert | `#FF5630` | no |
| Dark | `#172B4D` | no |
| Background | `#F4F5F7` | yes (`1px solid #DFE1E6`) |
| Card White | `#FFFFFF` | yes |
| Border | `#DFE1E6` | yes |
| Gold Tier | `#FFD700` | no |

**Typography card**: h3 **"Typography — Sora Headings / Inter Body"**; specimens:
- `text-[32px] font-bold` Sora `#172B4D`: **"Sora Bold 32 — Sell Smart. Stock Smart."**
- `text-[20px] font-semibold` Sora: **"Sora Semibold 20 — Owner Dashboard"**
- `text-[14px]` Inter: **"Inter Regular 14 — Body text for tables, forms, receipts. KRA eTIMS compliant."**

**Components card**: h3 **"Components"**.
- Buttons row (`flex flex-wrap gap-3 mb-5`):
  - `Primary`: `bg-[#0052CC] text-white px-5 py-[10px] rounded-xl text-sm font-semibold shadow-sm`
  - `Secondary`: `border border-[#DFE1E6] bg-white …`
  - `Ghost`: `text-[#172B4D] px-5 py-[10px] rounded-xl …`
  - `Danger`: `bg-[#FF5630] text-white …`
  - `POS BIG PAY` demo: `bg-[#00C853] text-white px-5 h-[64px] rounded-xl text-[15px] font-bold flex items-center gap-2 shadow-sm` → ShoppingCart icon 20 + **"POS BIG PAY KES 12,450"**
- Badges row (`flex flex-wrap gap-2 mb-5`), all `px-3 py-1 rounded-full text-[11px] font-bold`:
  - `GOLD • 420pts` — `bg-[#FFF8E1] text-[#8B6D00] border border-[#FFE082]`
  - `SILVER` — `bg-[#ECEFF1] text-[#455A64] border`
  - `BRONZE` — `bg-[#EFEBE9] text-[#6D4C41] border`
  - `In Stock 45` — `bg-[#E8F5E9] text-[#2E7D32]`
  - `Low Stock 3` — `bg-[#FFEBEE] text-[#C62828]`
- `grid grid-cols-2 gap-4`:
  - **KPI Card** demo: label "KPI CARD" (`text-[11px] text-[#6B778C] uppercase`), value `text-xl font-bold` Sora **"KES 124,500"**, sparkline bars `[4,7,5,9,6,10,8]` → `flex-1 bg-[#0052CC]/20 rounded-sm`, `height: v*3px`.
  - **Input** demo: label "INPUT", box `mt-2 h-10 rounded-xl border border-[#DFE1E6] flex items-center px-3 text-sm bg-[#FAFBFC]` → "Search products, SKU, barcode…"

---

## 3. SCREEN: `login`

**Root:** `min-h-[720px] flex items-center justify-center p-4`
**Card:** `w-full max-w-[980px] bg-white rounded-[24px] border border-[#DFE1E6] shadow-[0_20px_60px_rgba(23,43,77,0.12)] overflow-hidden grid grid-cols-1 md:grid-cols-2`

### 3.1 Left panel (marketing)
`bg-[#172B4D] p-8 md:p-10 text-white relative overflow-hidden`
- Decorative blur circle: `absolute -right-20 -top-20 w-[280px] h-[280px] bg-[#0052CC]/30 rounded-full blur-[30px]`
- `<Logo variant="white" size={30}/>`
- `mt-12`: h2 `text-[30px] font-bold leading-[1.1]` (Sora): **"Sell Smart."** `<br/>` **"Stock Smart."** ; p `text-white/70 mt-3 text-sm` **"Kenya's Smart Retail ERP + POS — KRA eTIMS & M-Pesa native."**
- Kenyan-duka "product shelf" card (`mt-10 bg-white/5 rounded-[20px] border border-white/10 p-4`):
  - bar strip `flex gap-1 mb-3`: four `h-3 w-10 rounded` blocks alternating `#0052CC, #00C853, #0052CC, #00C853`
  - `grid grid-cols-4 gap-2`: 4 white tiles `rounded-xl h-[56px] flex items-center justify-center text-lg` with emojis 🧱 🎨 🚿 🔨
  - live line `mt-3 flex items-center gap-2 text-[11px] text-white/60`: pulsing green dot + **"Thika Road • Live Sales 24"**
- Feature list (`mt-8 space-y-2 text-[13px]`), each `flex items-center gap-2` with green `#00C853` icon (size 16):
  - ShieldCheck — **"KRA eTIMS Compliant"**
  - Smartphone — **"M-Pesa Daraja Integrated"**
  - Wifi — **"Offline Mode — Auto Sync"**

### 3.2 Right panel (auth) — `p-8 md:p-10`
- **Tab switch** `flex gap-2 bg-[#F4F5F7] rounded-full p-1 w-fit`; buttons `px-5 py-2 rounded-full text-sm font-semibold`; active = `bg-white shadow border border-[#DFE1E6] text-[#172B4D]`, idle `text-[#6B778C]`. State `loginTab: "pin" | "owner"` (default `"pin"`).
  - **"Staff PIN"** / **"Owner Login"**

**Staff PIN tab** (`mt-8`):
- Badge row: `px-3 py-1 bg-[#E8F5E9] text-[#2E7D32] rounded-full text-[11px] font-bold flex items-center gap-1` → Wifi 12 + **"Offline Mode Enabled"**; plus `px-3 py-1 bg-[#E3F2FD] text-[#0D47A1] rounded-full text-[11px] font-bold` **"Thika Road Store"**
- `text-sm font-semibold text-[#172B4D]` **"Enter 4-digit PIN"**
- 4 PIN boxes: `w-12 h-14 rounded-xl border-2 flex items-center justify-center text-xl font-bold`; filled: `border-[#0052CC] bg-[#E3F2FD] text-[#0052CC]` showing `•`; empty: `border-[#DFE1E6] bg-[#FAFBFC]`
- Keypad `grid grid-cols-3 gap-3 mt-6 max-w-[300px]`: digits 1–9 buttons `h-14 rounded-xl bg-[#F4F5F7] border border-[#DFE1E6] font-bold text-lg hover:bg-white` → `setPin(p => p.length<4 ? p+digit : p)`; then:
  - **C** (clear): `bg-[#FFF0F0] border border-[#FFCDD2] text-[#FF5630] font-bold` → `setPin("")`
  - **0**: standard style → append "0"
  - **⌫**: standard style → `setPin(p => p.slice(0,-1))`
- Submit: `mt-6 w-full max-w-[300px] h-12 bg-[#0052CC] text-white rounded-xl font-semibold` **"Login with PIN"** → `setStoreModal(true)`

**Owner Login tab** (`mt-8 space-y-4 max-w-[360px]`):
- **Email** field: label `text-[12px] font-semibold text-[#172B4D]`; input row `mt-1 h-11 border border-[#DFE1E6] rounded-xl flex items-center px-3 bg-[#FAFBFC] gap-2` with Mail icon 16 muted; `defaultValue: "owner@dukaflow.co.ke"`, placeholder same.
- **Password** field: same chrome with ShieldCheck icon 16; `type="password"`, `defaultValue: "••••••••"`.
- Submit `w-full h-11 bg-[#0052CC] text-white rounded-xl font-semibold mt-2` **"Sign In"** → `setStoreModal(true)`

### 3.3 Store-select modal (after either login)
Overlay `fixed inset-0 bg-[#172B4D]/40 backdrop-blur-sm z-50 …`; panel `bg-white rounded-[20px] border shadow-2xl max-w-[560px] w-full p-6`:
- h3 (Sora) **"Select Store"**; p `text-sm text-[#6B778C]` **"Choose which store to operate in. You can switch anytime."**
- `grid grid-cols-2 gap-4 mt-5`, both buttons `text-left rounded-2xl p-4` → close modal + `setPage("dashboard")`:
  1. **Thika Road** — selected style `border-2 border-[#0052CC] bg-[#E3F2FD]`: header row [Store icon `text-[#0052CC]`] + [pill `text-[11px] bg-[#0052CC] text-white px-2 py-1 rounded-full` "Active"]; `font-bold mt-3` "Thika Road"; `text-[12px] text-[#6B778C]` "Nairobi • Stock KES 450k"; `text-[12px] font-bold text-[#00C853] mt-1` "Sales today KES 124,500"
  2. **Kiambu Road** — idle style `border border-[#DFE1E6] hover:border-[#0052CC]/40`: Store icon muted; "Kiambu Road"; "Kiambu • Stock KES 320k"; "Sales today KES 89,300"

---

## 4. SCREEN: `dashboard`

**Root:** `space-y-6` → single `grid grid-cols-12 gap-5`.
**Main column:** `col-span-12 xl:col-span-9 space-y-5`.

### 4.1 KPI row — `grid grid-cols-1 md:grid-cols-4 gap-4`
1. **Today's Sales** — delta pill **+12%** (TrendingUp 12, green style); value **KES 124,500** (`text-[22px] font-bold`, Sora); sparkline `[3,6,4,8,5,9,7]` (blue bars, height `v*3+4px`, opacity `0.2+i*0.12`).
2. **M-Pesa vs Cash** — donut: `w-[56px] h-[56px] rounded-full` with `background: conic-gradient(#00C853 0% 45%, #0052CC 45% 85%, #FFAB00 85% 100%)`; legend `text-[11px] space-y-1` with 2px dots: **M-Pesa 45%** (green), **Cash 40%** (blue), **Other 15%** (amber).
3. **Total Debtors** — delta pill **-8%** (TrendingDown 12, red style); value **KES 450k** in `text-[#FF5630]`; sub `text-[11px] text-[#6B778C] mt-2` **"18 overdue • Action needed"**.
4. **Low Stock** — card has `border-l-4 border-l-[#FFAB00]`; right icon TriangleAlert 14 amber; value **23 items**; sub **"Cement, Paint, Plumbing"**.

### 4.2 Row 2 — `grid grid-cols-1 md:grid-cols-3 gap-4`
- **Sales Trend • 7 Days** (col-span-2): header h4 (Sora) + caption `text-[11px] text-[#6B778C]` **"Thika Road + Kiambu"**. SVG `viewBox="0 0 320 80"` `class="w-full h-[96px]"`:
  - blue polyline `stroke:#0052CC strokeWidth:2.5` points `0,60 45,50 90,55 135,30 180,35 225,20 270,25 320,10`
  - green dashed polyline `stroke:#00C853 strokeWidth:2 strokeDasharray:"4 4" opacity:0.6` points `0,65 45,62 90,60 135,50 180,45 225,40 270,38 320,30`
  - x labels row `flex justify-between text-[11px] text-[#6B778C] mt-2`: Mon Tue Wed Thu Fri Sat Sun
- **Sales by Store**: progress rows:
  - "Thika Road" — **KES 124k** — track `h-2 bg-[#F4F5F7] rounded-full`, fill blue **68%**
  - "Kiambu" — **KES 89k** — fill green **42%**
  - gray box `mt-4 p-3 rounded-xl bg-[#F4F5F7] text-[11px]`: p **"Payment Split"**; chips `flex gap-2 mt-2`: `px-2 py-1 bg-white rounded-full border` **"Cash 40%"**; `px-2 py-1 bg-[#E8F5E9] rounded-full text-[#2E7D32]` **"M-Pesa 45%"**

### 4.3 Live Sales Feed table
Card `bg-white rounded-2xl border overflow-hidden`; header `p-5 flex justify-between items-center border-b`:
- left: h4 (Sora) with pulsing green dot + **"Live Sales Feed"**
- right: `text-[11px] text-[#6B778C]` "KRA Status" + static green dot `w-2 h-2 bg-[#00C853] rounded-full`

Columns (text-left, p-3): Time / Receipt / Customer / Store / Amount / Pay / KRA / (actions, untitled).

Rows (all 6, verbatim):

| time | receipt | customer | tier | store | amount | pay | kra |
|---|---|---|---|---|---|---|---|
| 14:32 | INV-2847 | John Kamau | Gold | Thika Road | 12500 | M-Pesa | Verified |
| 14:28 | INV-2846 | Wanjiku Mwangi | Silver | Kiambu | 8900 | Cash | Pending |
| 14:15 | INV-2845 | Otieno Ochieng | Bronze | Thika Road | 3450 | Till | Verified |
| 14:02 | INV-2844 | Achieng Atieno | Gold | Thika Road | 45000 | M-Pesa | Verified |
| 13:55 | INV-2843 | Mutiso K. | Silver | Kiambu | 1200 | Gift Card | Verified |
| 13:40 | INV-2842 | Chebet R. | Bronze | Thika Road | 5600 | Cash | Pending |

Row rendering: time muted; receipt `font-mono font-semibold`; customer cell = `w-6 h-6 rounded-full bg-[#DFE1E6] … text-[11px] font-bold` initial circle + name + tier badge (Gold/Silver/Bronze styles above); amount `font-bold` "KES "+toLocaleString; pay = pill `px-2 py-1 bg-[#E8F5E9] rounded-full text-[11px] text-[#2E7D32]`; KRA cell = `flex items-center gap-1 text-[11px]` with **Check** 12 + green `#00C853` when "Verified", **Clock** 12 + `#FFAB00` when "Pending"; last cell = round icon button `w-7 h-7 rounded-full border border-[#DFE1E6]` with **Eye** 14 (no handler).

### 4.4 Right rail — `col-span-12 xl:col-span-3 space-y-4`
1. **Staff on Shift** (white card p-5): rows per staff (3): relative avatar `w-9 h-9 rounded-full … text-white font-bold text-[12px]` bg `c.color`, initials; status dot `absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white` `bg-[#00C853]` online else `bg-[#DFE1E6]`; name `text-[13px] font-semibold`, role `text-[11px] text-[#6B778C]`; right pill `text-[10px] px-2 py-0.5 rounded-full` → online: `bg-[#E8F5E9] text-[#2E7D32]` "Online", else `bg-[#F4F5F7] text-[#6B778C]` "Off".

   Data (verbatim):
   | name | role | online | color |
   |---|---|---|---|
   | Mary Wanjiku | Cashier | true | #0052CC |
   | James Otieno | Store Keeper | true | #00C853 |
   | Grace Akinyi | Sales | false | #FF5630 |

2. **Quick Actions** (navy card `bg-[#172B4D] rounded-2xl p-5 text-white`): h4 (Sora) "Quick Actions"; `grid grid-cols-2 gap-2`; buttons `h-12 rounded-xl … text-[12px] font-semibold flex flex-col items-center justify-center gap-1` (icon 16 above label):
   - **New Sale** — `bg-[#0052CC] text-white` — onClick → `setPage("pos")`
   - **Transfer** — `bg-white/10 border border-white/10` (Package icon) — no handler
   - **Pay Supplier** — same style — HandCoins icon — no handler
   - **SMS Blast** — `bg-[#00C853] text-white` — MessageSquare icon — no handler
3. **M-Pesa Till** (white card p-5): label `text-[11px] uppercase tracking-widest …` "M-PESA TILL"; value `text-[18px] font-bold mt-1` **"123456 • DukaFlow"**; bar `mt-3 h-2 bg-[#F4F5F7] rounded-full` fill green `w-[78%]`; caption `text-[11px] text-[#6B778C] mt-1` **"KES 89k collected today"**.

---

## 5. SCREEN: `pos`

**Root:** one card `bg-white rounded-2xl border overflow-hidden shadow-sm min-h-[760px] flex flex-col`.

### 5.1 Header — `h-[64px] border-b px-4 gap-3 bg-[#FAFBFC] flex items-center justify-between`
- Search: `relative flex-1 max-w-[420px]` — Search icon 16 absolute left-3; input `w-full h-10 pl-9 pr-10 rounded-xl border bg-white text-sm outline-none focus:border-[#0052CC]` placeholder **"Search products, SKU, barcode… (⌘K)"**; right overlay `absolute right-2 … w-8 h-8 rounded-lg bg-[#0052CC] text-white flex items-center justify-center animate-pulse` with **ScanBarcode** 16 ← the "barcode pulse".
- Category chips (`hidden lg:flex items-center gap-1.5 overflow-auto`): ["All","Cement","Paint","Plumbing","Tools","Electrical"]; button `px-3 py-1.5 rounded-full text-[12px] font-semibold border whitespace-nowrap`; active (`category === chip`) `bg-[#0052CC] text-white border-[#0052CC]`, else `bg-white border-[#DFE1E6] text-[#6B778C]`; onClick sets category. Products filter: `category === "All" ? products : products.filter(p => p.cat === category)`.
- Customer button: `h-10 px-4 rounded-xl bg-[#172B4D] text-white text-sm font-semibold flex items-center gap-2` (UserPlus 16); label = selected ? **"Change Customer"** : **"Add Customer"**; onClick toggles between null and the John Kamau customer object (below).

### 5.2 Body — `flex-1 grid grid-cols-12 min-h-0`
**Product grid** `col-span-12 lg:col-span-7 p-4 bg-[#F4F5F7] overflow-auto` → `grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3`.
Product card: `bg-white rounded-2xl border p-3 shadow-sm hover:shadow-md transition group` + `opacity-60` when stock 0.
- image area `h-[72px] bg-[#FAFBFC] rounded-xl flex items-center justify-center text-[28px] relative`: emoji; if stock 0 → overlay `absolute inset-0 bg-white/70 rounded-xl flex items-center justify-center` with pill `text-[11px] font-bold bg-[#172B4D] text-white px-2 py-1 rounded-full` **"Out of Stock"**; stock badge `absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full font-bold`: stock 0 → `bg-[#FFEBEE] text-[#C62828]` text "0"; stock<5 → same red style text `Low {stock}`; else `bg-[#E8F5E9] text-[#2E7D32]` text `{stock} in stock`
- name `text-[13px] font-semibold mt-2 leading-tight line-clamp-2`
- `text-[11px] text-[#6B778C] font-mono`: `{sku} • {cat}`
- footer `flex justify-between items-center mt-3`: price `font-bold text-[13px]` "KES "+toLocaleString; add button `w-8 h-8 rounded-full bg-[#0052CC] text-white flex items-center justify-center hover:bg-[#0041A8] disabled:bg-[#DFE1E6]` (Plus 16), `disabled` & no-op when stock 0; onClick `addToCart(product)`.

**Products master list (8, verbatim):**

| id | name | sku | stock | price | cat | emoji |
|---|---|---|---|---|---|---|
| 1 | Bamburi Cement 50kg | CMT-001 | 45 | 1250 | Cement | 🧱 |
| 2 | Crown Paint Gloss White 4L | PNT-012 | 3 | 3450 | Paint | 🎨 |
| 3 | PVC Pipe 3/4" 6m | PLB-033 | 120 | 650 | Plumbing | 🚿 |
| 4 | Hammer 16oz Stanley | TLS-009 | 0 | 1450 | Tools | 🔨 |
| 5 | Electrical Cable 2.5mm | ELC-021 | 67 | 890 | Electrical | 🔌 |
| 6 | Gypsum Board 9mm | CMT-014 | 22 | 950 | Cement | 🧱 |
| 7 | Dulux Vinyl Matt | PNT-018 | 8 | 6200 | Paint | 🎨 |
| 8 | Angle Valve Brass | PLB-041 | 54 | 420 | Plumbing | 🚰 |

`addToCart(p)`: if in cart → `qty+1`; else push `{id, name, price, qty:1, sku, emoji}`.

### 5.3 Cart column — `col-span-12 lg:col-span-5 border-t lg:border-t-0 lg:border-l bg-white flex flex-col min-h-[500px]`

**Customer strip** `p-4 border-b bg-[#FAFBFC]`:
- Empty state (no customer): dashed box `rounded-xl border border-dashed border-[#DFE1E6] p-4 flex items-center justify-between`: left = circle `w-10 h-10 rounded-full bg-[#DFE1E6]` Users 16 + [ "Walk-in Customer" `font-semibold text-sm`, "No loyalty • No debt" `text-[11px] text-[#6B778C]` ]; right button `px-3 py-1.5 rounded-full bg-white border text-[12px] font-semibold` **"Add"** → `setCustomer(POS_CUSTOMER)`.
- Selected: `rounded-xl border border-[#FFE082] bg-[#FFFDE7] p-3`:
  - header: avatar `w-10 h-10 rounded-full bg-[#172B4D] text-white font-bold` "JK"; name row `font-semibold text-sm` + GOLD chip `px-2 py-0.5 rounded-full bg-[#FFD700] text-[#8B6D00] text-[10px] font-bold`; phone `text-[11px] text-[#6B778C]`; close X button `w-6 h-6 rounded-full bg-white border` → `setCustomer(null)`
  - `grid grid-cols-3 gap-2 mt-3 text-[11px]`: **Points** (`bg-white rounded-lg p-2 border`; value bold `{points} = KES {points}`) • **Debt** (`bg-[#FFEBEE] border-[#FFCDD2]`; label+value `text-[#C62828]`, `KES {debt} overdue`) • **Gift Card** (white; `KES {gift}`)
  - credit bar: `text-[11px] text-[#6B778C]` "Credit Limit 60%" + `h-1.5 bg-white rounded-full` fill `bg-[#FF5630] w-[60%]`

  **POS customer object (verbatim):** `{ name: "John Kamau", phone: "0712 345 678", tier: "GOLD", points: 420, debt: 2000, gift: 1000 }`

**Cart lines** `flex-1 overflow-auto p-3 space-y-2` — each line `flex gap-3 p-2 rounded-xl border border-[#F4F5F7] hover:border-[#DFE1E6] bg-[#FAFBFC]`:
- emoji tile `w-10 h-10 rounded-lg bg-white border text-lg`
- middle: name `text-[13px] font-semibold truncate`; `text-[11px] text-[#6B778C]` `{sku} • KES {price}`; controls row `flex items-center gap-2 mt-1`:
  - stepper `flex items-center gap-1 bg-white border rounded-full px-1`: Minus button `w-6 h-6 rounded-full hover:bg-[#F4F5F7]` → `qty: Math.max(1, qty-1)`; qty `text-[12px] font-bold w-5 text-center`; Plus button → `qty+1`
  - discount `<select>` `text-[11px] border rounded-full px-2 py-1 bg-white` options: **-0%**, **5%**, **10% GOLD** (no onChange wired)
- right: line total `text-[13px] font-bold` "KES "+(price*qty).toLocaleString(); Remove link `text-[11px] text-[#FF5630] mt-1` → filter out by id.

**Default cart (verbatim):**
```ts
[{ id: 1, name: "Bamburi Cement 50kg", price: 1250, qty: 4, sku: "CMT-001", emoji: "🧱" },
 { id: 2, name: "Crown Paint White 4L", price: 3450, qty: 2, sku: "PNT-012", emoji: "🎨" },
 { id: 3, name: 'PVC Pipe 3/4"',     price: 650,  qty: 5, sku: "PLB-033", emoji: "🚿" }]
```
(Note: line 2's cart name is "Crown Paint White 4L" — the catalog name is "Crown Paint Gloss White 4L". Keep both verbatim.)

**Totals footer** `p-4 border-t bg-white space-y-3`:
- Promo row: input box `flex-1 h-9 border rounded-xl flex items-center px-3 gap-2 bg-[#FAFBFC]` with **Gift** icon 14 muted; input placeholder "Promo code", `defaultValue: promoApplied ? "GOLD10" : ""`; Apply button `px-4 h-9 rounded-xl text-[12px] font-bold` → toggles `promoApplied`; applied style `bg-[#0052CC] text-white` label **"Applied"**, idle `bg-[#F4F5F7] border` label **"Apply"**.
- Totals list `space-y-1.5 text-[13px]` (state: `promoApplied=true`, `usePoints=true` initially):
  - Subtotal — `KES {subtotal}` where `subtotal = Σ price*qty` (**15,150** with defaults)
  - (if promoApplied) row `text-[#0052CC]`: **"Discount GOLD10"** — `-KES {discount}` where `discount = promoApplied ? 500 : 0`
  - **VAT 16%** — `KES {vat}` where `vat = Math.round((subtotal - discount) * 0.16)` (**2,344**)
  - **Gift Card** — `-KES 1000` (hardcoded)
  - Points toggle row: switch `w-9 h-5 rounded-full p-0.5 flex` (on: `justify-end bg-[#00C853]`, off: `justify-start bg-[#DFE1E6]`, knob `w-4 h-4 bg-white rounded-full`, onClick toggles `usePoints`) + label **"Use 300 pts"**; right `-KES {pointsValue}` where `pointsValue = usePoints ? 300 : 0`
  - GRAND TOTAL row `pt-2 border-t border-dashed`: label `font-bold text-[14px]` "GRAND TOTAL"; value `font-extrabold text-[22px]` Sora `KES {grandTotal}` where `grandTotal = subtotal - discount + vat - 1000 - pointsValue` (**15,694** with defaults)
- **Payment mode grid** `grid grid-cols-2 gap-2` — buttons `h-[52px] rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] hover:bg-white flex items-center justify-center gap-2 text-[11px] font-bold`, text color per mode, icon 16:

  | label | icon | color |
  |---|---|---|
  | CASH | Banknote | #172B4D |
  | M-PESA STK | Smartphone | #00C853 |
  | TILL 123456 | Hash | #0052CC |
  | PAYBILL | Phone | #6B778C |
  | GIFT CARD | Gift | #FFAB00 |
  | CREDIT SALE | HandCoins | #FF5630 |

  (No onClick on the 6 modes; any mode → PAY opens success modal.)
- **PAY button**: `w-full h-[56px] rounded-xl bg-[#00C853] text-white font-extrabold text-[16px] shadow-[0_8px_24px_rgba(0,200,83,0.35)] flex items-center justify-center gap-2` → content `PAY` + ` KES {grandTotal.toLocaleString()} ` + ArrowUpRight 18; onClick `setShowSuccess(true)`.

### 5.4 Success modal (`showSuccess`)
Overlay `fixed inset-0 bg-[#172B4D]/50 backdrop-blur-sm z-50 …`; panel `bg-white rounded-[24px] border shadow-2xl w-full max-w-[560px] overflow-hidden`; body `p-8 text-center`:
- Check circle `w-20 h-20 rounded-full bg-[#E8F5E9] mx-auto flex items-center justify-center animate-bounce` with **Check** 36 `text-[#00C853]`
- h2 `text-[24px] font-bold mt-4` Sora **"Sale Complete!"**
- p `text-[14px] text-[#6B778C] mt-1`: "Invoice **INV-2848** • M-Pesa • " + span `text-[#00C853] font-bold` **"50 Points Earned!"**
- QR duo `grid grid-cols-2 gap-4 mt-6`:
  - **KRA QR** card `rounded-xl border p-3`: label `text-[11px] font-bold text-[#0052CC] flex items-center gap-1 justify-center` (ShieldCheck 12) "KRA QR"; box `mt-2 w-full aspect-square bg-[#F4F5F7] rounded-lg flex items-center justify-center` with **QrCode** 48 `text-[#172B4D]`; caption `text-[10px] mt-1 font-mono` **"CU: KRAMW004..."**
  - **Loyalty QR** card: label `text-[#00C853]` (Gift 12) "Loyalty QR"; box `bg-[#FFF8E1]` QrCode 48 `text-[#8B6D00]`; caption `text-[10px] mt-1` **"Balance 470 pts"**
- Buttons `grid grid-cols-2 gap-2 mt-6` (`h-10 rounded-xl border border-[#DFE1E6] text-sm font-semibold flex items-center justify-center gap-2`, icon 14):
  - **Thermal 80mm** (Printer) — no handler
  - **A4 Colored** (Receipt) — no handler
  - **SMS / WhatsApp** (Send) — no handler
  - **New Sale** — `bg-[#172B4D] text-white text-sm font-bold` — onClick: `setShowSuccess(false); setCart([]); setCustomer(null)`

---

## 6. SCREEN: `pipeline`

**Root:** `space-y-4`.

### 6.1 Toolbar (`flex flex-wrap gap-3 items-center justify-between`)
- Left: view switch `flex bg-white border rounded-full p-1` — buttons `px-4 py-1.5 rounded-full text-[12px] font-semibold`, active ("Kanban") `bg-[#172B4D] text-white`, idle `text-[#6B778C]`; views: **Kanban / List / Calendar / Analytics** (no switching logic — ⚠️ only Kanban content exists).
- Next to it: pill `text-[12px] bg-[#E3F2FD] text-[#0052CC] px-3 py-1 rounded-full font-bold` **"Conversion 68%"**
- Right: two selects `h-9 border rounded-xl px-3 text-[12px] bg-white`:
  - options **All Stores** / **Thika Road**
  - single option **Sales Person**

### 6.2 Kanban board — `grid grid-cols-5 gap-3 overflow-auto pb-2`
Column: `bg-[#F4F5F7] rounded-2xl border min-w-[220px]`:
- header `p-3 flex justify-between items-center`: title `font-semibold text-[13px] flex items-center gap-2` with dot `w-2 h-2 rounded-full` colored by column color; count pill `text-[11px] bg-white border px-2 py-0.5 rounded-full font-bold`
- body `p-2 space-y-2 min-h-[420px]`: deal cards filtered by `col`.

**Stages (5, verbatim):**

| id | title | count | color |
|---|---|---|---|
| q | Quotation | 12 | #DFE1E6 |
| p | Proforma | 5 | #0052CC |
| so | Sales Order | 8 | #FFAB00 |
| inv | Invoiced | 20 | #00C853 |
| paid | Paid | 34 | #172B4D |

**Deals (6, verbatim):**

| id | col | customer | amount | age | items | assignee |
|---|---|---|---|---|---|---|
| 1 | q | Kamau Hardware | 45000 | 2d ago | 3 | M |
| 2 | q | Thika Builders | 125000 | 5h ago | 12 | J |
| 3 | p | Wanjiku Homes | 78000 | 1d ago | 5 | G |
| 4 | so | Kiambu Estate | 230000 | 3d ago | 22 | M |
| 5 | inv | John Kamau | 12500 | Today | 2 | J |
| 6 | paid | Otieno & Sons | 56000 | Today | 4 | M |

Deal card: `<button class="w-full text-left bg-white rounded-xl border p-3 shadow-sm hover:shadow-md" onClick={openDrawer(deal)}>`:
- row: customer `font-semibold text-[13px]` + age `text-[10px] text-[#6B778C]`
- amount `text-[13px] font-bold mt-1` "KES "+toLocaleString
- meta `flex items-center gap-2 mt-2 text-[11px] text-[#6B778C]` (Box icon 12): `{items} items • Assignee {assignee}`
- progress `mt-2 h-1 bg-[#F4F5F7] rounded-full` fill `bg-[#0052CC]` width `{20 + deal.id * 12}%`
Quotation column extra: dashed box `h-24 rounded-xl border border-dashed flex items-center justify-center text-[11px] text-[#6B778C]` **"+10 more"**.

### 6.3 Deal detail drawer (`selectedDeal`, 420px right drawer)
- header: h3 (Sora) `{deal.customer}` + X close `w-8 h-8 rounded-full border`
- **Timeline** `mt-6 relative pl-6 border-l-2 border-[#DFE1E6] space-y-6`; stages array (verbatim): ["Quotation Created", "Proforma Sent", "Sales Order Confirmed", "Invoiced", "Paid"]; each item: circle `absolute -left-[29px] top-0 w-5 h-5 rounded-full flex items-center justify-center` — index ≤ 2 → `bg-[#00C853] text-white`, else `bg-[#DFE1E6] text-[#6B778C]` — containing **Check** 12; title `text-[13px] font-semibold`; sub `text-[11px] text-[#6B778C]`: `Created by Mary • Sent via WhatsApp {index}h ago`
- **Items** block `mt-8`: h4 "Items"; bordered box `rounded-xl border overflow-hidden text-[12px]`; header `grid grid-cols-4 bg-[#FAFBFC] p-2 font-semibold`: Item/Qty/Price/Total; one row `p-2 flex justify-between`: **Cement / 10 / 1,250 / 12,500 (bold)**
- Footer `mt-6 flex gap-2`: **"Convert to Proforma"** `flex-1 h-10 rounded-xl bg-[#0052CC] text-white font-semibold text-sm`; **"Duplicate"** `h-10 px-4 rounded-xl border text-sm` (no handlers)

---

## 7. SCREEN: `inventory`

**Root:** one card `bg-white rounded-2xl border overflow-hidden`.

### 7.1 Toolbar `p-4 border-b flex flex-wrap gap-2 justify-between`
- Left tabs (state `inventoryTab`, default **"All Items"**): ["All Items","Low Stock","Transfers","Barcode Print"]; button `px-4 py-2 rounded-full text-[12px] font-semibold border`; active `bg-[#172B4D] text-white border-[#172B4D]`, idle `bg-[#F4F5F7] border-[#DFE1E6] text-[#6B778C]`; label suffix: Low Stock renders **"(23)"**. No content switch — same table for all tabs.
- Right store pills (buttons, no state): ["All Stores","Thika Road (450k)","Kiambu (320k)"] — `px-3 py-1.5 rounded-full text-[11px] border border-[#DFE1E6] bg-[#FAFBFC] font-semibold`.

### 7.2 Stock table
Columns: [checkbox] / Item / Category / Barcode / Thika / Kiambu / Total / Sell Price / Margin / Status.
Row (click → `setSelectedProduct(p)`, `cursor-pointer`):
- checkbox (stopPropagation on click)
- Item: `w-8 h-8 rounded-lg bg-[#F4F5F7]` emoji tile + name `font-semibold` + sku `text-[11px] font-mono text-[#6B778C]`
- Category: `{cat}`
- Barcode: literal **"123456789"** `font-mono text-[11px]` (same for every row)
- Thika: `{stock}`
- Kiambu: `Math.max(0, stock - 10)`
- Total: `stock * 2 - 10` (font-bold)
- Sell Price: "KES "+toLocaleString
- Margin: **"32%"** `text-[#00C853] font-bold` (hardcoded for all rows)
- Status pill `px-2 py-1 rounded-full text-[11px] font-bold`: stock 0 or <5 → `bg-[#FFEBEE] text-[#C62828]`; 0 renders **"Out"**, else **"In Stock"** (`bg-[#E8F5E9] text-[#2E7D32]`).

(Uses the same 8-product master list as POS.)

### 7.3 Product drawer (`selectedProduct`, 380px right drawer)
- header: h3 `{product.name}` + X `w-7 h-7 rounded-full border`
- hero `mt-4 h-[160px] bg-[#F4F5F7] rounded-xl flex items-center justify-center text-4xl` → emoji
- `mt-4 grid grid-cols-2 gap-3 text-[12px]`:
  - **Thika Road** tile (`bg-[#FAFBFC] border rounded-xl p-3`): value `{stock} units` `font-bold text-[14px]` + bar `h-1 bg-[#DFE1E6] rounded-full mt-2` fill `bg-[#0052CC] w-[70%]` (static)
  - **Kiambu** tile: `{Math.max(0, stock-10)} units`
- **Barcode + QR** card `mt-4 p-3 rounded-xl border`: title `font-semibold text-sm flex items-center gap-2` (Gift 14) "Barcode + QR"; mock barcode `mt-2 h-[72px] bg-[#172B4D] rounded-lg flex items-center justify-center gap-1` with white bars `w-1 h-8`, `w-0.5 h-8`, `w-1.5 h-8`, `w-0.5 h-8`

⚠️ The "Transfers" tab has no transfer UI/data in the prototype (placeholder only). Inventory-transfer module: NOT-IN-PROTOTYPE beyond the tab label and dashboard "Transfer" quick action.

---

## 8. SCREEN: `customers`

State `customersTab` (default **"Customers"**) and `selectedCustomerDetail` (null → list view). Sub-view rendering: if a customer is selected, the **detail view replaces everything**.

### 8.1 List view
**KPI row** `grid grid-cols-3 gap-4`:
1. white card — label `text-[11px] uppercase tracking-widest text-[#6B778C]` "TOTAL CUSTOMERS"; value `text-[22px] font-bold mt-1` **2,450**
2. `bg-[#FFF8E1] rounded-2xl border border-[#FFE082] p-5` — label `text-[#8B6D00]` "GOLD TIER"; value **120**
3. `bg-[#FFEBEE] rounded-2xl border border-[#FFCDD2] p-5` — label `text-[#C62828]` "DEBTORS"; value **45** `text-[#C62828]`

**Tab bar**: pill container `bg-white rounded-2xl border p-2 flex gap-2 w-fit`; buttons `px-4 py-2 rounded-xl text-[13px] font-semibold`, active `bg-[#172B4D] text-white`, idle `text-[#6B778C]`: **Customers / Loyalty Program / Gift Cards / Price Groups**. ("Price Groups" renders **nothing** — empty tab.)

**Customers table** (tab "Customers") — columns: Customer / Phone / Tier / Spent / Points / Debt / Gift Card / Last Visit / (eye).
Row (click → open detail): avatar `w-8 h-8 rounded-full bg-[#172B4D] text-white text-[11px] font-bold` initial + name; phone `text-[#0052CC]`; tier badge (standard trio); Spent "KES "+toLocaleString; Points plain; Debt `font-bold` — `KES {debt}` in `text-[#FF5630]` when >0 else "-"; Gift Card "KES "+gift; Last Visit muted; **Eye** 16 muted.

**Customer master list (4, verbatim):**

| id | name | phone | tier | spent | points | debt | gift | last |
|---|---|---|---|---|---|---|---|---|
| 1 | John Kamau | 0712 345 678 | Gold | 125000 | 420 | 2000 | 1000 | 2 days ago |
| 2 | Wanjiku Mwangi | 0722 111 222 | Silver | 54000 | 120 | 0 | 0 | Today |
| 3 | Otieno Ochieng | 0700 999 888 | Bronze | 12000 | 20 | 4500 | 500 | 5 days ago |
| 4 | Achieng Atieno | 0745 333 444 | Gold | 320000 | 1200 | 0 | 5000 | 1 day ago |

### 8.2 Customer detail view (click a row)
- Back button `flex items-center gap-2 text-sm font-semibold` (ChevronLeft 16) **"Back to Customers"** → clear selection.
- **Header card** `bg-white rounded-2xl border p-6 flex gap-6`: avatar `w-16 h-16 rounded-2xl bg-[#172B4D] text-white font-bold text-xl` initials; right: name h2 `text-[20px] font-bold` Sora + tier badge `px-3 py-1 rounded-full bg-[#FFF8E1] text-[#8B6D00] text-[11px] font-bold`; **Edit** button `ml-auto px-4 h-9 rounded-xl border text-sm flex items-center gap-2` (SquarePen 14, no handler); sub `text-sm text-[#6B778C] mt-1`: `{phone} • Last visit {last}`.
- **6 stat tiles** `grid grid-cols-6 gap-3 mt-5` (`rounded-xl border p-3`; debt tile red `bg-[#FFEBEE] border-[#FFCDD2]`, others `bg-[#FAFBFC] border-[#DFE1E6]`; label `text-[11px] text-[#6B778C] uppercase`; value `font-bold mt-1` red when debt):
  1. Total Spent — `KES {spent.toLocaleString()}`
  2. Visits — **24** (hardcoded)
  3. Avg Basket — **KES 5,200** (hardcoded)
  4. Debt — `KES {debt}` (red)
  5. Points — `{points}`
  6. Gift Card — `KES {gift}`
- **Sub-tabs** `bg-white rounded-2xl border p-2 flex gap-2 w-fit`: Overview (active navy) / Purchases / Debt Plans / Loyalty History / Gift Cards / Messages — only Overview has content.
- **Overview**: card h4 **"Spend • Last 6 Months"**; bars `flex items-end gap-2 h-[96px]`: values **[30,45,60,40,80,65]** → `flex-1 bg-[#0052CC] rounded-t-lg` height `{v}%`; labels `flex justify-between text-[11px] text-[#6B778C] mt-2`: Apr May Jun Jul Aug Sep.

### 8.3 Loyalty Program tab — `grid grid-cols-12 gap-4`
**Left (col-span-8) "Visual Rule Builder"** card (h4 Sora):
- Rule row 1: `rounded-xl bg-[#FAFBFC] border p-4 flex flex-wrap items-center gap-2 text-sm`: "Give" + token `px-3 py-1 bg-white border rounded-full font-bold` **"1"** + "point for every" + token **"[100] KES"** + "spent"
- Rule row 2 (mt-3): "1 point =" + token **"[1] KES"** + "when redeemed"
- **Tier Builder** (`mt-6`, h5 `font-semibold text-sm mb-3`): table `rounded-xl border overflow-hidden`; header `grid grid-cols-5 bg-[#FAFBFC] p-2 text-[11px] font-bold uppercase tracking-widest text-[#6B778C]`: Name / Min Points / Discount / Perk / Color; rows `grid grid-cols-5 p-3 text-[13px] border-t border-[#F4F5F7]` with color dot `w-5 h-5 rounded-full inline-block`:

  | Name | Min Points | Discount | Perk | Color |
  |---|---|---|---|---|
  | Bronze | 0 | 0% | Welcome | #8D6E63 |
  | Silver | 500 | 5% | Free Delivery | #78909C |
  | Gold | 2000 | 10% | Priority + Birthday | #FFD700 |

**Right (col-span-4) "Expiry"** card: h4 "Expiry"; row `mt-3 flex items-center justify-between p-3 rounded-xl bg-[#FAFBFC] border`: text `text-[13px]` **"Points expire after 12 months"** + toggle (ON): `w-10 h-6 rounded-full bg-[#00C853] p-0.5 flex justify-end` knob `w-5 h-5 bg-white rounded-full` (no handler).

### 8.4 Gift Cards tab — `grid grid-cols-3 gap-4`
Six cards, index i = 1..6 (`rounded-2xl overflow-hidden border shadow-sm`), all with `background: linear-gradient(135deg,#0052CC 0%,#00C853 100%)`; inner `p-5 text-white`:
- top row: `<Logo variant="white" size={18}/>` + **Gift** icon 18
- value `text-[28px] font-bold mt-6` Sora: **"KES 5,000"** (all six)
- code `text-[11px] opacity-80 mt-1 font-mono`: `GC-123{i} • Exp 12/26`
- status chip `mt-3 inline-block px-2 py-1 rounded-full bg-white/20 text-[10px] font-bold`:
  i%3===0 → **"Redeemed"**; else i%2===0 → **"Active"**; else **"Expired"**
  ⇒ i=1 Expired, i=2 Active, i=3 Redeemed, i=4 Active, i=5 Expired, i=6 Redeemed.

---

## 9. SCREEN: `debts`

State `debtsTab` (default **"Debtors"**).

**Toggle** `flex gap-2 bg-white border rounded-full p-1 w-fit`; buttons `px-5 py-2 rounded-full text-[13px] font-semibold`, active `bg-[#172B4D] text-white`, idle `text-[#6B778C]`:
- **"Debtors • Customers Owe Us"**
- **"Creditors • We Owe Suppliers"**

### 9.1 Debtors (fragment of: filter chips → table → summary cards)
- Chips `flex gap-2` — `px-4 py-2 rounded-full text-[12px] font-semibold border`; **"Overdue (18)"** always styled `bg-[#FFEBEE] border-[#FFCDD2] text-[#C62828]`, others `bg-white border-[#DFE1E6] text-[#6B778C]`: **All Debts / Overdue (18) / Payment Plans / Aging Report** (no filtering logic).
- **Debtors table** (`bg-white rounded-2xl border overflow-hidden`, text-[12px]) — columns: Customer / Invoice / Balance / Due Date / Overdue / Plan / Progress / Actions:

  | name | inv | bal | due | over | plan |
  |---|---|---|---|---|---|
  | John Kamau | INV-2847 | 6000 | 12 Sep | 5 | Weekly 2k |
  | Otieno Ochieng | INV-2810 | 4500 | 10 Sep | 7 | Monthly 5k |
  | Chebet R. | INV-2799 | 12000 | 05 Sep | 12 | Weekly 3k |

  Row: avatar `w-7 h-7 rounded-full bg-[#DFE1E6] font-bold text-[11px]` initial + name; invoice `font-mono`; balance `font-bold` toLocaleString; overdue pill `px-2 py-1 rounded-full bg-[#FFEBEE] text-[#C62828] font-bold text-[11px]` `{over} days`; progress `w-20 h-1.5 bg-[#F4F5F7] rounded-full` fill `bg-[#0052CC] w-[60%]` (same all rows); actions: **"View"** `px-2 py-1 rounded-full border text-[11px]` + **"Add Payment"** `px-2 py-1 rounded-full bg-[#0052CC] text-white text-[11px]` (no handlers).
- **Summary cards** `grid grid-cols-3 gap-4`:
  1. white — label `text-[11px] uppercase text-[#6B778C]` "TOTAL TO COLLECT"; value `text-[20px] font-bold text-[#00C853]` **"KES 450k"**
  2. white — "TOTAL TO PAY"; value `text-[#FF5630]` **"KES 210k"**
  3. navy `bg-[#172B4D] rounded-2xl p-5 text-white` — label `text-white/60` "NET CASHFLOW"; value **"KES +240k"**

⚠️ Payment-plan **builder** UI (schedules, auto-SMS / auto-block toggles) is NOT-IN-PROTOTYPE — only the "Payment Plans" chip exists.

### 9.2 Creditors
Table (`text-[13px]`) — columns Supplier / Bill No / Amount / Balance / Due / (action). One row:
- avatar `w-8 h-8 rounded-full bg-[#0052CC] text-white font-bold` "B" + **"Bamburi Cement"**
- Bill No **"BILL-001"**; Amount **"KES 120k"**; Balance **"KES 80k"** `text-[#FF5630] font-bold`; Due **"15 Sep"**
- Action: **"Pay M-Pesa"** `px-3 py-1 rounded-full bg-[#00C853] text-white text-[11px]` (no handler)

---

## 10. SCREEN: `receipts`

**Root:** `grid grid-cols-12 gap-6`.
**Print gallery:** `col-span-12 lg:col-span-9 grid grid-cols-1 md:grid-cols-3 gap-5` — three preview cards (`bg-white rounded-2xl border p-4 shadow-sm`), each with kicker label `text-[11px] uppercase tracking-widest font-bold text-[#6B778C] mb-3`.

### 10.1 "80MM THERMAL"
Paper: `bg-white border rounded-xl overflow-hidden mx-auto max-w-[260px] relative`; **zig-zag tear top** `h-3 bg-[#F4F5F7]` with `clipPath: polygon(0 0,5% 100%,10% 0,15% 100%,20% 0,25% 100%,30% 0,35% 100%,40% 0,45% 100%,50% 0,55% 100%,60% 0,65% 100%,70% 0,75% 100%,80% 0,85% 100%,90% 0,95% 100%,100% 0)`.
Body `p-4 font-mono text-[11px] leading-[1.3]`, exact content:
1. centered `<Logo variant="full" size={18}/>`
2. centered: **"PIN P051234567A"**
3. centered: **"Thika Road • 0712 345 678"**
4. dashed divider (`border-t border-dashed border-[#DFE1E6] my-2`)
5. **"Receipt: INV-001 • 12 Sep 2026 14:32"**
6. **"Customer: John Kamau GOLD"**
7. dashed divider
8. row: "Cement x4" / "5,000"
9. row `text-[#0052CC]`: "Discount GOLD10" / "-500"
10. dashed divider
11. row `flex justify-between font-bold text-[13px]`: **"TOTAL"** / **"KES 12,450"**
12. `mt-1`: **"Payment: M-Pesa • Loyalty Earned 50 pts | Bal 400"**
13. QR block `mt-3 border rounded-lg p-2 flex flex-col items-center`: QrCode 48 + `text-[9px] text-center mt-1` **"KRA Verification QR - CU: KRAMW004..."**
14. `text-center text-[#FF5630] font-bold mt-3`: **"Thank You! You saved KES 300!"**

### 10.2 "A4 COLORED INVOICE"
Doc `border rounded-xl overflow-hidden`:
- Blue header `bg-[#0052CC] p-4 text-white flex justify-between items-center`: `<Logo variant="white" size={20}/>` + `text-[11px] font-bold` **"TAX INVOICE"**
- Body `p-4 text-[11px] space-y-2`:
  - `grid grid-cols-2 gap-3`: **From** box (`border rounded-lg p-2`): "From" bold / "DukaFlow Ltd • PIN P051..." / "Thika Road, Nairobi" — **Bill To** box: "Bill To" bold / "John Kamau GOLD" / "0712 345 678"
  - Items table `border rounded-lg overflow-hidden`: header `grid grid-cols-4 bg-[#F4F5F7] p-2 font-bold` Item/Qty/Price/Total; row 1 `grid grid-cols-4 p-2`: Cement / 4 / 1,250 / **5,000**; row 2 `bg-[#FAFBFC]`: Paint / 2 / 3,450 / **6,900**
  - Totals right-aligned `flex justify-end` → `w-[140px] space-y-1`: "Subtotal" / "11,900"; `font-bold text-[13px]` "TOTAL" / **"KES 12,450"**
  - bottom row `flex justify-between items-end`: left `text-[10px] text-[#6B778C]`: "M-Pesa Till 123456" + "Bank: Equity 1234567890"; right: `border rounded-lg p-1` with QrCode 32
- Gray footer `bg-[#F4F5F7] p-2 text-center text-[10px] text-[#6B778C]`: **"Sell Smart. Stock Smart. • Thank You!"**

### 10.3 "GIFT CARD • 336×210"
Card `rounded-[16px] overflow-hidden shadow-lg mx-auto max-w-[320px] aspect-[1.6/1] p-5 text-white flex flex-col justify-between` with `background: linear-gradient(135deg,#0052CC 0%,#00C853 100%)`:
- top row: `<Logo variant="white" size={16}/>` + chip `text-[10px] bg-white/20 px-2 py-1 rounded-full` **"GIFT CARD"**
- middle: `text-[26px] font-bold` Sora **"KES 5,000"**; `text-[11px] opacity-80 font-mono` **"GC-1234 • Exp 12/26"**
- bottom row: `text-[10px]` "DukaFlow • Thika Road" + `w-10 h-10 bg-white rounded-lg flex items-center justify-center` QrCode 20 `text-[#172B4D]`
- Note box below card: `mt-4 p-3 rounded-xl bg-[#FAFBFC] border text-[11px] text-[#6B778C]` — **"Pattern: subtle dots + barcode texture. QR white on blue."**

### 10.4 Right rail — "Customization" (`col-span-12 lg:col-span-3 bg-white rounded-2xl border p-5 h-fit`)
h4 (Sora) **"Customization"**; `mt-4 space-y-4`:
1. **Upload Logo** — label `text-[11px] font-semibold`; dropzone `mt-1 h-10 rounded-xl border border-dashed border-[#DFE1E6] flex items-center justify-center text-[12px] text-[#6B778C]` → "Drop logo or click"
2. **Primary Color** — swatch `w-8 h-8 rounded-full` `#0052CC` + input `flex-1 h-9 border rounded-xl px-3 text-sm` `defaultValue "#0052CC"`
3. **Secondary** — swatch `#00C853` + input `defaultValue "#00C853"`
4. **Footer Promo Text** — textarea `mt-1 w-full h-20 border rounded-xl p-3 text-sm`, `defaultValue`: "Thank You! You saved KES 300 with points! Come again!"
5. Button `w-full h-10 rounded-xl bg-[#0052CC] text-white font-semibold text-sm` → **"Save & Preview Live"** (no handler)

---

## 11. SCREEN: `payroll`

**Root:** one card `bg-white rounded-2xl border overflow-hidden`.

### 11.1 Header `p-4 border-b flex justify-between items-center`
- Left `flex items-center gap-3`: span `text-sm font-semibold` **"Month"**; select `h-9 border rounded-xl px-3 text-sm bg-white` (single option **"Sep 2026"**); Draft badge `px-3 py-1 rounded-full bg-[#FFF8E1] text-[#8B6D00] text-[11px] font-bold` **"Draft"**
- Right: button `h-9 px-4 rounded-xl bg-[#0052CC] text-white text-sm font-semibold` **"Create Payroll Entry"** (no handler)

### 11.2 Payroll table (`overflow-auto`, text-[12px])
Columns: [checkbox] / Staff / ID No / Dept / Basic / Gross / NSSF / SHIF 2.75% / Housing 1.5% / PAYE / Net Pay / (action).

**Employees (3, verbatim):**

| name | idNo | dept | basic | gross | net |
|---|---|---|---|---|---|
| Mary Wanjiku | 12345678 | Sales | 30000 | 35000 | 29000 |
| James Otieno | 23456789 | Store | 25000 | 28000 | 24000 |
| Grace Akinyi | 34567890 | Cashier | 22000 | 25000 | 21000 |

Row rendering: initials avatar `w-7 h-7 rounded-full bg-[#DFE1E6] font-bold text-[11px]`; ID No `font-mono`; Basic/Gross "KES "+toLocaleString; **NSSF / SHIF / Housing / PAYE cells are hardcoded strings for every row: "360", "962", "525", "3,200"** (note: 962 ≈ 2.75% of 35,000; 525 = 1.5% of 35,000 — derived from row 1's gross but not recomputed); Net Pay `font-bold` toLocaleString; action **"View Payslip"** `px-3 py-1 rounded-full border text-[11px]` (no handler; no payslip modal in prototype).

### 11.3 Footer chips `p-3 bg-[#FAFBFC] border-t flex gap-2`
Buttons `px-4 py-2 rounded-full bg-white border border-[#DFE1E6] text-[12px] font-semibold` (no handlers): **Attendance / Leave / Advances & Loans**

⚠️ A standalone payroll *calculator* form (editable NSSF/SHIF/PAYE inputs) is NOT-IN-PROTOTYPE; the rates exist only as the table columns above. Statutory rates to encode: **NSSF 360 (Tier 1) / 720 implied Tier-2 cap, SHIF 2.75% of gross, Housing Levy 1.5% of gross, PAYE (band-based)**.

---

## 12. SCREEN: `messages` (SMS / WhatsApp blast)

**Root:** `grid grid-cols-12 gap-4 min-h-[640px]`.

### 12.1 Campaigns (col-span-5 card, `overflow-hidden`)
- Header `p-4 border-b flex justify-between`: h4 `font-semibold text-sm` **"Campaigns"**; button `px-3 py-1 rounded-full bg-[#0052CC] text-white text-[11px] font-bold` **"+ New"** (no handler)
- Table (text-[12px]) columns: Name / Type / Audience / Sent / Cost.

**Campaigns (3, verbatim):**

| name | type | audience | sent | cost |
|---|---|---|---|---|
| Birthday Offer | SMS | All Gold (120) | 1,200 | KES 1,500 |
| Debt Reminder | WhatsApp | Has Debt (45) | 45 | KES 90 |
| Promo Cement | SMS | All (2,450) | 2,400 | KES 3,200 |

Type badge `px-2 py-1 rounded-full text-[10px] font-bold`: SMS → `bg-[#E3F2FD] text-[#0D47A1]`; WhatsApp → `bg-[#E8F5E9] text-[#2E7D32]`. Rows `hover:bg-[#FAFBFC]`.

### 12.2 Compose (col-span-7 card p-5)
- h4 `font-semibold text-sm mb-4` **"Compose"**
- `grid grid-cols-2 gap-3` selects (`h-10 border rounded-xl px-3 text-sm bg-white`):
  - **To:** options — "To: All Customers" / "Gold Tier" / "Has Debt" / "Birthday Today" / "Bought Last 7 Days"
  - **Template:** options — "Template: Debt Reminder" / "Birthday Offer" / "Promo" / "Receipt"
- `mt-4 grid grid-cols-12 gap-4`:
  - Left (col-span-7): textarea `w-full h-[180px] border rounded-xl p-3 text-sm`, `defaultValue` (verbatim):
    `Hi {customer_name}, you have {points_balance} points (KES {points_balance}) and debt KES {debt_balance}. Visit {shop_name} Thika Road today! Gold members get 10% off cement.`
    - meta row `mt-2 flex justify-between text-[11px] text-[#6B778C]`: **"120/160 chars • 1 segment"** / **"Cost est KES 1,500"**
    - buttons `mt-4 flex gap-2`: **"Send Now"** `flex-1 h-10 rounded-xl bg-[#00C853] text-white font-bold text-sm`; **"Schedule"** `flex-1 h-10 rounded-xl border font-semibold text-sm` (no handlers)
  - Right (col-span-5) **iPhone preview**: `w-[200px] h-[400px] rounded-[32px] border-[8px] border-[#172B4D] bg-white overflow-hidden shadow-xl`; notch bar `h-6 bg-[#172B4D]`; body `p-3`: bubble `bg-[#E3F2FD] rounded-2xl rounded-bl-sm p-3 text-[12px] leading-[1.4]` (merged/preview text, verbatim):
    `Hi John, you have 420 points (KES 420) and debt KES 2,000. Visit DukaFlow Thika Road today! Gold members get 10% off cement.`
    + status `text-[10px] text-[#6B778C] mt-2 text-center`: **"Delivered • 14:32"**

---

## 13. SCREEN: `chat` (Raven Chat)

**Root:** one card `bg-white rounded-2xl border overflow-hidden flex min-h-[640px]` — **three panes**.

### 13.1 Left rail — `w-[240px] bg-[#172B4D] text-white p-4 space-y-6`
- **Channels** (label `text-[11px] uppercase tracking-widest text-white/50 font-bold mb-2`); list `space-y-1 text-[13px]`; item `flex justify-between px-2 py-1.5 rounded-lg`; active channel (`# stock-alerts`) gets `bg-white/10`:

  `# general`, `# thika-road`, `# kiambu-store`, `# managers-only`, `# stock-alerts` (+red badge `bg-[#FF5630] text-white text-[10px] px-1.5 rounded-full` **"3"**), `# deliveries`

- **DMs**: staff list (same 3 staff objects) — row `flex items-center gap-2`: dot `w-2 h-2 rounded-full` `bg-[#00C853]` online else `bg-white/30` + name. (Mary Wanjiku, James Otieno, Grace Akinyi.)

### 13.2 Center — `flex-1 flex flex-col`
- Channel header `h-12 border-b flex items-center px-4 justify-between`: `font-semibold text-sm` **"# thika-road • 12 members"**; right `text-[11px] text-[#6B778C]` **"Raven • In-house Chat"**
- Messages `flex-1 p-4 space-y-4 overflow-auto bg-[#FAFBFC]`:
  - date divider: centered pill `text-[11px] bg-white border px-3 py-1 rounded-full` **"Today • Sep 12"**
  - Message row `flex gap-3`: avatar `w-8 h-8 rounded-full bg-[#172B4D] text-white text-[11px] font-bold` (initials); content:
    - name line `text-[13px] font-semibold flex items-center gap-2`: name + time `text-[11px] text-[#6B778C] font-normal`
    - bubble `text-[13px] mt-1 bg-white border border-[#DFE1E6] rounded-xl rounded-tl-sm p-3 max-w-[520px]`
    - (if `doc`) **ERP doc card** `mt-2 max-w-[360px] border border-[#0052CC]/20 bg-[#E3F2FD] rounded-xl p-3 flex items-center gap-3`: icon tile `w-10 h-10 rounded-lg bg-[#0052CC] text-white flex items-center justify-center` (Receipt 16); text ["Sales Invoice INV-001" `text-[12px] font-bold`, "KES 5,000 • John • View" `text-[11px] text-[#6B778C]`]; **"View"** button `px-3 py-1 rounded-full bg-white border text-[11px] font-bold`
    - footer `flex items-center gap-2 mt-2`: reaction pill `text-[11px] bg-white border px-2 py-0.5 rounded-full` **"😀 2"**; thread link `text-[11px] text-[#0052CC]` **"3 replies • Reply in thread"**

**Messages (3, verbatim):**

| name | time | text | doc |
|---|---|---|---|
| Mary Wanjiku | 09:12 | Morning team! Cement stock low in Thika — 3 bags left. Need transfer from Kiambu. | — |
| James Otieno | 09:15 | On it. Transferring 20 bags now. ETA 45 mins. | true |
| Grace Akinyi | 09:18 | Customer John Kamau asking for credit extension. Debt KES 2k overdue 5 days. Block at POS? | — |

(Avatars "MW", "JO", "GA". Every message row renders the 😀 2 reaction + "3 replies • Reply in thread".)

- Composer `p-3 border-t flex gap-2`: input `flex-1 h-10 border rounded-xl px-3 text-sm bg-[#FAFBFC]` placeholder **"Message # thika-road…  Use @ to mention, / to share ERP doc"**; send button `h-10 px-4 rounded-xl bg-[#0052CC] text-white` (Send 16, no handler).

### 13.3 Right rail — `w-[320px] border-l bg-white p-4 hidden xl:block`
- h4 `font-semibold text-sm` **"Thread"**
- p `text-[12px] text-[#6B778C] mt-2` **"3 replies in thread • Cement transfer"**
- `mt-4 space-y-3 text-[13px]`:
  - bubble `bg-[#F4F5F7] rounded-xl p-3`: **"We need to update price for Bamburi? Buying 1100, selling 1250 margin low."**
  - bubble `bg-white border rounded-xl p-3`: **"Margin 13% — keep for Gold discount 10% still profit."**

---

## 14. SCREEN: `reports`

**Root:** `grid grid-cols-3 gap-4` — **8 report cards** (`bg-white rounded-2xl border p-5 shadow-sm hover:shadow-md`).

Card anatomy: top row [`w-9 h-9 rounded-xl bg-[#F4F5F7] flex items-center justify-center` with **ChartColumn** 16 `text-[#0052CC]`] + [`text-[11px] text-[#6B778C]` **"Last updated 2h ago"**]; title `font-bold mt-4 text-[14px]` Sora; desc `text-[12px] text-[#6B778C]`; mini chart `mt-4 h-[56px] flex items-end gap-[3px]` — bars `[20,35,50,30,70,45,60,80]`, `flex-1 rounded-sm`, `height: {v}%`, alternating `bg-[#0052CC]` (even index) / `bg-[#00C853]/70` (odd). (All cards use the same bar mock; `chart` field below is metadata only.)

| # | title | desc | chart |
|---|---|---|---|
| 1 | Sales by Store | Thika vs Kiambu | bars |
| 2 | Profit & Loss | Gross, Expenses, Net | line |
| 3 | Stock Aging | 0-30, 31-60, 60+ days | bars |
| 4 | Debtor Aging | Aging buckets + overdue | bars |
| 5 | Loyalty Redemption | Points earned vs used | donut |
| 6 | Staff Performance | Sales per staff | bars |
| 7 | KRA eTIMS Submissions | Verified vs Pending | line |
| 8 | M-Pesa Reconciliation | Till vs System | line |

No drill-downs wired (cards are static).

---

## 15. SCREEN: `settings`

**Root:** `grid grid-cols-12 gap-4 min-h-[640px]`.

### 15.1 Left nav (col-span-3 card `p-2`)
Buttons `w-full text-left px-3 py-2.5 rounded-xl text-[13px] font-semibold`; active ("KRA eTIMS Settings") `bg-[#172B4D] text-white`, idle `text-[#6B778C] hover:bg-[#F4F5F7]`. Items in order:
**Company / Stores & Warehouses / Users & Roles / POS Profiles / Print Formats / Taxes / KRA eTIMS Settings / M-Pesa Daraja / SMS Provider / Loyalty Rules / Backup & Restore**
(Only "KRA eTIMS Settings" has panel content; others render nothing.)

### 15.2 Right panel (col-span-9 card p-6) — KRA eTIMS Settings
- h3 `font-bold text-[16px]` Sora **"KRA eTIMS Settings"**; p `text-[12px] text-[#6B778C] mt-1` **"Configure eTIMS for compliant invoicing • CU Serial • Branch • Device"**
- Form `mt-6 grid grid-cols-2 gap-4 max-w-[560px]` (inputs `mt-1 w-full h-10 border border-[#DFE1E6] rounded-xl px-3 text-sm`; labels `text-[11px] font-semibold`):
  1. **KRA PIN** — `defaultValue: "P051234567A"`
  2. **Branch ID** — `defaultValue: "00"`
  3. **Device Serial** — `defaultValue: "KRA-DEVICE-001"`
  4. **Connection Status** (read-only display) — `mt-1 h-10 rounded-xl border bg-[#E8F5E9] flex items-center px-3 gap-2 text-[13px]`: pulsing green dot + **"Online • Last sync 2 min ago"**
  5. **Callback URL** (col-span-2) — `defaultValue: "https://api.dukaflow.co.ke/etims/callback"`
- Buttons `mt-6 flex gap-2`: **"Test Connection"** `h-10 px-5 rounded-xl bg-[#0052CC] text-white font-semibold text-sm`; **"Save"** `h-10 px-5 rounded-xl border font-semibold text-sm` (no handlers)

### 15.3 M-Pesa Daraja section (`mt-10 pt-6 border-t`)
- h4 `font-bold text-sm` **"M-Pesa Daraja"**
- Form `mt-4 grid grid-cols-2 gap-4 max-w-[560px]` (inputs here use bare `border` class):
  1. **Consumer Key** — `defaultValue: "••••••••••••"`
  2. **Consumer Secret** — `defaultValue: "••••••••••••"`
  3. **Till Numbers** — `defaultValue: "123456, 654321"`
  4. **Callback URL** — `defaultValue: "https://api.dukaflow.co.ke/mpesa/callback"`

---

## 16. SEED DATA MASTER LIST (TypeScript)

```ts
// ---------- Catalog ----------
export type Product = { id: number; name: string; sku: string; stock: number; price: number; cat: string; emoji: string };
export const PRODUCTS: Product[] = [
  { id: 1, name: "Bamburi Cement 50kg",        sku: "CMT-001", stock: 45,  price: 1250, cat: "Cement",     emoji: "🧱" },
  { id: 2, name: "Crown Paint Gloss White 4L", sku: "PNT-012", stock: 3,   price: 3450, cat: "Paint",      emoji: "🎨" },
  { id: 3, name: 'PVC Pipe 3/4" 6m',           sku: "PLB-033", stock: 120, price: 650,  cat: "Plumbing",   emoji: "🚿" },
  { id: 4, name: "Hammer 16oz Stanley",        sku: "TLS-009", stock: 0,   price: 1450, cat: "Tools",      emoji: "🔨" },
  { id: 5, name: "Electrical Cable 2.5mm",     sku: "ELC-021", stock: 67,  price: 890,  cat: "Electrical", emoji: "🔌" },
  { id: 6, name: "Gypsum Board 9mm",           sku: "CMT-014", stock: 22,  price: 950,  cat: "Cement",     emoji: "🧱" },
  { id: 7, name: "Dulux Vinyl Matt",           sku: "PNT-018", stock: 8,   price: 6200, cat: "Paint",      emoji: "🎨" },
  { id: 8, name: "Angle Valve Brass",          sku: "PLB-041", stock: 54,  price: 420,  cat: "Plumbing",   emoji: "🚰" },
];
export const PRODUCT_CATEGORIES = ["All", "Cement", "Paint", "Plumbing", "Tools", "Electrical"] as const;

// ---------- Dashboard ----------
export type SalesFeedRow = { time: string; receipt: string; customer: string; tier: "Gold"|"Silver"|"Bronze"; store: string; amount: number; pay: string; kra: "Verified"|"Pending" };
export const LIVE_SALES_FEED: SalesFeedRow[] = [
  { time: "14:32", receipt: "INV-2847", customer: "John Kamau",     tier: "Gold",   store: "Thika Road", amount: 12500, pay: "M-Pesa",    kra: "Verified" },
  { time: "14:28", receipt: "INV-2846", customer: "Wanjiku Mwangi", tier: "Silver", store: "Kiambu",     amount: 8900,  pay: "Cash",      kra: "Pending"  },
  { time: "14:15", receipt: "INV-2845", customer: "Otieno Ochieng", tier: "Bronze", store: "Thika Road", amount: 3450,  pay: "Till",      kra: "Verified" },
  { time: "14:02", receipt: "INV-2844", customer: "Achieng Atieno", tier: "Gold",   store: "Thika Road", amount: 45000, pay: "M-Pesa",    kra: "Verified" },
  { time: "13:55", receipt: "INV-2843", customer: "Mutiso K.",      tier: "Silver", store: "Kiambu",     amount: 1200,  pay: "Gift Card", kra: "Verified" },
  { time: "13:40", receipt: "INV-2842", customer: "Chebet R.",      tier: "Bronze", store: "Thika Road", amount: 5600,  pay: "Cash",      kra: "Pending"  },
];

export type Staff = { name: string; role: string; online: boolean; color: string };
export const STAFF: Staff[] = [
  { name: "Mary Wanjiku", role: "Cashier",      online: true,  color: "#0052CC" },
  { name: "James Otieno", role: "Store Keeper", online: true,  color: "#00C853" },
  { name: "Grace Akinyi", role: "Sales",        online: false, color: "#FF5630" },
];

// ---------- Pipeline ----------
export type Stage = { id: string; title: string; count: number; color: string };
export const PIPELINE_STAGES: Stage[] = [
  { id: "q",    title: "Quotation",   count: 12, color: "#DFE1E6" },
  { id: "p",    title: "Proforma",    count: 5,  color: "#0052CC" },
  { id: "so",   title: "Sales Order", count: 8,  color: "#FFAB00" },
  { id: "inv",  title: "Invoiced",    count: 20, color: "#00C853" },
  { id: "paid", title: "Paid",        count: 34, color: "#172B4D" },
];
export type Deal = { id: number; col: string; customer: string; amount: number; age: string; items: number; assignee: string };
export const DEALS: Deal[] = [
  { id: 1, col: "q",    customer: "Kamau Hardware", amount: 45000,  age: "2d ago", items: 3,  assignee: "M" },
  { id: 2, col: "q",    customer: "Thika Builders", amount: 125000, age: "5h ago", items: 12, assignee: "J" },
  { id: 3, col: "p",    customer: "Wanjiku Homes",  amount: 78000,  age: "1d ago", items: 5,  assignee: "G" },
  { id: 4, col: "so",   customer: "Kiambu Estate",  amount: 230000, age: "3d ago", items: 22, assignee: "M" },
  { id: 5, col: "inv",  customer: "John Kamau",     amount: 12500,  age: "Today",  items: 2,  assignee: "J" },
  { id: 6, col: "paid", customer: "Otieno & Sons",  amount: 56000,  age: "Today",  items: 4,  assignee: "M" },
];
export const DEAL_TIMELINE_STAGES = ["Quotation Created", "Proforma Sent", "Sales Order Confirmed", "Invoiced", "Paid"];
export const DEAL_SAMPLE_ITEM = { item: "Cement", qty: 10, price: "1,250", total: "12,500" };

// ---------- Customers / Loyalty ----------
export type Customer = { id: number; name: string; phone: string; tier: "Gold"|"Silver"|"Bronze"; spent: number; points: number; debt: number; gift: number; last: string };
export const CUSTOMERS: Customer[] = [
  { id: 1, name: "John Kamau",     phone: "0712 345 678", tier: "Gold",   spent: 125000, points: 420,  debt: 2000, gift: 1000, last: "2 days ago" },
  { id: 2, name: "Wanjiku Mwangi", phone: "0722 111 222", tier: "Silver", spent: 54000,  points: 120,  debt: 0,    gift: 0,    last: "Today"      },
  { id: 3, name: "Otieno Ochieng", phone: "0700 999 888", tier: "Bronze", spent: 12000,  points: 20,   debt: 4500, gift: 500,  last: "5 days ago" },
  { id: 4, name: "Achieng Atieno", phone: "0745 333 444", tier: "Gold",   spent: 320000, points: 1200, debt: 0,    gift: 5000, last: "1 day ago"  },
];
export const LOYALTY_RULES = {
  earn:   { points: 1, perKes: 100 },   // "Give 1 point for every [100] KES spent"
  redeem: { kesPerPoint: 1 },            // "1 point = [1] KES when redeemed"
  expiryMonths: 12, expiryToggleOn: true,
};
export const LOYALTY_TIERS = [
  { name: "Bronze", minPoints: 0,    discount: "0%",  perk: "Welcome",             color: "#8D6E63" },
  { name: "Silver", minPoints: 500,  discount: "5%",  perk: "Free Delivery",       color: "#78909C" },
  { name: "Gold",   minPoints: 2000, discount: "10%", perk: "Priority + Birthday", color: "#FFD700" },
];
// POS quick-pick customer (GOLD uppercase in this context)
export const POS_CUSTOMER = { name: "John Kamau", phone: "0712 345 678", tier: "GOLD", points: 420, debt: 2000, gift: 1000 };
// Gift-card wall (i = 1..6; value/code/status derived)
export const GIFT_CARD = { value: 5000, expiry: "12/26", codePrefix: "GC-123", gradient: "linear-gradient(135deg,#0052CC 0%,#00C853 100%)" };

// ---------- Debts ----------
export type Debtor = { name: string; inv: string; bal: number; due: string; over: number; plan: string };
export const DEBTORS: Debtor[] = [
  { name: "John Kamau",     inv: "INV-2847", bal: 6000,  due: "12 Sep", over: 5,  plan: "Weekly 2k"  },
  { name: "Otieno Ochieng", inv: "INV-2810", bal: 4500,  due: "10 Sep", over: 7,  plan: "Monthly 5k" },
  { name: "Chebet R.",      inv: "INV-2799", bal: 12000, due: "05 Sep", over: 12, plan: "Weekly 3k"  },
];
export const DEBT_SUMMARY = { toCollect: "KES 450k", toPay: "KES 210k", netCashflow: "KES +240k", overdueCount: 18 };
export const CREDITOR = { supplier: "Bamburi Cement", billNo: "BILL-001", amount: "KES 120k", balance: "KES 80k", due: "15 Sep", action: "Pay M-Pesa" };

// ---------- Receipts (print samples) ----------
export const RECEIPT_SAMPLE = {
  kraPin: "P051234567A", store: "Thika Road", storePhone: "0712 345 678",
  receiptNo: "INV-001", datetime: "12 Sep 2026 14:32",
  customer: "John Kamau GOLD",
  lines: [{ item: "Cement", qty: 4, amount: "5,000" }],
  discount: { label: "Discount GOLD10", amount: "-500" },
  total: "KES 12,450",
  payment: "M-Pesa", loyalty: "Loyalty Earned 50 pts | Bal 400",
  qrCaption: "KRA Verification QR - CU: KRAMW004...",
  promo: "Thank You! You saved KES 300!",
};
export const A4_INVOICE_SAMPLE = {
  from: { name: "DukaFlow Ltd", pin: "PIN P051...", address: "Thika Road, Nairobi" },
  billTo: { name: "John Kamau GOLD", phone: "0712 345 678" },
  lines: [
    { item: "Cement", qty: 4, price: "1,250", total: "5,000" },
    { item: "Paint",  qty: 2, price: "3,450", total: "6,900" },
  ],
  subtotal: "11,900", total: "KES 12,450",
  payFooter: ["M-Pesa Till 123456", "Bank: Equity 1234567890"],
  footer: "Sell Smart. Stock Smart. • Thank You!",
};
export const GIFT_CARD_PRINT = { size: "336×210", value: "KES 5,000", code: "GC-1234 • Exp 12/26", store: "DukaFlow • Thika Road" };
export const RECEIPT_SETTINGS = {
  primaryColor: "#0052CC", secondaryColor: "#00C853",
  footerPromo: "Thank You! You saved KES 300 with points! Come again!",
};

// ---------- Payroll ----------
export type Payslip = { name: string; idNo: string; dept: string; basic: number; gross: number; net: number };
export const PAYROLL_MONTH = "Sep 2026"; // status: Draft
export const PAYSLIPS: Payslip[] = [
  { name: "Mary Wanjiku", idNo: "12345678", dept: "Sales",   basic: 30000, gross: 35000, net: 29000 },
  { name: "James Otieno", idNo: "23456789", dept: "Store",   basic: 25000, gross: 28000, net: 24000 },
  { name: "Grace Akinyi", idNo: "34567890", dept: "Cashier", basic: 22000, gross: 25000, net: 21000 },
];
// Statutory columns are hardcoded per row in the prototype: NSSF "360", SHIF "962", Housing "525", PAYE "3,200".
export const PAYROLL_RATES = { nssfTier1: 360, nssfTier2Cap: 720, shifPct: 0.0275, housingPct: 0.015 };

// ---------- Messages ----------
export type Campaign = { name: string; type: "SMS"|"WhatsApp"; aud: string; sent: string; cost: string };
export const CAMPAIGNS: Campaign[] = [
  { name: "Birthday Offer", type: "SMS",      aud: "All Gold (120)", sent: "1,200", cost: "1,500" },
  { name: "Debt Reminder",  type: "WhatsApp", aud: "Has Debt (45)",  sent: "45",    cost: "90"    },
  { name: "Promo Cement",   type: "SMS",      aud: "All (2,450)",    sent: "2,400", cost: "3,200" },
];
export const SMS_AUDIENCES = ["To: All Customers", "Gold Tier", "Has Debt", "Birthday Today", "Bought Last 7 Days"];
export const SMS_TEMPLATES = ["Template: Debt Reminder", "Birthday Offer", "Promo", "Receipt"];
export const SMS_BODY_TEMPLATE =
  "Hi {customer_name}, you have {points_balance} points (KES {points_balance}) and debt KES {debt_balance}. Visit {shop_name} Thika Road today! Gold members get 10% off cement.";
export const SMS_PREVIEW = "Hi John, you have 420 points (KES 420) and debt KES 2,000. Visit DukaFlow Thika Road today! Gold members get 10% off cement.";
export const SMS_META = { chars: "120/160 chars • 1 segment", costEst: "Cost est KES 1,500", previewStatus: "Delivered • 14:32" };

// ---------- Chat ----------
export const CHANNELS = ["# general", "# thika-road", "# kiambu-store", "# managers-only", "# stock-alerts", "# deliveries"];
export const CHANNEL_BADGES = { "# stock-alerts": 3 };
export const ACTIVE_CHANNEL = { name: "# thika-road", members: 12, brand: "Raven • In-house Chat" };
export type ChatMsg = { name: string; time: string; text: string; avatar: string; doc?: boolean };
export const CHAT_MESSAGES: ChatMsg[] = [
  { name: "Mary Wanjiku", time: "09:12", text: "Morning team! Cement stock low in Thika — 3 bags left. Need transfer from Kiambu.", avatar: "MW" },
  { name: "James Otieno", time: "09:15", text: "On it. Transferring 20 bags now. ETA 45 mins.", avatar: "JO", doc: true },
  { name: "Grace Akinyi", time: "09:18", text: "Customer John Kamau asking for credit extension. Debt KES 2k overdue 5 days. Block at POS?", avatar: "GA" },
];
export const CHAT_DOC_CARD = { title: "Sales Invoice INV-001", sub: "KES 5,000 • John • View" };
export const CHAT_EXTRAS = { dateDivider: "Today • Sep 12", reaction: "😀 2", threadLink: "3 replies • Reply in thread",
  threadTitle: "Thread", threadSub: "3 replies in thread • Cement transfer",
  threadBubbles: ["We need to update price for Bamburi? Buying 1100, selling 1250 margin low.",
                  "Margin 13% — keep for Gold discount 10% still profit."],
  composerPlaceholder: "Message # thika-road…  Use @ to mention, / to share ERP doc" };

// ---------- Reports ----------
export const REPORTS = [
  { title: "Sales by Store",          desc: "Thika vs Kiambu",        chart: "bars"  },
  { title: "Profit & Loss",           desc: "Gross, Expenses, Net",   chart: "line"  },
  { title: "Stock Aging",             desc: "0-30, 31-60, 60+ days",  chart: "bars"  },
  { title: "Debtor Aging",            desc: "Aging buckets + overdue",chart: "bars"  },
  { title: "Loyalty Redemption",      desc: "Points earned vs used",  chart: "donut" },
  { title: "Staff Performance",       desc: "Sales per staff",        chart: "bars"  },
  { title: "KRA eTIMS Submissions",   desc: "Verified vs Pending",    chart: "line"  },
  { title: "M-Pesa Reconciliation",   desc: "Till vs System",         chart: "line"  },
] as const;
export const REPORT_MOCK_BARS = [20, 35, 50, 30, 70, 45, 60, 80];
export const REPORT_STAMP = "Last updated 2h ago";

// ---------- Settings ----------
export const KRA_ETIMS_SETTINGS = {
  pin: "P051234567A", branchId: "00", deviceSerial: "KRA-DEVICE-001",
  connection: "Online • Last sync 2 min ago",
  callbackUrl: "https://api.dukaflow.co.ke/etims/callback",
};
export const MPESA_DARAJA_SETTINGS = {
  consumerKey: "••••••••••••", consumerSecret: "••••••••••••",
  tillNumbers: "123456, 654321",
  callbackUrl: "https://api.dukaflow.co.ke/mpesa/callback",
};
export const SETTINGS_NAV = ["Company", "Stores & Warehouses", "Users & Roles", "POS Profiles", "Print Formats",
  "Taxes", "KRA eTIMS Settings", "M-Pesa Daraja", "SMS Provider", "Loyalty Rules", "Backup & Restore"];

// ---------- Stores / Chrome ----------
export const STORES = [
  { name: "Thika Road", location: "Nairobi", stock: "KES 450k", salesToday: "KES 124,500", active: true },
  { name: "Kiambu Road", location: "Kiambu", stock: "KES 320k", salesToday: "KES 89,300",  active: false },
];
export const STORE_SELECT_OPTIONS = ["Thika Road • Kiambu • All Stores", "Thika Road", "Kiambu"];
export const TOPBAR = { date: "Sep 12, 2026", avatar: "OK", status: "Online • KRA Connected",
  deviceCard: { app: "DukaFlow POS", sub: "Tablet v2.4 • Online", initials: "DF" } };
export const MPESA_TILL_CARD = { till: "123456 • DukaFlow", collected: "KES 89k collected today", pct: 78 };

// ---------- POS defaults & math ----------
export const DEFAULT_CART = [
  { id: 1, name: "Bamburi Cement 50kg", price: 1250, qty: 4, sku: "CMT-001", emoji: "🧱" },
  { id: 2, name: "Crown Paint White 4L", price: 3450, qty: 2, sku: "PNT-012", emoji: "🎨" },
  { id: 3, name: 'PVC Pipe 3/4"',       price: 650,  qty: 5, sku: "PLB-033", emoji: "🚿" },
];
export const POS_MATH = {
  promoCode: "GOLD10", promoDiscount: 500,      // flat, applied when promoApplied
  giftCardRedemption: 1000,                      // hardcoded
  pointsRedemption: 300, pointsLabel: "Use 300 pts",
  vatRate: 0.16,                                 // Math.round((subtotal - discount) * 0.16)
  defaults: { subtotal: 15150, discount: 500, vat: 2344, grandTotal: 15694 },
};
export const SALE_SUCCESS = { invoice: "INV-2848", method: "M-Pesa", pointsEarned: 50,
  kraQrCaption: "CU: KRAMW004...", loyaltyBalance: "Balance 470 pts" };

// ---------- Dashboard misc ----------
export const DASHBOARD_KPIS = {
  todaySales: { value: "KES 124,500", delta: "+12%", spark: [3, 6, 4, 8, 5, 9, 7] },
  paySplit: { mpesa: 45, cash: 40, other: 15 },
  debtors: { value: "KES 450k", delta: "-8%", sub: "18 overdue • Action needed" },
  lowStock: { value: "23 items", sub: "Cement, Paint, Plumbing" },
  salesByStore: [{ store: "Thika Road", value: "KES 124k", pct: 68, color: "#0052CC" },
                 { store: "Kiambu", value: "KES 89k", pct: 42, color: "#00C853" }],
  trend: { blue: "0,60 45,50 90,55 135,30 180,35 225,20 270,25 320,10",
           greenDashed: "0,65 45,62 90,60 135,50 180,45 225,40 270,38 320,30",
           days: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] },
  conversion: "Conversion 68%",
  customerStats: { total: "2,450", gold: "120", debtors: "45" },
};
```

---

## 17. STATE MODEL (root `App`)

| state | type | initial | purpose |
|---|---|---|---|
| page | string | `"dashboard"` | active screen id |
| sidebarCollapsed | bool | false | 280px ↔ 72px |
| posCategory | string | `"All"` | POS category chip filter |
| cart | CartLine[] | DEFAULT_CART | POS cart |
| posCustomer | object\|null | null | POS selected customer |
| showSuccess | bool | false | POS success modal |
| selectedDeal | Deal\|null | null | pipeline drawer |
| selectedProduct | Product\|null | null | inventory drawer |
| selectedCustomerDetail | Customer\|null | null | customers detail view |
| device | "desktop"\|"tablet"\|"mobile" | "desktop" | device switcher |
| storeModal | bool | false | login store-select modal |
| loginTab | "pin"\|"owner" | "pin" | login tab |
| pin | string | "" | staff PIN buffer |
| debtsTab | "Debtors"\|"Creditors" | "Debtors" | debts toggle |
| inventoryTab | string | "All Items" | inventory tabs |
| customersTab | string | "Customers" | customers tabs |
| promoApplied | bool | **true** | GOLD10 applied |
| usePoints | bool | **true** | Use 300 pts toggle |

---

## 18. GAP NOTES (explicitly absent from prototype — do not invent)

1. **Kanban drag & drop / stage moves** — columns and cards are static; only the detail drawer opens.
2. **Pipeline List / Calendar / Analytics views** — tab buttons render nothing.
3. **Debt payment-plan builder** (installment editor, auto-SMS, auto-block-at-POS toggles) — only a "Payment Plans" filter chip exists.
4. **Payroll calculator / payslip modal** — table only; statutory values hardcoded strings.
5. **Reports drill-down** — cards only; every chart is the same mock bars.
6. **Inventory Transfers tab content / barcode printing** — labels only.
7. **Customers → Price Groups tab content** — empty.
8. **Customer-detail sub-tabs content** (Purchases/Debt Plans/Loyalty History/Gift Cards/Messages) — Overview only.
9. **Settings panels** other than KRA eTIMS + M-Pesa Daraja — nav items only.
10. **Search behaviors** (⌘K, live filtering), promo validation, payment-mode selection, SMS sending, chat posting, auth — all no-op / visual only.
11. **Sidebar badge "3" on Debts** — does not exist in code; the red "3" is the # stock-alerts chat channel unread badge.
12. Success modal point animation, offline sync engine, real QR codes — visual placeholders (QrCode icon on tinted boxes).

*End of spec.*
