/**
 * DukaFlow universal receipt service (Naivas grade).
 *
 * Prints ZERO-dependency standalone documents: every receipt or report becomes a
 * complete HTML string with all CSS inline, the logo as base64, and the QR as
 * base64 generated locally by the qrcode library (never an external QR API, so
 * receipts still print when the shop internet is down).
 *
 * Why standalone? The previous approach printed the live app DOM with the
 * "visibility trick" plus hidden hosts nested in dialogs. Ancestor display:none,
 * overflow clipping and magic setTimeout races produced blank thermal paper
 * (see DIAGNOSIS.md RC1 to RC4). A standalone document printed from its own
 * window onload has none of those failure modes.
 *
 * Public surface:
 *   convertImageToBase64(url)            any image URL to a data URI (cached)
 *   warmPrintAssets()                    login time: logo + icons to localStorage
 *   getStoredLogoBase64()
 *   generateReceiptHTML(saleData, mode)  full standalone HTML (thermal | a4)
 *   printReceiptHTML(saleData, mode)     generate + open print window (iframe fallback)
 *   printReceiptDocs(docs, mode)         same, for ReceiptDocData payloads (multi doc aware)
 *   printElementStandalone(el, page)     capture a live A4 report node and print it standalone
 *   whatsappShareReceipt(code, url)
 */

import QRCode from "qrcode";
import {
  ReceiptDocData,
  RECEIPT_TITLES,
  kes,
  methodTag,
  receiptUrlFor,
} from "@/lib/receipt";

/* ------------------------------------------------------------------ */
/* Asset cache: logo / icons as base64 in localStorage                 */
/* ------------------------------------------------------------------ */

const LOGO_KEY = "company_logo_base64";
const MPESA_ICON_KEY = "mpesa_icon_base64";
const assetMemory = new Map<string, string>();

/** Convert any image URL (same origin, external, blob) into a base64 data URI. */
export async function convertImageToBase64(url: string): Promise<string> {
  if (!url) return "";
  if (url.startsWith("data:")) return url;
  if (assetMemory.has(url)) return assetMemory.get(url) ?? "";
  if (typeof window === "undefined") return "";
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return "";
    const blob = await res.blob();
    const b64 = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result ?? ""));
      fr.onerror = () => reject(new Error("read failed"));
      fr.readAsDataURL(blob);
    });
    assetMemory.set(url, b64);
    return b64;
  } catch {
    // Last resort: canvas draw (works when the server sends no CORS headers)
    try {
      return await new Promise<string>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const c = document.createElement("canvas");
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext("2d")?.drawImage(img, 0, 0);
            resolve(c.toDataURL("image/png"));
          } catch {
            resolve("");
          }
        };
        img.onerror = () => resolve("");
        img.src = url;
      });
    } catch {
      return "";
    }
  }
}

/** Run once at login: persist logo + payment icons so printing is fully offline. */
export async function warmPrintAssets(logoUrl?: string | null): Promise<void> {
  if (typeof window === "undefined") return;
  const src = logoUrl || localStorage.getItem("df_logo_url") || "";
  if (!src) return;
  const b64 = await convertImageToBase64(src);
  if (b64) {
    localStorage.setItem(LOGO_KEY, b64);
    localStorage.setItem("df_logo_url", src);
  }
  if (!localStorage.getItem(MPESA_ICON_KEY)) localStorage.setItem(MPESA_ICON_KEY, "");
}

export function getStoredLogoBase64(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(LOGO_KEY) ?? "";
}

/* ------------------------------------------------------------------ */
/* Print data model: accepts the flat SaleData shape AND ReceiptDocData */
/* ------------------------------------------------------------------ */

export interface SaleData {
  company?: { name?: string; logo_url?: string } | string;
  branch?: string;
  branch_address?: string;
  branch_phone?: string;
  kra_pin?: string;
  till_no?: string;
  logo_base64?: string;
  receipt_id?: string;
  receipt_code?: string;
  date?: string | Date;
  cashier?: string;
  served_by?: string;
  customer?: { name?: string; tier?: string; points_balance?: number; points_earned?: number } | null;
  customer_name?: string;
  customer_tier?: string;
  customer_points_balance?: number;
  customer_points_earned?: number;
  items: { idx: number; name: string; qty: number; unit?: string; rate: number; amount: number; discount?: number }[];
  subtotal?: number;
  vat?: number;
  discount?: number;
  loyalty_amount?: number;
  grand_total?: number;
  total?: number;
  mode_of_payment?: string;
  payment_lines?: { method: string; amount: number }[];
  change?: number;
  points_used?: number;
  points_earned?: number;
  points_balance?: number;
  qr_url?: string;
  qr_base64?: string;
  footer_message?: string;
  etims_enabled?: boolean;
  cu_invoice_number?: string;
  title?: string;
  kind?: string;
  extra_blocks?: { heading: string; rows: { label: string; value: string; bold?: boolean }[] }[];
}

type PrintDoc = ReceiptDocData | SaleData;

function isReceiptDoc(d: PrintDoc): d is ReceiptDocData {
  return (d as ReceiptDocData).lines !== undefined;
}

function money(n: number | undefined | null): string {
  return kes(Number(n ?? 0));
}

async function docToModel(d: PrintDoc): Promise<ReceiptDocData> {
  if (isReceiptDoc(d)) return d;
  const s = d as SaleData;
  const code = s.receipt_code ?? s.receipt_id ?? "";
  const company = typeof s.company === "string" ? s.company : s.company?.name;
  const earned = s.customer?.points_earned ?? s.points_earned;
  const balance = s.customer?.points_balance ?? s.points_balance;
  const customerName = s.customer?.name ?? s.customer_name;
  return {
    kind: s.kind ?? "SALE",
    title: s.title,
    docNo: s.receipt_id ?? code ?? "-",
    receiptCode: code || undefined,
    date: s.date
      ? new Date(s.date).toLocaleString("en-KE", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "",
    storeName: s.branch,
    storeAddress: s.branch_address,
    storePhone: s.branch_phone,
    tillNo: s.till_no,
    kraPin: s.kra_pin,
    cuInvoiceNumber: s.cu_invoice_number,
    etimsEnabled: s.etims_enabled,
    servedBy: s.cashier ?? s.served_by,
    customerName: customerName,
    customerLine: customerName
      ? [
          `${customerName} - ${s.customer?.tier ?? s.customer_tier ?? "Bronze"} Tier`,
          typeof earned === "number" ? `Earned: ${earned} pts` : "",
          typeof balance === "number" ? `Balance: ${balance} pts` : "",
          typeof balance === "number" ? `Value KES ${Math.round(Number(balance))}` : "",
        ]
          .filter(Boolean)
          .join(" | ")
      : undefined,
    lines: (s.items ?? []).map((i) => ({
      no: i.idx,
      name: i.name,
      qty: i.qty,
      unit: i.unit ?? "pc",
      unitPrice: i.rate,
      discount: i.discount ?? 0,
      total: i.amount,
    })),
    totals: [
      { label: "Subtotal", value: money(s.subtotal) },
      ...(s.discount ? [{ label: "Discount", value: `- ${money(s.discount)}` }] : []),
      ...(s.loyalty_amount ? [{ label: "Points Used", value: `- ${money(s.loyalty_amount)}` }] : []),
      { label: "VAT 16%", value: money(s.vat) },
    ],
    grandTotal: money(s.grand_total ?? s.total),
    paymentLines:
      s.payment_lines?.map((p) => ({ method: p.method, amount: money(p.amount) })) ??
      (s.mode_of_payment ? [{ method: s.mode_of_payment, amount: money(s.grand_total ?? s.total) }] : undefined),
    pointsLine:
      typeof earned === "number" || s.loyalty_amount
        ? {
            earned: earned,
            redeemed: s.loyalty_amount ? Math.round(s.loyalty_amount) : undefined,
            balance: balance,
            value: balance,
          }
        : undefined,
    footerMessage: s.footer_message,
    qrText: s.qr_url ?? (code ? receiptUrlFor(code) : undefined),
    extraBlocks: s.extra_blocks,
    company: company,
  };
}

/* ------------------------------------------------------------------ */
/* HTML building blocks                                                */
/* ------------------------------------------------------------------ */

const BASE_CSS_COMMON = `
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { background: #fff; }
  table { border-collapse: collapse; }
  img { display: block; }
  .df-toolbar { display: flex; gap: 8px; justify-content: center; padding: 10px; font-family: Arial, sans-serif; background: #F1F5F9; border-bottom: 1px solid #CBD5E1; }
  .df-toolbar button { padding: 6px 14px; font-size: 12px; font-weight: 700; border: 1px solid #94A3B8; border-radius: 6px; background: #fff; cursor: pointer; }
  @media print { .df-toolbar { display: none !important; } }
`;

const THERMAL_BODY_CSS = `
  body { width: 72mm; margin: 0 auto; font-family: "Courier New", Courier, monospace; font-size: 11px; color: #000; }
  .rc-center { text-align: center; }
  .rc-sep { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
  .rc-logo { margin: 0 auto 3px; max-height: 38px; max-width: 60%; object-fit: contain; }
  .rc-company { font-size: 15px; font-weight: 700; letter-spacing: 0.5px; }
  .rc-title { font-size: 13px; font-weight: 700; letter-spacing: 2px; margin-top: 4px; }
  .rc-meta { font-size: 10.5px; line-height: 1.45; }
  .rc-points { margin: 4px 0; padding: 4px 5px; background: #FFF9C4; border: 1px dashed #B8860B; text-align: center; font-size: 10.5px; line-height: 1.5; }
  .rc-points b { display: block; font-size: 11px; }
  table.rc-items { width: 100%; font-size: 10.5px; }
  table.rc-items th { text-align: left; border-bottom: 1px solid #000; padding: 1px 2px; font-size: 10px; }
  table.rc-items td { vertical-align: top; padding: 1.5px 2px; word-wrap: break-word; overflow-wrap: anywhere; }
  .rc-r { text-align: right; white-space: nowrap; }
  .rc-disc { display: block; font-size: 9px; color: #444; }
  .rc-totals { font-size: 10.5px; line-height: 1.55; }
  .rc-totals .row { display: flex; justify-content: space-between; }
  .rc-grand { display: flex; justify-content: space-between; border-top: 2px solid #000; margin-top: 3px; padding-top: 3px; font-size: 16px; font-weight: 700; }
  .rc-pay { font-size: 10.5px; line-height: 1.5; }
  .rc-pay .row { display: flex; justify-content: space-between; }
  .rc-qr { margin: 5px auto 0; width: 35mm; height: 35mm; }
  .rc-qr-cap { font-size: 9.5px; font-weight: 700; margin-top: 2px; }
  .rc-qr-url { font-size: 7.5px; color: #333; word-break: break-all; }
  .rc-footer { margin-top: 5px; border-top: 1px solid #000; padding-top: 3px; text-align: center; font-size: 10.5px; font-weight: 700; }
  .rc-pw { text-align: center; font-size: 8px; color: #555; margin-top: 2px; }
  .rc-extra { font-size: 10.5px; margin: 4px 0; }
  .rc-extra .hd { font-weight: 700; border-bottom: 1px dashed #000; margin-bottom: 2px; }
  .rc-extra .row { display: flex; justify-content: space-between; }
  @page { size: 80mm auto; margin: 3mm 3mm; }
  @media print { body { width: 72mm; } }
`;

const A4_BODY_CSS = `
  body { font-family: Arial, "Helvetica Neue", sans-serif; color: #111827; }
  .sheet { width: 186mm; margin: 0 auto; padding: 10mm 2mm; }
  table.rc-head { width: 100%; margin-bottom: 6mm; }
  table.rc-head td { vertical-align: middle; }
  .rc-logo { max-height: 64px; max-width: 30mm; object-fit: contain; }
  .rc-company { font-size: 21px; font-weight: 800; letter-spacing: 0.5px; color: #111827; }
  .rc-co-sub { font-size: 11px; color: #374151; line-height: 1.5; }
  .rc-doc-box { text-align: right; }
  .rc-title { font-size: 17px; font-weight: 800; letter-spacing: 2px; color: #111827; }
  .rc-doc-no { font-size: 12px; font-weight: 700; font-family: "Courier New", monospace; }
  .rc-meta { font-size: 11px; color: #374151; line-height: 1.55; }
  table.rc-items { width: 100%; font-size: 11.5px; border: 1px solid #111827; }
  table.rc-items th { background: #F3F4F6; border: 1px solid #111827; padding: 4px 6px; text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px; }
  table.rc-items td { border: 1px solid #9CA3AF; padding: 4px 6px; vertical-align: top; }
  .rc-r { text-align: right; white-space: nowrap; }
  .rc-disc { display: block; font-size: 9.5px; color: #6B7280; }
  .rc-totals { margin-top: 5mm; margin-left: auto; width: 84mm; font-size: 11.5px; }
  .rc-totals .row { display: flex; justify-content: space-between; padding: 2px 0; }
  .rc-grand { display: flex; justify-content: space-between; border-top: 3px double #111827; margin-top: 3px; padding-top: 4px; font-size: 17px; font-weight: 800; }
  .rc-points { margin: 5mm 0 0; padding: 4mm; background: #FFF9C4; border: 1.5px dashed #B8860B; text-align: center; font-size: 11.5px; line-height: 1.6; }
  .rc-points b { display: block; font-size: 12.5px; letter-spacing: 1px; }
  .rc-extra { margin: 4mm 0; font-size: 11.5px; }
  .rc-extra .hd { font-weight: 700; border-bottom: 1px dashed #9CA3AF; margin-bottom: 2px; }
  .rc-extra .row { display: flex; justify-content: space-between; padding: 1.5px 0; }
  .rc-qr-wrap { margin-top: 6mm; text-align: center; }
  .rc-qr { width: 32mm; height: 32mm; margin: 0 auto; }
  .rc-qr-cap { font-size: 10.5px; font-weight: 700; margin-top: 2mm; }
  .rc-qr-url { font-size: 9px; color: #6B7280; word-break: break-all; }
  .rc-footer { margin-top: 6mm; border-top: 1.5px solid #111827; padding-top: 3mm; text-align: center; font-size: 12px; font-weight: 700; }
  .rc-pw { text-align: center; font-size: 9px; color: #9CA3AF; margin-top: 2mm; }
  @page { size: A4 portrait; margin: 12mm 10mm; }
  @media print { .sheet { width: auto; padding: 0; } }
`;

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function logoBlock(m: ReceiptDocData, thermal: boolean): string {
  const initials = esc((m.company ?? "DF").slice(0, 2).toUpperCase());
  if (m.logoUrl) {
    return `<img class="rc-logo" src="${m.logoUrl}" alt="logo" />`;
  }
  if (thermal) {
    return `<div class="rc-center" style="font-size:17px;font-weight:700;border:1.5px solid #000;display:inline-block;padding:3px 8px;border-radius:4px;">${initials}</div>`;
  }
  return `<div style="width:56px;height:56px;border:2px solid #111827;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;margin-right:5mm;">${initials}</div>`;
}

function pointsBoxHtml(m: ReceiptDocData): string {
  if (!m.pointsLine || (!m.pointsLine.earned && !m.pointsLine.redeemed && !m.pointsLine.balance)) return "";
  const rows: string[] = [];
  if (m.customerLine) rows.push(esc(m.customerLine));
  if (m.pointsLine.redeemed) rows.push(`Points Used: ${m.pointsLine.redeemed} pts (KES ${m.pointsLine.redeemed})`);
  return `<div class="rc-points"><b>CUSTOMER POINTS [POINTS]</b>${rows.map((r) => `<div>${r}</div>`).join("")}</div>`;
}

function itemsHtml(m: ReceiptDocData, thermal: boolean): string {
  if (!m.lines?.length) return "";
  const rows = m.lines
    .map(
      (l) => `<tr>
        <td style="width:${thermal ? "12px" : "9mm"}">${l.no}</td>
        <td>${esc(l.name)}${l.discount > 0 ? `<span class="rc-disc">Discount KES ${l.discount.toFixed(2)}</span>` : ""}</td>
        <td class="rc-r">${l.qty}${l.unit && l.unit !== "pc" ? ` ${esc(l.unit)}` : ""} x ${l.unitPrice.toFixed(2)}</td>
        <td class="rc-r" style="font-weight:600;width:${thermal ? "17mm" : "22mm"}">${l.total.toFixed(2)}</td>
      </tr>`,
    )
    .join("");
  return `<table class="rc-items">
    <thead><tr><th>#</th><th>Item</th><th class="rc-r">Qty x Price</th><th class="rc-r">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function totalsHtml(m: ReceiptDocData): string {
  const rows = (m.totals ?? [])
    .map((t) => `<div class="row" ${t.bold ? 'style="font-weight:700"' : ""}><span>${esc(t.label)}</span><span>${esc(t.value)}</span></div>`)
    .join("");
  return `<div class="rc-totals">${rows}<div class="rc-grand"><span>GRAND TOTAL</span><span>${esc(m.grandTotal)}</span></div></div>`;
}

function paymentsHtml(m: ReceiptDocData): string {
  if (!m.paymentLines?.length) return "";
  return `<div class="rc-pay">${m.paymentLines
    .map((p) => `<div class="row"><span>${methodTag(p.method)} ${esc(p.method)}</span><span>${esc(p.amount)}</span></div>`)
    .join("")}</div>`;
}

function extraBlocksHtml(m: ReceiptDocData): string {
  if (!m.extraBlocks?.length) return "";
  return m.extraBlocks
    .map(
      (b) => `<div class="rc-extra"><div class="hd">${esc(b.heading)}</div>${b.rows
        .map((r) => `<div class="row" ${r.bold ? 'style="font-weight:700"' : ""}><span>${esc(r.label)}</span><span>${esc(r.value)}</span></div>`)
        .join("")}</div>`,
    )
    .join("");
}

function qrBlockHtml(qrBase64: string, qrUrl: string): string {
  return `<div class="rc-qr-wrap">
    ${qrBase64 ? `<img class="rc-qr" src="${qrBase64}" alt="QR" />` : `<div class="rc-qr" style="border:1px dashed #000;display:flex;align-items:center;justify-content:center;font-size:8px;">${esc(qrUrl)}</div>`}
    <div class="rc-qr-cap">Scan for Digital Receipt</div>
    ${qrUrl ? `<div class="rc-qr-url">${esc(qrUrl)}</div>` : ""}
  </div>`;
}

function etimsHtml(m: ReceiptDocData): string {
  if (!(m.etimsEnabled && m.cuInvoiceNumber)) return "";
  return `<div class="rc-center" style="font-weight:700;margin-top:2px;">KRA eTIMS Verified | CU No: ${esc(m.cuInvoiceNumber)}</div>`;
}

function toolbarHtml(): string {
  return `<div class="df-toolbar">
    <button onclick="window.print()">Print now</button>
    <button onclick="window.close()">Close</button>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Thermal (80mm roll) standalone document                             */
/* ------------------------------------------------------------------ */

export function buildThermalReceiptHTML(m: ReceiptDocData, qrBase64: string): string {
  const title = m.title ?? RECEIPT_TITLES[m.kind] ?? "RECEIPT";
  const url = m.qrText ?? (m.receiptCode ? receiptUrlFor(m.receiptCode) : "");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(title)} ${esc(m.docNo)}</title>
<style>${BASE_CSS_COMMON}${THERMAL_BODY_CSS}</style>
</head>
<body onload="window.print(); setTimeout(window.close, 800);">
${toolbarHtml()}
<div class="rc-center">
  ${logoBlock(m, true)}
  <div class="rc-company">${esc(m.company ?? "DukaFlow Ltd")}</div>
  ${m.kraPin ? `<div class="rc-meta">KRA PIN: ${esc(m.kraPin)}</div>` : ""}
  ${m.storeName ? `<div class="rc-meta" style="font-weight:700">${esc(m.storeName)}</div>` : ""}
  ${m.storeAddress ? `<div class="rc-meta">${esc(m.storeAddress)}</div>` : ""}
  ${m.storePhone ? `<div class="rc-meta">[PHONE] Tel: ${esc(m.storePhone)}</div>` : ""}
  ${m.tillNo ? `<div class="rc-meta">[TILL] Till No: ${esc(m.tillNo)}</div>` : ""}
</div>
<hr class="rc-sep" />
<div class="rc-center">
  <div class="rc-title">${esc(title)}</div>
  <div class="rc-meta" style="font-weight:700">${esc(m.docNo)}</div>
  <div class="rc-meta">${esc(m.date)}</div>
  ${m.servedBy ? `<div class="rc-meta">Served by: ${esc(m.servedBy)}</div>` : ""}
  ${m.customerName ? `<div class="rc-meta">Customer: ${esc(m.customerName)}</div>` : ""}
  ${etimsHtml(m)}
</div>
<hr class="rc-sep" />
${extraBlocksHtml(m)}
${itemsHtml(m, true)}
${pointsBoxHtml(m)}
${totalsHtml(m)}
${paymentsHtml(m)}
<hr class="rc-sep" />
${qrBlockHtml(qrBase64, url)}
<div class="rc-footer">${esc(m.footerMessage ?? "Thank you! Sema na sisi: 0712 345 678")}</div>
<div class="rc-pw">Powered by DukaFlow POS | ${new Date().getFullYear()}</div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* A4 (PDF ready) standalone document                                  */
/* ------------------------------------------------------------------ */

export function buildA4ReceiptHTML(m: ReceiptDocData, qrBase64: string): string {
  const title = m.title ?? RECEIPT_TITLES[m.kind] ?? "RECEIPT";
  const url = m.qrText ?? (m.receiptCode ? receiptUrlFor(m.receiptCode) : "");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(title)} ${esc(m.docNo)}</title>
<style>${BASE_CSS_COMMON}${A4_BODY_CSS}</style>
</head>
<body onload="window.print(); setTimeout(window.close, 800);">
${toolbarHtml()}
<div class="sheet">
  <table class="rc-head"><tr>
    <td style="width:34mm;">${m.logoUrl ? `<img class="rc-logo" src="${m.logoUrl}" alt="logo" />` : logoBlock(m, false)}</td>
    <td>
      <div class="rc-company">${esc(m.company ?? "DukaFlow Ltd")}</div>
      <div class="rc-co-sub">
        ${m.kraPin ? `KRA PIN: ${esc(m.kraPin)}<br />` : ""}
        ${m.storeName ? `${esc(m.storeName)}<br />` : ""}
        ${m.storeAddress ? `${esc(m.storeAddress)}<br />` : ""}
        ${m.storePhone ? `Tel: ${esc(m.storePhone)}` : ""}
        ${m.tillNo ? `${m.storePhone ? " | " : ""}Till No: ${esc(m.tillNo)}` : ""}
      </div>
    </td>
    <td class="rc-doc-box">
      <div class="rc-title">${esc(title)}</div>
      <div class="rc-doc-no">${esc(m.docNo)}</div>
      <div class="rc-meta">${esc(m.date)}</div>
      ${m.servedBy ? `<div class="rc-meta">Served by: ${esc(m.servedBy)}</div>` : ""}
      ${m.customerName ? `<div class="rc-meta">Customer: ${esc(m.customerName)}</div>` : ""}
      ${etimsHtml(m)}
    </td>
  </tr></table>
  ${extraBlocksHtml(m)}
  ${itemsHtml(m, false)}
  ${pointsBoxHtml(m)}
  ${totalsHtml(m)}
  ${paymentsHtml(m)}
  ${qrBlockHtml(qrBase64, url)}
  <div class="rc-footer">${esc(m.footerMessage ?? "Thank you! Sema na sisi: 0712 345 678")}</div>
  <div class="rc-pw">Generated by DukaFlow POS | ${new Date().getFullYear()}</div>
</div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* generateReceiptHTML: SaleData | ReceiptDocData to standalone HTML    */
/* ------------------------------------------------------------------ */

export type ReceiptPrintMode = "thermal" | "a4";

async function ensureQrBase64(m: ReceiptDocData): Promise<string> {
  const text = m.qrText ?? (m.receiptCode ? receiptUrlFor(m.receiptCode) : m.docNo);
  try {
    return await QRCode.toDataURL(text, { width: 512, margin: 1, errorCorrectionLevel: "M" });
  } catch {
    return "";
  }
}

/** Resolve the logo: explicit base64, then stored base64, then URL conversion. */
async function resolveLogo(m: ReceiptDocData, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const stored = getStoredLogoBase64();
  if (stored) return stored;
  if (m.logoUrl) return await convertImageToBase64(m.logoUrl);
  return "";
}

/**
 * Build the full standalone HTML for one sale. Accepts the flat SaleData shape
 * or an existing ReceiptDocData. All images in the output are base64; the QR is
 * generated locally by the qrcode library.
 */
export async function generateReceiptHTML(saleData: PrintDoc, mode: ReceiptPrintMode = "thermal"): Promise<string> {
  const m = await docToModel(saleData);
  const explicitLogo = (saleData as SaleData).logo_base64;
  const logo = await resolveLogo(m, explicitLogo);
  const model: ReceiptDocData = { ...m, logoUrl: logo || undefined };
  const qr = await ensureQrBase64(model);
  return mode === "a4" ? buildA4ReceiptHTML(model, qr) : buildThermalReceiptHTML(model, qr);
}

/* ------------------------------------------------------------------ */
/* Printing: popup window with hidden iframe fallback                  */
/* ------------------------------------------------------------------ */

/** Write a standalone document into a popup (preferred) or hidden iframe (fallback). */
export function openStandalonePrint(html: string, w = 380, h = 680): void {
  if (typeof window === "undefined") return;
  let win: Window | null = null;
  try {
    win = window.open("", "_blank", `width=${w},height=${h}`);
  } catch {
    win = null;
  }
  if (win && win.document) {
    try {
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      return;
    } catch {
      try {
        win.close();
      } catch {
        /* ignore */
      }
      win = null;
    }
  }
  // Popup blocked: hidden iframe printing (same standalone doc, same onload guard)
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.setAttribute("title", "print");
  frame.srcdoc = html;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      /* ignore */
    }
  };
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), 60000);
}

/** Print one sale (SaleData or ReceiptDocData) as thermal roll or A4 sheet. */
export async function printReceiptHTML(saleData: PrintDoc, mode: ReceiptPrintMode = "thermal"): Promise<void> {
  const html = await generateReceiptHTML(saleData, mode);
  openStandalonePrint(html, mode === "thermal" ? 380 : 860, mode === "thermal" ? 680 : 900);
}

function stripWrapper(html: string): string {
  return html.replace(/^[\s\S]*?<body[^>]*>/, "").replace(/<\/body>[\s\S]*$/, "");
}

/** Print one or many ReceiptDocData documents in one standalone job (page breaks between). */
export async function printReceiptDocs(docs: PrintDoc | PrintDoc[], mode: ReceiptPrintMode = "thermal"): Promise<void> {
  const list = Array.isArray(docs) ? docs : [docs];
  if (list.length === 0) return;
  const models = await Promise.all(list.map((d) => docToModel(d)));
  const explicitLogo = (list[0] as SaleData).logo_base64;
  const logo = await resolveLogo(models[0], explicitLogo);
  const bodies: string[] = [];
  let head = "";
  for (let i = 0; i < models.length; i++) {
    const model: ReceiptDocData = { ...models[i], logoUrl: logo || undefined };
    const qr = await ensureQrBase64(model);
    const full = mode === "a4" ? buildA4ReceiptHTML(model, qr) : buildThermalReceiptHTML(model, qr);
    if (i === 0) head = full.match(/<head>[\s\S]*?<\/head>/)?.[0] ?? "";
    bodies.push(stripWrapper(full));
  }
  const joined =
    bodies.length === 1
      ? bodies[0]
      : bodies.map((b) => `<div style="page-break-after: always;"></div>${b}`).join("");
  openStandalonePrint(
    `<!DOCTYPE html><html>${head.replace("<head>", '<head><meta charset="utf-8" />').replace(/<title>[\s\S]*?<\/title>/, "<title>DukaFlow documents</title>")}<body>${joined}</body></html>`,
    mode === "thermal" ? 380 : 860,
    mode === "thermal" ? 680 : 900,
  );
}

/* ------------------------------------------------------------------ */
/* Report capture: print a live A4 sheet node standalone               */
/* ------------------------------------------------------------------ */

const INLINE_PROPS = [
  "display", "position", "top", "left", "right", "bottom", "width", "height", "min-width", "min-height", "max-width", "max-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border", "border-top", "border-right", "border-bottom", "border-left", "border-radius", "border-collapse", "border-spacing",
  "background", "background-color", "background-image", "color", "opacity", "box-shadow",
  "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-decoration", "text-transform", "white-space", "word-break", "overflow-wrap",
  "flex", "flex-direction", "flex-wrap", "align-items", "justify-content", "gap", "grid-template-columns",
  "vertical-align", "list-style", "table-layout", "overflow",
] as const;

function inlineStylesInto(src: Element, dst: Element): void {
  const cs = window.getComputedStyle(src);
  const el = dst as HTMLElement;
  let css = "";
  for (const p of INLINE_PROPS) {
    const v = cs.getPropertyValue(p);
    if (v) css += `${p}:${v};`;
  }
  el.style.cssText = css + (el.getAttribute("style") ?? "");
}

async function cloneWithInlineStyles(el: Element): Promise<HTMLElement> {
  const clone = el.cloneNode(true) as HTMLElement;
  const srcEls: Element[] = [];
  const dstEls: Element[] = [];
  const walk = (s: Element, d: Element) => {
    srcEls.push(s);
    dstEls.push(d);
    const sc = Array.from(s.children);
    const dc = Array.from(d.children);
    for (let i = 0; i < sc.length && i < dc.length; i++) walk(sc[i], dc[i]);
  };
  walk(el, clone);
  for (let i = 0; i < srcEls.length; i++) inlineStylesInto(srcEls[i], dstEls[i]);
  // Inline every image as base64 so the standalone doc has zero external URLs
  const imgs = Array.from(clone.querySelectorAll("img"));
  const srcImgs = Array.from(el.querySelectorAll("img"));
  for (let i = 0; i < imgs.length; i++) {
    const url = srcImgs[i]?.getAttribute("src") ?? "";
    if (url && !url.startsWith("data:")) {
      const b64 = await convertImageToBase64(url);
      if (b64) imgs[i].setAttribute("src", b64);
    }
  }
  return clone;
}

/**
 * Capture a live report node (A4 sheet) with computed styles inlined and print
 * it from a standalone document. Immune to ancestor clipping and print races.
 */
export async function printElementStandalone(el: Element | null, page: "a4" | "thermal" = "a4"): Promise<void> {
  if (!el || typeof window === "undefined") return;
  const clone = await cloneWithInlineStyles(el);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>DukaFlow report</title>
<style>${BASE_CSS_COMMON}
  body { font-family: Arial, sans-serif; color: #111827; }
  @page { size: ${page === "a4" ? "A4 portrait" : "80mm auto"}; margin: ${page === "a4" ? "10mm" : "3mm"}; }
  @media print { body { margin: 0; } }
</style></head>
<body onload="window.print(); setTimeout(window.close, 800);">
${toolbarHtml()}
${clone.outerHTML}
</body></html>`;
  openStandalonePrint(html, page === "a4" ? 860 : 380, page === "a4" ? 900 : 680);
}

/* ------------------------------------------------------------------ */
/* WhatsApp share                                                      */
/* ------------------------------------------------------------------ */

export function whatsappShareReceipt(code: string, url: string): void {
  const text = encodeURIComponent(`Your DukaFlow receipt ${code} - ${url}`);
  window.open(`https://wa.me/?text=${text}`, "_blank");
}
