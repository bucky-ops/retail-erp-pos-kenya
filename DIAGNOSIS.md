# DIAGNOSIS: Blank Receipt Printing in DukaFlow POS

**Symptom:** After a sale, DukaFlow POS prints blank paper. Every receipt family is affected:
Sales, Day Close (Z-Report), Payroll Payslips, Debtors receipts (individual + summary), Creditors receipts.

**Scope of investigation:** every place in the repo where printing happens.

## 1. Where printing happens (full inventory)

| File | Mechanism | Trigger |
|---|---|---|
| `src/components/df/receipt-document.tsx` | `printReceiptArea()` injects `@media print` CSS with the "visibility trick" over the live app DOM, then `window.print()` | used by 8 screens |
| `src/app/globals.css` lines 228 to 236 | second copy of the same trick for `.df-print-area` | POS success modal |
| `src/components/df/report-print.tsx` | `printReportArea()` same trick for `.df-report-sheet` | all reports |
| `src/components/screens/pos-screen.tsx` lines 2205 / 2263 | bare `window.print()` on the success modal | Print Receipt / Print 80mm |
| Hidden print hosts | `<div className="hidden print:block"><ReceiptDocument/></div>` in pos, receipts, day-close, payroll, debts, accounting, pipeline, inventory screens | render-on-demand then timed print |

No qz-tray, escpos, or iframe-srcDoc printing exists in the repo. The browser console shows no hard
errors; blank output happens silently, which matches the CSS/dependency root causes below.

## 2. Root causes found

### RC1 (primary): In-DOM visibility printing with hidden hosts nested in dialogs
`printReceiptArea()` does:

```css
body * { visibility: hidden !important; }
.df-receipt, .df-receipt * { visibility: visible !important; }
.df-receipt { position: absolute !important; left: 0; top: 0; }
```

`visibility: visible` on a child **cannot** repair its ancestors:
* every print host is `className="hidden print:block"` (`display:none` on screen). If the wrapping
  Radix `Dialog` closes or state resets before spooling, the host is **unmounted** and nothing prints;
* hosts sit inside `DialogContent` with `overflow: hidden` and inside `max-h` scroll containers.
  `position: absolute; left: 0; top: 0` anchors to the nearest **positioned** ancestor (the modal),
  so the receipt sheet is laid out **outside the printable page** or clipped by the modal box.
  The printer receives a page whose visible area is empty: blank paper.

### RC2: Async race, print fires before content exists
Every screen renders the host and prints after a magic timeout:

* `receipts-screen.tsx:936` 150 ms
* `day-close-screen.tsx:327` 300 ms
* `payroll-screen.tsx:828` 300 ms
* `debts-screen.tsx:338` 300 ms
* `pipeline-screen.tsx:434` 300 ms
* `inventory-screen.tsx:444,1243,1822` 300 ms
* `accounting-screen.tsx:2337` 700 ms

The QR inside `ReceiptDocument` is generated **asynchronously** (`useQr` -> `QRCode.toDataURL`).
On a slow terminal or first print the timeout expires before React commits and before the QR promise
resolves: the sheet prints with an empty QR or nothing at all. There is no `img.onload` wait anywhere.

### RC3: External logo URL and no print color adjust
`ReceiptDocument` renders `<img src={data.logoUrl}>` and reports use `useCompanyProfile().logoUrl`.
When the company logo is an external URL (`https://.../files/logo.png`) thermal spoolers frequently
block or skip remote images and printing never waits for image decode: the logo area prints blank.
No `-webkit-print-color-adjust: exact` / `print-color-adjust: exact` is declared, so background
colors (the yellow CUSTOMER POINTS box, Z-report highlight rows) drop out on thermal media.

### RC4: POS "Print 80mm" prints the success modal, not a receipt
`pos-screen.tsx` calls bare `window.print()` inside the success `Dialog`. It relies on
`globals.css .df-print-area { position:absolute; left:0; top:0; width:80mm }` applied to a rounded
`overflow-hidden` modal body. Result: clipped or fully blank page, and even when it "works" the
output is a screenshot of the celebratory modal, not an 80mm thermal receipt.

## 3. Fix architecture (Naivas grade)

Standalone print documents. Nothing depends on the live app DOM anymore:

1. `src/services/receiptService.ts` builds a **complete standalone HTML document** for each print:
   all CSS inline, logo as base64 (from `localStorage.company_logo_base64`, warmed at login via
   `convertImageToBase64`), QR as base64 generated locally by the `qrcode` library (works offline,
   never `api.qrserver.com`), text icon fallbacks `[CASH]` `[M-PESA]`, yellow customer points box,
   `print-color-adjust: exact`.
2. The document opens in its own window (`window.open` + `document.write`) and prints itself on
   `onload="window.print(); setTimeout(window.close, 800)"`, so print fires only after every
   resource is loaded. If the popup is blocked the same HTML is written into a hidden iframe and
   the iframe prints. Zero races, zero ancestor clipping.
3. Thermal format: 72 mm content width, Courier New 11 px, 80 mm `@page`. A4 format: full sheet with
   logo header table, suitable for PDF export. Both are emitted as canonical files under
   `public/print-formats/` (`receipt_80mm_thermal.html`, `receipt_a4_pdf.html`).
4. Reports (General Ledger, Trial Balance, P&L, Balance Sheet, ledgers, M-Pesa recon) print through
   `printElementStandalone()`: the rendered A4 sheet is captured with computed styles inlined and
   re-printed from a standalone document, so the same class of bug cannot recur there.
5. Every receipt family keeps three actions: **Print Thermal HTML**, **Print A4 PDF**,
   **Share WhatsApp**.

## 4. Verification checklist mapping

| Test | Where |
|---|---|
| Sell 2 items to a points customer, print: logo, 2 items, points box, QR, bold total, NOT blank | POS success modal -> Print 80mm |
| Hold cart, switch module, return: cart restored | POS HOLD/Resume (server + localStorage) |
| Lock, login again: held carts restored | same |
| Day Close Z-Report print: sales by Cash / M-Pesa / Points + QR | Day Close screen |
| Phone opens digital receipt | `/receipt/{code}` public page |
