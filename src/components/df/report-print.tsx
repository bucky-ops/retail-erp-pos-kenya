"use client";

/**
 * DukaFlow report print suite (A4).
 * ReportPrint   - company header + meta + verification QR + footer wrapper
 *                 for every printable report (accounting + reports screens).
 * ReportToolbar - on-screen toolbar: filters (children) + verification QR +
 *                 Print / Export PDF / Export Excel buttons (flex-wrap safe).
 * ReportTable   - print-friendly bordered table for A4 output.
 * printReportArea - print helper: reveals ONLY .df-report-sheet elements
 *                 (mirrors printReceiptArea from receipt-document.tsx).
 */

import { ReactNode, useEffect, useState } from "react";
import { FileSpreadsheet, FileText, Printer } from "lucide-react";
import { PUBLIC_BASE_URL, fmtDate } from "@/lib/receipt";
import { printElementStandalone } from "@/services/receiptService";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { QrImage } from "@/components/df/qr";

/* -- company profile (full Settings row from /api/bootstrap) ---------------- */

export interface CompanyProfile {
  companyName?: string;
  logoUrl?: string;
  companyPhone?: string;
  companyAddress?: string;
  kraPin?: string;
  tillNo?: string;
  receiptFooterMessage?: string;
}

/** Reads the zustand settings (bootstrap payload) as a company profile. */
export function useCompanyProfile(): CompanyProfile {
  const settings = useApp((s) => s.settings);
  const p = (settings ?? {}) as unknown as CompanyProfile;
  return {
    companyName: p.companyName || "DukaFlow Ltd",
    logoUrl: p.logoUrl || undefined,
    companyPhone: p.companyPhone || undefined,
    companyAddress: p.companyAddress || undefined,
    kraPin: p.kraPin || undefined,
    tillNo: p.tillNo || undefined,
    receiptFooterMessage: p.receiptFooterMessage || undefined,
  };
}

/** window.location.origin after mount (avoids SSR hydration mismatches). */
export function useOrigin(): string {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    // async boundary: read window.location after mount, never synchronously
    const t = setTimeout(() => setOrigin(window.location.origin), 0);
    return () => clearTimeout(t);
  }, []);
  return origin;
}

export function verifyLink(hash: string | undefined, origin: string): string {
  if (!hash) return "";
  return origin ? `${origin}/verify/${hash}` : `${PUBLIC_BASE_URL}/verify/${hash}`;
}

/* -- print helper ----------------------------------------------------------- */

/**
 * Prints the A4 report sheet(s). Usage:
 *   <div className="hidden print:block"><ReportPrint ...>...</ReportPrint></div>
 *   <Button onClick={() => { setPrintOpen(true); setTimeout(() => printReportArea(), 700); }}>
 */
export function printReportArea(): void {
  const style = document.createElement("style");
  style.id = "df-print-style";
  style.textContent = `
    @media print {
      @page { size: A4 portrait; margin: 10mm; }
      body * { visibility: hidden !important; }
      .df-report-sheet, .df-report-sheet * { visibility: visible !important; }
      .df-report-sheet { position: absolute !important; left: 0; top: 0; width: 190mm !important; min-height: 0 !important; box-shadow: none !important; }
    }
  `;
  const prev = document.getElementById("df-print-style");
  if (prev) prev.remove();
  document.head.appendChild(style);
  window.print();
}

/**
 * Naivas grade report printing: captures the rendered .df-report-sheet node with
 * computed styles inlined and prints it from a STANDALONE document (own window,
 * own onload, zero ancestor clipping, zero timing races). Prefer this over
 * printReportArea everywhere.
 */
export async function printReportStandalone(page: "a4" | "thermal" = "a4"): Promise<void> {
  const sheet = document.querySelector(".df-report-sheet");
  await printElementStandalone(sheet, page);
}

/* -- ReportPrint: the A4 sheet ---------------------------------------------- */

export function ReportPrint({
  title,
  company,
  generatedBy,
  generatedAt,
  filters,
  hash,
  qrText,
  footerNote,
  children,
  className,
}: {
  title: string;
  company?: CompanyProfile | null;
  generatedBy?: string;
  generatedAt?: string | Date;
  filters?: string[];
  hash?: string;
  qrText?: string;
  footerNote?: string;
  children: ReactNode;
  className?: string;
}) {
  const origin = useOrigin();
  const qr = qrText ?? verifyLink(hash, origin);
  const name = company?.companyName ?? "DukaFlow Ltd";
  const initials = name.slice(0, 2).toUpperCase();
  const when = fmtDate(generatedAt ?? new Date());

  return (
    <div
      className={cn("df-report-sheet relative mx-auto bg-white font-sans text-[#172B4D]", className)}
      style={{ width: "190mm", minHeight: "240mm", padding: "12mm 11mm" }}
    >
      {/* header: logo + company master + verification QR */}
      <div className="flex items-start justify-between gap-4 border-b-2 border-[#172B4D] pb-3">
        <div className="flex items-center gap-3">
          {company?.logoUrl ? (
            <img src={company.logoUrl} alt={`${name} logo`} className="h-14 w-14 object-contain" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded bg-[#172B4D] text-lg font-bold text-white">
              {initials}
            </div>
          )}
          <div>
            <div className="text-lg font-bold uppercase tracking-wide">{name}</div>
            {company?.companyAddress ? <div className="text-[10px] text-[#6B778C]">{company.companyAddress}</div> : null}
            {company?.companyPhone ? <div className="text-[10px] text-[#6B778C]">Tel: {company.companyPhone}</div> : null}
            {company?.kraPin ? <div className="text-[10px] text-[#6B778C]">KRA PIN: {company.kraPin}</div> : null}
          </div>
        </div>
        {qr ? (
          <div className="text-right">
            <QrImage text={qr} size={84} alt="Report verification QR" />
            {hash ? <div className="mt-1 font-mono text-[9px] text-[#6B778C]">Verify: {hash}</div> : null}
          </div>
        ) : null}
      </div>

      {/* title + generated meta + filters used */}
      <div className="mt-3 text-center">
        <h1 className="text-lg font-black uppercase tracking-widest">{title}</h1>
        <div className="mt-0.5 text-[10px] text-[#6B778C]">
          Generated by {generatedBy ?? "DukaFlow User"} - {when}
        </div>
        <div className="text-[10px] text-[#6B778C]">Filters: {filters?.length ? filters.join(" | ") : "none"}</div>
      </div>

      {/* report body */}
      <div className="mt-4">{children}</div>

      {/* page footer */}
      <div className="mt-6 border-t border-[#DFE1E6] pt-2 text-center text-[9px] text-[#6B778C]">
        DukaFlow Retail ERP - {PUBLIC_BASE_URL.replace("https://", "")}
        {footerNote ? <span> - {footerNote}</span> : null}
      </div>
    </div>
  );
}

/* -- ReportTable: print-friendly bordered table ------------------------------ */

export function ReportTable({
  head,
  rows,
  foot,
  className,
}: {
  head: string[];
  rows: (string | number)[][];
  foot?: (string | number)[];
  className?: string;
}) {
  return (
    <table className={cn("w-full border-collapse text-[10.5px]", className)}>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th
              key={`${h}-${i}`}
              className={cn(
                "border border-[#C9CFDA] bg-[#F4F5F7] px-2 py-1.5 font-bold uppercase tracking-wide",
                i > 0 && /^[\w /()-]*(KES|Qty|Count|Days|Rate)/i.test(h) ? "text-right" : "text-left"
              )}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={i % 2 === 1 ? "bg-[#FAFBFC]" : undefined}>
            {r.map((c, j) => (
              <td
                key={j}
                className={cn(
                  "border border-[#DFE1E6] px-2 py-1",
                  j > 0 && typeof c === "number" ? "text-right tabular-nums" : "text-left"
                )}
              >
                {typeof c === "number" ? c.toLocaleString("en-KE") : c}
              </td>
            ))}
          </tr>
        ))}
        {foot?.length ? (
          <tr>
            {foot.map((c, j) => (
              <td
                key={j}
                className={cn(
                  "border border-[#172B4D] bg-[#F4F5F7] px-2 py-1.5 font-bold",
                  j > 0 && typeof c === "number" ? "text-right tabular-nums" : "text-left"
                )}
              >
                {typeof c === "number" ? c.toLocaleString("en-KE") : c}
              </td>
            ))}
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

/* -- ReportToolbar: on-screen action bar with verification QR ---------------- */

export function ReportToolbar({
  children,
  hash,
  onPrint,
  printLabel = "Print",
  onExportPdf,
  onExport,
  exportLabel = "Export Excel",
  className,
}: {
  children?: ReactNode;
  hash?: string;
  onPrint?: () => void;
  printLabel?: string;
  onExportPdf?: () => void;
  onExport?: () => void;
  exportLabel?: string;
  className?: string;
}) {
  const origin = useOrigin();
  const qr = verifyLink(hash, origin);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {qr ? (
          <div className="flex items-center gap-2 rounded-xl border border-[#DFE1E6] bg-white px-2 py-1" title="Scan to verify this report">
            <QrImage text={qr} size={44} alt="Report verification QR" />
            <div className="text-[10px] leading-tight">
              <div className="font-bold text-[#172B4D]">Verify</div>
              <div className="font-mono text-[#6B778C]">{hash}</div>
            </div>
          </div>
        ) : null}
        {onPrint ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onPrint}
            className="h-8 border-[#C9CFDA] px-3 text-[12px] font-bold text-[#0052CC] hover:bg-[#E9F2FF] hover:text-[#0052CC]"
          >
            <Printer className="h-3.5 w-3.5" /> {printLabel}
          </Button>
        ) : null}
        {onExportPdf ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onExportPdf}
            className="h-8 border-[#C9CFDA] px-3 text-[12px] font-bold text-[#172B4D] hover:bg-[#F4F5F7]"
          >
            <FileText className="h-3.5 w-3.5" /> Export PDF
          </Button>
        ) : null}
        {onExport ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onExport}
            className="h-8 border-[#C9CFDA] px-3 text-[12px] font-bold text-[#172B4D] hover:bg-[#F4F5F7]"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> {exportLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
