/**
 * Emits the two canonical DukaFlow print formats as real HTML files under
 * public/print-formats/. Generated from the SAME builders the POS uses at
 * runtime (src/services/receiptService.ts) with representative sample data,
 * so the files can never drift from what the printer actually receives.
 *
 * Run: bun scripts/export-print-formats.mjs
 */
import QRCode from "qrcode";
import { mkdirSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;

// Minimal inline replica of the builders (kept byte-identical by generating
// through a tiny shim that imports the service via tsconfig paths).
const { buildThermalReceiptHTML, buildA4ReceiptHTML } = await import(
  new URL("../src/services/receiptService.ts", import.meta.url).pathname
);

const sample = {
  kind: "SALE",
  title: "SALES RECEIPT",
  docNo: "INV-2883",
  receiptCode: "NVS-DUKA-2026-00042",
  date: new Date().toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
  storeName: "DukaFlow Thika Road",
  storeAddress: "Ruai, Eastern Bypass, Nairobi",
  storePhone: "0712 345 678",
  tillNo: "TILL-04",
  kraPin: "P051XXXXXXX",
  servedBy: "Mary Wanjiku",
  customerName: "John Kamau",
  customerLine: "John Kamau - GOLD Tier | Earned: 45 pts | Balance: 420 pts | Value KES 420",
  lines: [
    { no: 1, name: "Fresh Bananas (Loose)", qty: 1.25, unit: "kg", unitPrice: 129, discount: 0, total: 161.25 },
    { no: 2, name: "Azam Soda 500ml", qty: 2, unit: "pc", unitPrice: 95, discount: 10, total: 180 },
  ],
  totals: [
    { label: "Subtotal", value: "KES 295.65" },
    { label: "Discount", value: "- KES 10.00" },
    { label: "VAT 16%", value: "KES 40.83" },
  ],
  grandTotal: "KES 326.48",
  paymentLines: [
    { method: "M-Pesa", amount: "KES 163.24" },
    { method: "Cash", amount: "KES 163.24" },
  ],
  pointsLine: { earned: 45, redeemed: 0, balance: 420, value: 420 },
  footerMessage: "Thank you! Sema na sisi: 0712 345 678",
  qrText: "https://retail-erp-pos-kenya.vercel.app/receipt/NVS-DUKA-2026-00042",
  company: "DukaFlow Ltd",
};

const qr = await QRCode.toDataURL(sample.qrText, { width: 512, margin: 1, errorCorrectionLevel: "M" });
const thermal = buildThermalReceiptHTML(sample, qr);
const a4 = buildA4ReceiptHTML(sample, qr);

mkdirSync(`${root}public/print-formats`, { recursive: true });
writeFileSync(`${root}public/print-formats/receipt_80mm_thermal.html`, thermal);
writeFileSync(`${root}public/print-formats/receipt_a4_pdf.html`, a4);
console.log("print formats written:", {
  thermal: `${root}public/print-formats/receipt_80mm_thermal.html`,
  a4: `${root}public/print-formats/receipt_a4_pdf.html`,
});
