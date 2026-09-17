# DukaFlow — Kenya Retail ERP + POS

**retail-erp-pos-kenya** — a production-ready, offline-first retail ERP + POS built for Kenyan hardware stores and supermarkets. Multi-store, KRA eTIMS-ready receipts, M-Pesa STK Push, loyalty & gift cards, debt plans with POS blocking, Kenya-compliant payroll (PAYE 2024 / NSSF / SHIF / Housing Levy / HELB), in-house Raven chat and SMS/WhatsApp blasts.

> Built as a modern full-stack alternative to Frappe/ERPNext for this use case: **Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui · Prisma + SQLite · Recharts · IndexedDB offline queue**.

---

## ✨ Feature Map

| Module | Highlights |
| --- | --- |
| **Multi-store POS (offline-first)** | Per-store stock, barcode scanning, customer picker (tier / points / debt / gift card / credit limit in one strip), 6 payment modes (Cash, **M-Pesa STK Push**, Till, Paybill, Gift Card, Credit Sale), promo codes, bill discounts, points redemption, VAT 16%, **Happy Hour auto-pricing** (time-boxed % off a category, till banner + server-authoritative pricing). Sales are written to **IndexedDB first** and auto-sync when connectivity returns (`src/lib/offline.ts`). |
| **Installable PWA offline shell** | Service worker (`public/sw.js`) caches the app shell so the till **boots with zero network** (network-first navigations, cache-first static assets, `/api` never cached), web app manifest + maskable icons, install prompt, and a **Settings › Device & Offline** panel (install button, SW status, offline queue replay). In dev the SW registers only with `?sw=1` to keep hot-reload sane. |
| **Sales pipeline** | Kanban **Quotation → Proforma → Sales Order → Invoiced → Paid** with drag & drop, one-click stage maturing, full stage timeline, auto Sales Invoice creation at "Invoiced". |
| **Loyalty & gift cards** | Configurable earn rules (1 pt / KES 100 by default), Gold 10% / Silver 5% auto tier discounts, 12-month expiry, gift cards with **real QR codes**, partial redemption, top-ups, six designer gradients. |
| **Creditors / debtors / debt plans** | Aging buckets (0-30 / 31-60 / 60+), payment-plan builder (Weekly/Monthly installments, **auto reminder SMS**, **auto-block POS when overdue > 7 days**), record payments with SMS receipts. Credit sales auto-create debt plans. |
| **KRA eTIMS** | Every sale is submitted to the eTIMS simulator → **CU invoice number** + QR payload (`KRA PIN;INV;DATE;TOTAL;CU;DEVICE`) rendered as a real PNG QR stored on the invoice. Fields: `cuInvoiceNumber`, `qrCodeBase64`, `kraStatus`. |
| **M-Pesa (Daraja simulator)** | STK Push flow with polling (`POST /api/mpesa/stk` → `GET ?id=`), till numbers, B2C bulk CSV export for payroll. Swap the simulator for live Daraja keys in Settings. |
| **Receipts & print** | 80 mm **thermal** receipt (zig-zag paper, mono type, KRA QR, blue loyalty block, red promo footer) + **A4 coloured tax invoice** (blue brand header, tax breakdown, bank/M-Pesa footer, signature) + gift-card art. Both print-optimised via `.df-print-area` / `.df-print-area-a4`. |
| **Kenya payroll** | PAYE 2024 bands (10→35% + KES 2,400 relief + AHL relief), NSSF Tier I 360 + Tier II 720, **SHIF 2.75%** (min 300), **Housing Levy 1.5%** employee + employer, HELB. Payslips with QR, M-Pesa B2C + bank CSV, journal posting simulation. (`src/lib/kenya-payroll.ts`) |
| **Raven chat** | In-house Slack-style chat: `#general #thika-road #kiambu-store #managers-only #stock-alerts #deliveries`, unread badges, **shareable ERP doc cards** (invoices, transfers, debt plans), threads, `/` commands. Stock transfers post to `#stock-alerts` automatically. |
| **Client messaging** | Africa's Talking–style SMS + WhatsApp Cloud API simulation, audience filters (Gold / has debt / birthday today / bought last 7 days), merge tags (`{customer_name}`, `{points_balance}`…), 160-char segment costing, iPhone preview, full delivery log. Receipt + debt-reminder SMS fire automatically. |
| **Daily automation** | `GET /api/cron/daily` — recalculates debt-plan overdue days, birthday SMS, debt reminders 1 day before due (deduped per day, respects the reminder opt-out). Wire to any scheduler; trigger manually from Settings › Backup & Restore. |
| **Reports** | 8 live reports (Sales by Store, P&L, Stock Aging, Debtor Aging, Loyalty Redemption, Staff Performance, KRA eTIMS Submissions, M-Pesa Reconciliation) with real charts, drill-downs and CSV export. **Stock Aging is computed from real inventory batch ages** (`StockLevel.receivedAt` × qty × cost, reset on inbound stock/transfer) with per-bucket heaviest-items drill-down. |
| **Roles** | Cashier (POS-first login via PIN), Store Keeper, Sales, Owner. Demo PINs below. |

---

## 🚀 Quick Start

```bash
# 1. install dependencies
bun install            # or: npm install

# 2. configure env
cp .env.example .env

# 3. create the database schema
bun run db:push

# 4. seed Kenyan demo data (stores, products, customers, sales, payroll, chat…)
bun prisma/seed.ts

# 5. run
bun run dev            # http://localhost:3000
```

Or use the one-shot installer: `bash install.sh`

## 🔑 Demo Logins

| User | PIN | Role |
| --- | --- | --- |
| Mary Wanjiku | `1234` | Cashier (lands on POS) |
| James Otieno | `2345` | Store Keeper |
| Grace Akinyi | `3456` | Sales |
| Owner | `0000` | Owner (full access) |

## 🧾 Try the golden path

1. Log in with PIN `1234` → pick **Thika Road**.
2. POS: tap **Bamburi Cement 50kg** ×4 → select customer **John Kamau** (Gold — 10% auto discount).
3. Apply promo **GOLD10**, toggle **Use points**, pay with **M-PESA STK PUSH** → confirm the simulated STK dialog.
4. Success modal shows the **KRA verification QR** + loyalty QR. Visit **Receipts** for the 80 mm thermal & A4 renders.
5. Toggle your browser to offline (DevTools → Network) and ring another sale — it queues in IndexedDB and syncs automatically when you're back online.
6. Explore **Debts → Payment Plan builder** (auto-SMS + auto-block toggles), **Payroll → Run Payroll**, **Messages → Birthday blast**, **Raven Chat** doc cards.

## 🏗 Project Structure

```
prisma/
  schema.prisma        # 17 models — stores, sales, pipeline, debt, payroll, chat, settings
  seed.ts              # Kenyan-realistic demo data
src/
  app/
    api/               # 18 route groups (sales engine, eTIMS, M-Pesa, payroll, chat…)
      sales/route.ts   # POS sale engine: discounts → points → stock → eTIMS → SMS → debt plans
      mpesa/stk/       # Daraja STK simulator + C2B callback
    page.tsx           # App shell: sidebar, topbar, device frames, offline sync loop
    globals.css        # Design tokens, thermal paper, animations, print rules
  components/
    df/                # Logo (exact SVG), badges, KPI cards, QR renderer
    screens/           # 14 screens (login, pos, pipeline, payroll, …)
    ui/                # shadcn/ui
  lib/
    kenya-payroll.ts   # Statutory engine (PAYE/NSSF/SHIF/Housing/HELB + CSV exports)
    etims.ts           # CU number generator + QR PNG (qrcode lib)
    offline.ts         # IndexedDB queue + batch sync
    store.ts           # Zustand app state
  types.ts             # Shared DTO contracts
DESIGN_SPEC.md         # Screen-by-screen design spec & seed data master list
install.sh             # One-command bootstrap (init → seed → dev)
```

## 🎨 Design System

- **Palette**: `#0052CC` primary · `#00C853` success · `#FF5630` alert · `#172B4D` navy · `#FFAB00` warning
- **Type**: Sora (display) + Inter (body)
- **Logo**: custom "D" mark (bag + arrow + barcode + pin) in 4 variants — see the in-app **Design System** screen for the full suite, spacing rules and wrong-usage examples.

## 🔌 Going live with integrations

| Simulator today | Production swap |
| --- | --- |
| `src/lib/etims.ts` posts to local simulator | Point `submitToEtims()` at your KRA eTIMS OSU/GCU endpoint; keep the same payload contract. |
| `src/app/api/mpesa/stk` simulates Daraja | Replace with `POST https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest` using Consumer Key/Secret from Settings; keep the `{checkoutRequestId}` polling contract. |
| `api/messages/send` simulates AT | Swap the log-and-notify loop for Africa's Talking SMS / WhatsApp Cloud API Graph call; merge-tag renderer stays. |

## 📄 Environment

See `.env.example` — only `DATABASE_URL` is required to run; KRA / M-Pesa / SMS keys configure the simulators and are managed in-app under **Settings**.

## License

MIT — built with ❤️ for Kenyan dukas.
