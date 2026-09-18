"use client";

/**
 * Universal DukaFlow receipt document.
 * One component renders every document type (sales receipt, Z report,
 * payslip, debt / creditor payment, quotation, proforma, order, invoice,
 * payment, expense, stock adjustment) in two modes:
 *   - thermal: 80mm receipt printer roll
 *   - a4: full A4 sheet (PDF print)
 * The QR code is generated LOCALLY (qrcode lib) so receipts still print when
 * the shop internet is down - sync happens later.
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ReceiptDocData, methodTag, RECEIPT_TITLES } from "@/lib/receipt";
import { cn } from "@/lib/utils";

const THERMAL_W = "80mm";

function useQr(text?: string) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let alive = true;
    if (!text) {
      // clear asynchronously so the effect never sets state synchronously
      const t = setTimeout(() => alive && setSrc(""), 0);
      return () => {
        alive = false;
        clearTimeout(t);
      };
    }
    QRCode.toDataURL(text, { width: 320, margin: 1, errorCorrectionLevel: "M" })
      .then((d) => alive && setSrc(d))
      .catch(() => alive && setSrc(""));
    return () => {
      alive = false;
    };
  }, [text]);
  return src;
}

export function ReceiptDocument({
  data,
  mode = "thermal",
  className,
}: {
  data: ReceiptDocData;
  mode?: "thermal" | "a4";
  className?: string;
}) {
  const qrText = data.qrText ?? (data.receiptCode ? data.receiptCode : data.docNo);
  const qr = useQr(qrText);
  const title = data.title ?? RECEIPT_TITLES[data.kind] ?? "RECEIPT";
  const thermal = mode === "thermal";

  return (
    <div
      className={cn(
        "df-receipt bg-white text-black",
        thermal ? "mx-auto font-mono" : "mx-auto font-sans",
        className,
      )}
      style={
        thermal
          ? { width: THERMAL_W, fontSize: "10.5px", lineHeight: 1.35 }
          : { width: "190mm", minHeight: "250mm", fontSize: "12.5px", padding: "14mm 12mm" }
      }
    >
      {/* Header: company master block */}
      <div className={cn("text-center border-b border-black pb-2", !thermal && "mb-4 pb-4 border-b-2")}>
        {data.logoUrl ? (
          <img
            src={data.logoUrl}
            alt={`${data.company ?? "Company"} logo`}
            className="mx-auto mb-1 object-contain"
            style={{ height: thermal ? 34 : 64 }}
          />
        ) : (
          <div
            className={cn("mx-auto mb-1 rounded bg-black text-white font-bold flex items-center justify-center", thermal && "text-[13px]")}
            style={{ width: thermal ? 34 : 56, height: thermal ? 34 : 56, fontSize: thermal ? 13 : 20 }}
          >
            {(data.company ?? "DukaFlow").slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className={cn("font-bold uppercase", thermal ? "text-[13px]" : "text-xl tracking-wide")}>
          {data.company ?? "DukaFlow Ltd"}
        </div>
        {data.kraPin ? <div>KRA PIN: {data.kraPin}</div> : null}
        {data.storeName ? <div className="font-semibold">{data.storeName}</div> : null}
        {data.storeAddress ? <div>{data.storeAddress}</div> : null}
        {data.storePhone ? <div>Tel: {data.storePhone}</div> : null}
        {data.tillNo ? <div>Till No: {data.tillNo}</div> : null}
      </div>

      {/* Doc title + meta */}
      <div className={cn("text-center py-2", thermal ? "" : "py-4")}>
        <div className={cn("font-bold tracking-widest", thermal ? "text-[12px]" : "text-2xl")}>{title}</div>
        <div className={cn(thermal ? "text-[10px]" : "text-sm text-neutral-700")}>{data.docNo}</div>
        <div className={cn(thermal ? "text-[10px]" : "text-sm")}>{data.date}</div>
        {data.servedBy ? <div className={cn(thermal ? "text-[10px]" : "text-sm")}>Served by: {data.servedBy}</div> : null}
        {data.customerName ? (
          <div className={cn(thermal ? "text-[10px]" : "text-sm")}>Customer: {data.customerName}</div>
        ) : null}
        {data.etimsEnabled && data.cuInvoiceNumber ? (
          <div className={cn("font-semibold", thermal ? "text-[10px]" : "text-sm")}>
            KRA eTIMS Verified | CU No: {data.cuInvoiceNumber}
          </div>
        ) : null}
      </div>

      {/* Extra blocks (Z report sections etc.) BEFORE line items */}
      {data.extraBlocks?.map((b, i) => (
        <div key={i} className={cn("mb-2", thermal ? "text-[10px]" : "text-sm")}>
          <div className="font-bold border-b border-dashed border-black mb-1">{b.heading}</div>
          <table className="w-full">
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j}>
                  <td className={cn(r.bold && "font-bold")}>{r.label}</td>
                  <td className={cn("text-right tabular-nums", r.bold && "font-bold")}>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Items */}
      {data.lines?.length ? (
        <div className={cn(thermal ? "text-[10px]" : "text-sm")}>
          <table className="w-full">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="pr-1 font-bold">#</th>
                <th className="font-bold">Item</th>
                <th className="text-right font-bold">Qty</th>
                <th className="text-right font-bold">Price</th>
                <th className="text-right font-bold pl-1">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.no} className="align-top">
                  <td className="pr-1">{l.no}</td>
                  <td>
                    {l.name}
                    {l.discount > 0 ? (
                      <span className="block text-[9px]">Disc KES {l.discount.toFixed(2)}</span>
                    ) : null}
                  </td>
                  <td className="text-right tabular-nums">
                    {l.qty}
                    {l.unit && l.unit !== "pc" ? ` ${l.unit}` : ""}
                  </td>
                  <td className="text-right tabular-nums">{l.unitPrice.toFixed(2)}</td>
                  <td className="text-right tabular-nums pl-1 font-semibold">{l.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Totals */}
      <div className={cn("mt-2 border-t border-dashed border-black pt-1", thermal ? "text-[10px]" : "text-sm")}>
        {data.totals.map((t, i) => (
          <div key={i} className={cn("flex justify-between", t.bold && "font-bold", t.large && "text-[13px] font-black")}>
            <span>{t.label}</span>
            <span className="tabular-nums">{t.value}</span>
          </div>
        ))}
        <div
          className={cn(
            "flex justify-between font-black border-t-2 border-black mt-1 pt-1",
            thermal ? "text-[15px]" : "text-2xl",
          )}
        >
          <span>GRAND TOTAL</span>
          <span className="tabular-nums">{data.grandTotal}</span>
        </div>
      </div>

      {/* Payments */}
      {data.paymentLines?.length ? (
        <div className={cn("mt-2", thermal ? "text-[10px]" : "text-sm")}>
          {data.paymentLines.map((p, i) => (
            <div key={i} className="flex justify-between">
              <span>
                {methodTag(p.method)} {p.method}
              </span>
              <span className="tabular-nums">{p.amount}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Loyalty */}
      {data.pointsLine && (data.pointsLine.earned || data.pointsLine.redeemed || data.pointsLine.balance) ? (
        <div className={cn("mt-2 border border-dashed border-black px-1 py-1 text-center", thermal ? "text-[10px]" : "text-sm")}>
          <div className="font-bold">CUSTOMER POINTS [POINTS]</div>
          {data.customerLine ? <div>{data.customerLine}</div> : null}
        </div>
      ) : null}

      {/* QR + footer */}
      <div className="mt-3 text-center">
        {qr ? (
          <>
            <img src={qr} alt="Verification QR code" className="mx-auto" style={{ width: thermal ? 96 : 140 }} />
            <div className={cn("font-semibold", thermal ? "text-[9px]" : "text-xs")}>Scan for Digital Receipt</div>
          </>
        ) : (
          <div className={cn("text-[9px]")}>Digital receipt: {qrText}</div>
        )}
        <div className={cn("mt-2 border-t border-black pt-1 font-semibold", thermal ? "text-[10px]" : "text-sm")}>
          {data.footerMessage ?? "Thank you! Sema na sisi: 0712 345 678"}
        </div>
        <div className={cn(thermal ? "text-[8px]" : "text-[10px] text-neutral-500")}>
          Powered by DukaFlow POS | {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}

/**
 * Print helper: renders ONLY the receipt area. Usage in screens:
 *   <div id="df-print-host" className="hidden print:block"><ReceiptDocument .../></div>
 *   <Button onClick={() => printReceiptArea()}>Print</Button>
 */
export function printReceiptArea(mode: "thermal" | "a4" = "thermal"): void {
  const style = document.createElement("style");
  style.id = "df-print-style";
  style.textContent = `
    @media print {
      @page { size: ${mode === "thermal" ? "80mm auto" : "A4 portrait"}; margin: ${mode === "thermal" ? "3mm" : "10mm"}; }
      body * { visibility: hidden !important; }
      .df-receipt, .df-receipt * { visibility: visible !important; }
      .df-receipt { position: absolute !important; left: 0; top: 0; width: ${mode === "thermal" ? THERMAL_W : "190mm"} !important; }
    }
  `;
  const prev = document.getElementById("df-print-style");
  if (prev) prev.remove();
  document.head.appendChild(style);
  window.print();
}
