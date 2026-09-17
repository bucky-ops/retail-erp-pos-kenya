# DukaFlow — Kenya Retail ERP + POS

**retail-erp-pos-kenya** — a production-ready, offline-first retail ERP + POS built for Kenyan hardware stores and supermarkets. Multi-store, KRA eTIMS-ready receipts, M-Pesa STK Push, loyalty & gift cards, debt plans with POS blocking, Kenya-compliant payroll (PAYE 2024 / NSSF / SHIF / Housing Levy / HELB), in-house Raven chat and SMS/WhatsApp blasts.

> Built as a modern full-stack alternative to Frappe/ERPNext for this use case: **Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui · Prisma + SQLite · Recharts · IndexedDB offline queue**.

---

## ✨ Feature Map

| Module | Highlights |
| --- | --- |
| **Multi-store POS (offline-first)** | Per-store stock, barcode scanning, customer picker (tier / points / debt / gift card / credit limit in one strip), 6 payment modes (Cash, **M-Pesa STK Push**, Till, Paybill, Gift Card, Credit Sale), promo codes, bill discounts, points redemption, VAT 16%, **Happy Hour auto-pricing** (time-boxed % off a category, till banner + server-authoritative pricing). Sales are written to **IndexedDB first** and auto-sync when connectivity returns (`src/lib/offline.ts`). |
| **Realtime event bus (socket.io)** | A dedicated mini-service (`mini-services/live-feed`, socket.io :3003 + HTTP emit bridge :3004) pushes `sale:new`, `sale:return`, `stock:low`, `chat:new`, `till:z` and `po:received` to every open browser. The dashboard **Live Sales Feed** renders committed sales instantly (green flash rows, KPI glow, big-sale toast, LIVE/RECONNECTING status), Raven appends messages live with unread bumps, and low-stock crossings raise instant toasts + `#stock-alerts` bot posts. New connections replay the last 25 events. |
| **POS quick return (scan at till)** | POS header **Quick Return** (or **F4**): scan the receipt barcode / type the INV number → the receipt's lines appear with how many units are still refundable → pick qty (or "Return all refundable"), reason + payout method → **Process refund**. Same endpoint and rules as the back office (`/api/returns`), lookup via `/api/sales/lookup` so over-returns are impossible, already-returned units are greyed out, and the success card shows CN / GC chips + the till-adjustment note. |
| **Barcode label printer** | Inventory › **Labels**: pick products (search / category filter, per-product copies), choose **50×30mm** or **38×25mm** thermal stickers, and preview the sheet live — each label carries the company strip, product name, a **scannable QR encoding the barcode value** (types straight into the POS scan field or the stock-take counter), a 1D barcode rendering, SKU and the big shelf price. Prints via the isolated A4 print area (`/api/labels`). |
| **Sales returns & refunds** | Receipts › **Returns** tab: pick lines on any receipt (qty pickers clamp to what is still refundable), choose a reason and payout — **Cash refund** (reduces the open till's expected drawer), **M-Pesa B2C**, **Credit note** (numbered CN-xxxx; on credit invoices it lowers both the customer's balance **and** the linked debt plan) or **Gift card** (issues a store-credit card). Refunds are computed from the receipt's *actually paid* ratio (VAT in, discounts/points out), restock is a toggle for write-offs, and every return is audited to `#stock-alerts` + the live bus (`/api/returns`). |
| **Low-stock watchdog** | When a sale or adjustment takes an item **at/below its reorder point**, the API posts a ⚠️ bot message to `#stock-alerts`, broadcasts `stock:low` (live dashboard toast), and only fires on the crossing itself so a run of sales never spams the channel. |
| **Cash drawer — X & Z reports** | Open a shift with a KES opening float, live **expected-drawer** figure (float + cash sales), payment-split takings, **X-Report** mid-shift snapshot, and a **Z-Report close** that reconciles counted cash vs expected and records the variance (`/api/till`). Shift history with color-coded variance lives in the POS › Till dialog — the button pulses green while a shift is open. Cash refunds from returns adjust the open drawer automatically. |
| **Procurement — suppliers & purchase orders** | Inventory › **Procurement** (badge = live low-stock count): **reorder suggestions** (qty ≤ reorder point → suggested cover qty, best-match supplier pre-picked, per-line **include checkboxes** + select/deselect-all) one-click **PO drafting grouped per supplier**, then **Send → Receive (GRN)** with partial receipts, over-receive guards, fresh `receivedAt` stamps for stock aging, and audit posts to `#stock-alerts` (`/api/purchase-orders`, `/api/suppliers`). Supplier directory with categories, lead times and quick-add. |
| **Return to vendor (RTV / debit notes)** | Procurement › **Return to vendor** tab: send damaged / wrong / warranty / overstock goods back to a supplier — lines are picked from live shelf stock (qty clamped to what's actually there), valued **at cost**, stock decrements immediately, and a numbered debit note (**RTV-xxxx / DN-xxxx**) is raised for the supplier statement. Recent returns list with one-click **Credit** reconciliation when the money lands (`/api/supplier-returns`). |
| **Stock take / cycle counts** | Inventory › **Stock Take**: open a session (per store, all products or one category) that **snapshots system quantities** so POS sales during the count never skew the math; count the shelf with steppers / direct entry / a "Same" quick-match — **or flip to Scan mode** and just scan shelf labels (each scan = +1 unit counted, teal flash on the touched line, unknown codes rejected) — watch the **live variance value** tick (green surplus, red shortage), then **Apply & approve** — one transaction applies every variance to real stock, values it at cost, stamps fresh `receivedAt` on surplus lines, and posts the digest to `#stock-alerts` (`/api/stock-take`). Session history with progress + value variance. |
| **Supplier price lists** | Procurement › **Suppliers › Price list**: store each supplier's **negotiated per-product cost**; blank rows fall back to the catalog cost. Reorder suggestions and new PO lines **re-quote automatically** from the price list, with green/red "vs catalog" saving chips so buyers always see the real margin (`/api/suppliers/prices`). |
| **Supplier statements** | Procurement › **Suppliers › Statement**: a printable A4 reconciliation sheet per supplier — goods **received vs ordered**, **RTV debit notes** (credited vs pending, with a "follow up" alert when credits are outstanding), the **negotiated price list** with per-unit savings vs catalog, per-PO received/outstanding columns and a **net traded** position (`/api/suppliers/[id]/statement`). Print / Save PDF respects the A4 print area. |
| **Scheduled report email** | "Schedule email" on Reports opens a real persisted schedule (Daily / Weekly Monday / Monthly, 08:00 EAT) — `GET /api/cron/report` aggregates revenue, VAT, top products, per-store split and payment mix from live sales and emails the owner (mock mailer logged to Messages). Manageable from Reports and Settings › Backup & Restore. |
| **Installable PWA offline shell** | Service worker (`public/sw.js`) caches the app shell so the till **boots with zero network** (network-first navigations, cache-first static assets, `/api` never cached), web app manifest + maskable icons, install prompt, and a **Settings › Device & Offline** panel (install button, SW status, offline queue replay). In dev the SW registers only with `?sw=1` to keep hot-reload sane. |
| **Sales pipeline** | Kanban **Quotation → Proforma → Sales Order → Invoiced → Paid** with drag & drop, one-click stage maturing, full stage timeline, auto Sales Invoice creation at "Invoiced". |
| **Loyalty & gift cards** | Configurable earn rules (1 pt / KES 100 by default), Gold 10% / Silver 5% auto tier discounts, 12-month expiry, gift cards with **real QR codes**, partial redemption, top-ups, six designer gradients. |
| **Creditors / debtors / debt plans** | Aging buckets (0-30 / 31-60 / 60+), payment-plan builder (Weekly/Monthly installments, **auto reminder SMS**, **auto-block POS when overdue > 7 days**), record payments with SMS receipts. Credit sales auto-create debt plans. Every recorded payment lands in a real **`DebtPayment` ledger**, and each plan has a printable **Account statement** (A4 sheet: balance hero, credit invoices with KRA status, payments received, credit availability) with **CSV export**, **print-to-PDF** and **email delivery** (full statement preview → send, saved on the customer for next time, audited as `Email/Statement` in Messages — `/api/debt-plans/[id]/statement/email`). |
| **KRA e-invoice email** | Verified invoices can be emailed to customers straight from Receipts (**Email e-invoice**) or **from the POS success modal itself** (3-button footer: Print / Email / New Sale — enabled the moment eTIMS verifies, disabled with a tooltip for offline-queued sales) — a live preview shows the full electronic tax invoice (CU number, KRA PIN, line items, VAT, totals), and when a KRA-verified sale is made for a customer with an email on file it **sends automatically**. Sending to a typed address saves it to the customer for future auto-delivery. Mock mailer writes to the auditable `Email/Invoice` log in Messages (`/api/sales/[id]/email`, `src/lib/invoice-email.ts`). |
| **Bulk stock import** | Inventory › **Import**: paste a CSV/tab-separated sheet of barcode-or-SKU + qty (comments and header lines skipped), pick **Set** (absolute counts) or **Add** (delivery notes) mode per store, then **Validate** → a diff preview shows every line as current → new with green/red chips, unknown codes, duplicates and negative results flagged before anything is written. Apply commits in one transaction, refreshes `receivedAt` on inbound lines, posts a single digest to `#stock-alerts` and raises live low-stock alerts (`/api/inventory/bulk-import`). |
| **KRA eTIMS** | Every sale is submitted to the eTIMS simulator → **CU invoice number** + QR payload (`KRA PIN;INV;DATE;TOTAL;CU;DEVICE`) rendered as a real PNG QR stored on the invoice. Fields: `cuInvoiceNumber`, `qrCodeBase64`, `kraStatus`. |
| **M-Pesa (Daraja simulator)** | STK Push flow with polling (`POST /api/mpesa/stk` → `GET ?id=`), till numbers, B2C bulk CSV export for payroll. Swap the simulator for live Daraja keys in Settings. |
| **Receipts & print** | 80 mm **thermal** receipt (zig-zag paper, mono type, KRA QR, blue loyalty block, red promo footer) + **A4 coloured tax invoice** (blue brand header, tax breakdown, bank/M-Pesa footer, signature) + gift-card art. Both print-optimised via `.df-print-area` / `.df-print-area-a4`. |
| **Kenya payroll** | PAYE 2024 bands (10→35% + KES 2,400 relief + AHL relief), NSSF Tier I 360 + Tier II 720, **SHIF 2.75%** (min 300), **Housing Levy 1.5%** employee + employer, HELB. Payslips with QR, M-Pesa B2C + bank CSV, journal posting simulation. (`src/lib/kenya-payroll.ts`) |
| **Raven chat** | In-house Slack-style chat: `#general #thika-road #kiambu-store #managers-only #stock-alerts #deliveries`, unread badges, **shareable ERP doc cards** (invoices, transfers, debt plans), threads, `/` commands. Stock transfers post to `#stock-alerts` automatically. |
| **Client messaging** | Africa's Talking–style SMS + WhatsApp Cloud API simulation, audience filters (Gold / has debt / birthday today / bought last 7 days), merge tags (`{customer_name}`, `{points_balance}`…), 160-char segment costing, iPhone preview, full delivery log. Receipt + debt-reminder SMS fire automatically. |
| **Daily automation** | `GET /api/cron/daily` — recalculates debt-plan overdue days, birthday SMS, debt reminders 1 day before due (deduped per day, respects the reminder opt-out), and a **daily expenses digest** (today's petty cash + bills by category, logged as an owner email). Wire to any scheduler; trigger manually from Settings › Backup & Restore. |
| **Keyboard shortcut cheat-sheet** | Settings › **Keyboard Shortcuts**: every speed key on one card wall — F2 scan focus, F4 quick return, Enter-to-cart, stock-take scan counting, Esc, Ctrl+P print isolation and PIN typing — each with kbd chips, context badges (POS / Stock take / Login) and a cashier workflow tip. |
| **Smoke test** | `bash scripts/smoke.sh` — 24 curl-based checks across every API group plus deterministic write-paths (stock-take open → count → cancel, RTV over-return guard 400, expense-digest shape, supplier statement reconciliation, statement email preview). Zero test framework, exit-code driven; run before every push. |
| **Reports** | 9 live reports (Sales by Store, P&L, Stock Aging, Debtor Aging, Loyalty Redemption, Staff Performance, KRA eTIMS Submissions, M-Pesa Reconciliation, **Operating Expenses**) with real charts, drill-downs and CSV export. **Stock Aging is computed from real inventory batch ages** (`StockLevel.receivedAt` × qty × cost, reset on inbound stock/transfer) with per-bucket heaviest-items drill-down. The **Expenses** drill carries a record-expense form (petty cash / bills per store, paid-via method, voucher ref), 30-day category breakdown, a live **net operating profit** strip, and the P&L drill links to it. |
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

# 6. (optional but recommended) realtime event bus — live sales feed,
#    Raven live messages, low-stock toasts. Without it the app still
#    works; feeds just show a RECONNECTING pill instead of LIVE.
cd mini-services/live-feed && bun install && bun run dev
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
6. Explore **Debts → Payment Plan builder** (auto-SMS + auto-block toggles), **Debts → row menu → Account statement** (print / CSV), **Payroll → Run Payroll**, **Messages → Birthday blast**, **Raven Chat** doc cards.
7. With the live-feed service running, keep the **Dashboard** open in one tab and ring a sale in POS from another tab — the feed row, KPI glow and (for low-stock crossings) the ⚠️ toast fire instantly over socket.io.

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
