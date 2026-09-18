/**
 * DukaFlow supermarket receipt engine.
 * Receipt codes: NVS-DUKA-YYYY-XXXXX. Every printable document gets a public
 * digital twin at /receipt/{receiptCode} so the printed QR "never dies".
 * Shared by server routes and client screens (isomorphic helpers only).
 */

export const RECEIPT_KINDS = [
  "SALE",
  "ZREPORT",
  "PAYSLIP",
  "DEBT_PAYMENT",
  "CREDITOR_PAYMENT",
  "QUOTATION",
  "PROFORMA",
  "ORDER",
  "INVOICE",
  "PAYMENT",
  "EXPENSE",
  "STOCK_ADJUSTMENT",
  "JOURNAL",
  "PAYMENT_ENTRY",
  "PURCHASE_INVOICE",
  "EXPENSE_CLAIM",
  "STOCK_ENTRY",
] as const;

export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

export const RECEIPT_TITLES: Record<string, string> = {
  SALE: "SALES RECEIPT",
  ZREPORT: "Z-REPORT / DAY CLOSE",
  PAYSLIP: "PAYROLL PAYSLIP",
  DEBT_PAYMENT: "DEBTORS PAYMENT RECEIPT",
  CREDITOR_PAYMENT: "CREDITORS PAYMENT RECEIPT",
  QUOTATION: "QUOTATION",
  PROFORMA: "PROFORMA INVOICE",
  ORDER: "SALES ORDER",
  INVOICE: "SALES INVOICE",
  PAYMENT: "PAYMENT RECEIPT",
  EXPENSE: "EXPENSE RECEIPT",
  STOCK_ADJUSTMENT: "STOCK ADJUSTMENT RECEIPT",
  JOURNAL: "JOURNAL ENTRY",
  PAYMENT_ENTRY: "PAYMENT ENTRY",
  PURCHASE_INVOICE: "PURCHASE INVOICE",
  EXPENSE_CLAIM: "EXPENSE CLAIM",
  STOCK_ENTRY: "STOCK ENTRY",
};

/** Public base URL the QR encodes - the deployed Vercel site (QR never dies). */
export const PUBLIC_BASE_URL =
  process.env.NEXT_PUBLIC_PUBLIC_BASE_URL || "https://retail-erp-pos-kenya.vercel.app";

export function receiptUrlFor(code: string): string {
  return `${PUBLIC_BASE_URL}/receipt/${code}`;
}

/** NVS-DUKA-YYYY-XXXXX where XXXXX is a zero padded yearly sequence. */
export function receiptCodeFromCount(count: number, now = new Date()): string {
  const seq = String(count + 1).padStart(5, "0");
  return `NVS-DUKA-${now.getFullYear()}-${seq}`;
}

export function docNumber(prefix: string, n: number, pad = 4): string {
  return `${prefix}-${String(n).padStart(pad, "0")}`;
}

/** Deterministic short hash usable in URLs (verification QR on reports). */
export function hashPayload(payload: unknown): string {
  const str = JSON.stringify(payload, Object.keys(payload as object).sort());
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(7, "0");
}

export function verifyUrlFor(hash: string): string {
  return `${PUBLIC_BASE_URL}/verify/${hash}`;
}

/** KES money formatting used across receipts and reports. */
export function kes(n: number, withKes = true): string {
  const v = (Math.round(n * 100) / 100).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withKes ? `KES ${v}` : v;
}

export function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// --- Receipt document model (what /receipt/[code] and prints render) ---------

export interface ReceiptLine {
  no: number;
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  discount: number;
  total: number;
  emoji?: string;
}

export interface ReceiptTotalsRow {
  label: string;
  value: string;
  bold?: boolean;
  large?: boolean;
}

export interface ReceiptExtraBlock {
  heading: string;
  rows: { label: string; value: string; bold?: boolean }[];
}

export interface ReceiptDocData {
  kind: ReceiptKind | string;
  title?: string;
  docNo: string;
  receiptCode?: string; // digital receipt code (QR target)
  verifyHash?: string; // reports verification hash
  date: string;
  storeName?: string;
  storeAddress?: string;
  storePhone?: string;
  tillNo?: string;
  kraPin?: string;
  cuInvoiceNumber?: string;
  etimsEnabled?: boolean;
  servedBy?: string;
  customerName?: string;
  customerLine?: string; // "John - GOLD Tier - Earned: 45 pts | Balance: 420 pts | Value KES 420"
  lines: ReceiptLine[];
  totals: ReceiptTotalsRow[];
  grandTotal: string;
  paymentLines?: { method: string; amount: string }[];
  pointsLine?: { earned?: number; redeemed?: number; balance?: number; value?: number };
  footerMessage?: string;
  qrText?: string; // override QR content (defaults to receipt/verify URL)
  extraBlocks?: ReceiptExtraBlock[];
  company?: string;
  logoUrl?: string;
}

/** Build the standard customer loyalty line shown on every receipt. */
export function customerPointsLine(
  name: string | undefined | null,
  tier: string | undefined | null,
  earned?: number,
  balance?: number,
  pointValue = 1,
): string | undefined {
  if (!name) return undefined;
  const parts = [`${name} - ${tier ?? "Bronze"} Tier`];
  if (typeof earned === "number") parts.push(`Earned: ${earned} pts`);
  if (typeof balance === "number") parts.push(`Balance: ${balance} pts`);
  if (typeof balance === "number") parts.push(`Value KES ${Math.round(balance * pointValue)}`);
  return parts.join(" | ");
}

// --- Payment icon fallbacks (thermal printers cannot render icons) -----------

export function methodTag(method: string): string {
  const m = method.toLowerCase();
  if (m.includes("mpesa") || m.includes("m-pesa") || m.includes("m pesa")) return "[M-PESA]";
  if (m.includes("cash")) return "[CASH]";
  if (m.includes("card")) return "[CARD]";
  if (m.includes("point")) return "[POINTS]";
  if (m.includes("gift")) return "[GIFT]";
  if (m.includes("credit")) return "[CREDIT]";
  if (m.includes("paybill")) return "[PAYBILL]";
  if (m.includes("till")) return "[TILL]";
  if (m.includes("cheque")) return "[CHEQUE]";
  if (m.includes("bank")) return "[BANK]";
  return "[PAY]";
}

// --- Client side CSV export (Export Excel button on every report) ------------

export function exportCsv(filename: string, rows: (string | number)[][], sheetName = "Report"): void {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename.replace(/[^a-z0-9-_ ]/gi, "")}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  void sheetName;
}

/** Parse an EAN-13 scale barcode (20 AAAAA WWWWW C): returns kg weight or null. */
export function parseScaleBarcode(barcode: string): { scaleCode: string; kg: number } | null {
  if (!/^2\d{12}$/.test(barcode)) return null;
  const scaleCode = barcode.slice(2, 7); // 5 digit item code after the "20" prefix
  const grams = Number(barcode.slice(7, 12));
  if (!Number.isFinite(grams) || grams <= 0) return null;
  return { scaleCode, kg: grams / 1000 };
}
