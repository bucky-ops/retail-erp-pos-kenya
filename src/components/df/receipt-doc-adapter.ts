/**
 * Adapter: converts a stored DigitalReceipt payload (the JSON snapshot written
 * by whichever feature created the document - sale, Z report, expense, ...) into
 * the ReceiptDocData model that the universal ReceiptDocument renders.
 *
 * Isomorphic and dependency-free: safe for the public /receipt/[code] page and
 * for in-app reprint flows (Receipts screen). No store or auth imports.
 */
import {
  ReceiptDocData,
  ReceiptLine,
  ReceiptTotalsRow,
  ReceiptExtraBlock,
  RECEIPT_TITLES,
  kes,
  fmtDate,
} from "@/lib/receipt";

export interface ReceiptMeta {
  receiptCode?: string;
  uuid?: string;
  kind?: string;
  title?: string;
  refNo?: string;
  url?: string;
  createdAt?: string;
}

type Row = Record<string, unknown>;

const str = (v: unknown, d = ""): string => (typeof v === "string" && v.trim() !== "" ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Human label for a receipt kind badge (short, chip friendly). */
export function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    SALE: "Sale",
    ZREPORT: "Z-Report",
    PAYSLIP: "Payslip",
    DEBT_PAYMENT: "Debt Payment",
    CREDITOR_PAYMENT: "Creditor Payment",
    QUOTATION: "Quotation",
    PROFORMA: "Proforma",
    ORDER: "Order",
    INVOICE: "Invoice",
    PAYMENT: "Payment",
    EXPENSE: "Expense",
    STOCK_ADJUSTMENT: "Stock Adj.",
    JOURNAL: "Journal",
    PAYMENT_ENTRY: "Payment Entry",
    PURCHASE_INVOICE: "Purchase Inv.",
    EXPENSE_CLAIM: "Expense Claim",
    STOCK_ENTRY: "Stock Entry",
  };
  return map[kind] ?? kind.replace(/_/g, " ");
}

export function payloadToReceiptDoc(payload: unknown, meta: ReceiptMeta = {}): ReceiptDocData {
  const p = (payload ?? {}) as Row;
  const kind = meta.kind ?? "SALE";

  // -- line items (sale style payloads) --------------------------------
  const rawItems = Array.isArray(p.items) ? (p.items as Row[]) : [];
  const lines: ReceiptLine[] = rawItems.slice(0, 200).map((it, i) => {
    const qty = num(it.qty, 1);
    const unitPrice = num(it.unitPrice);
    return {
      no: num(it.no, i + 1),
      name: str(it.name, "Item"),
      qty,
      unit: str(it.unit, "pc"),
      unitPrice,
      discount: num(it.discount),
      total: num(it.total, Math.round(unitPrice * qty * 100) / 100),
      emoji: typeof it.emoji === "string" ? it.emoji : undefined,
    };
  });

  const when = str(p.createdAt, str(p.closedAt, meta.createdAt ?? new Date().toISOString()));

  // -- totals rows ------------------------------------------------------
  const totals: ReceiptTotalsRow[] = [];
  if (lines.length > 0) {
    if (p.subtotal !== undefined) totals.push({ label: "Subtotal", value: kes(num(p.subtotal)) });
    if (num(p.discount) > 0) totals.push({ label: "Discount", value: `- ${kes(num(p.discount))}` });
    if (p.vat !== undefined) totals.push({ label: "VAT 16%", value: kes(num(p.vat)) });
  }

  const grand = num(p.total, num(p.totalSales));

  // -- payment lines (multi-pay splits first, else single method) -------
  let paymentLines: { method: string; amount: string }[] | undefined;
  if (Array.isArray(p.paySplits) && p.paySplits.length > 0) {
    paymentLines = (p.paySplits as Row[]).map((s) => ({
      method: str(s.method, "Payment"),
      amount: kes(num(s.amount)),
    }));
  } else if (typeof p.paymentMethod === "string" && p.paymentMethod) {
    paymentLines = [{ method: p.paymentMethod, amount: kes(grand) }];
  }

  // -- loyalty -----------------------------------------------------------
  const hasPoints =
    p.pointsEarned !== undefined || p.pointsRedeemed !== undefined || p.pointsBalance !== undefined;
  const pointsLine = hasPoints
    ? {
        earned: num(p.pointsEarned),
        redeemed: num(p.pointsRedeemed),
        balance: num(p.pointsBalance),
        value: num(p.pointValue, 1),
      }
    : undefined;

  // -- Z-report style extra blocks ---------------------------------------
  const extraBlocks: ReceiptExtraBlock[] = [];
  const sbm = (p.salesByMethod && typeof p.salesByMethod === "object" ? p.salesByMethod : null) as Row | null;
  if (sbm) {
    const methodRows = (
      [
        ["Cash", sbm.cash],
        ["M-Pesa Till", sbm.mpesaTill],
        ["M-Pesa Paybill", sbm.mpesaPaybill],
        ["Card", sbm.card],
        ["Points", sbm.points],
      ] as [string, unknown][]
    )
      .filter(([, v]) => v !== undefined)
      .map(([label, v]) => ({ label, value: kes(num(v)) }));
    if (methodRows.length) extraBlocks.push({ heading: "SALES BY METHOD", rows: methodRows });
  }
  if (p.zNo !== undefined || p.openingFloat !== undefined || p.closingCash !== undefined) {
    const rows: { label: string; value: string; bold?: boolean }[] = [];
    if (p.businessDate !== undefined) rows.push({ label: "Business Date", value: str(p.businessDate, "-") });
    if (p.receipts !== undefined) rows.push({ label: "Receipts Issued", value: String(num(p.receipts)) });
    if (p.openingFloat !== undefined) rows.push({ label: "Opening Float", value: kes(num(p.openingFloat)) });
    if (p.discounts !== undefined && num(p.discounts) !== 0)
      rows.push({ label: "Discounts", value: kes(num(p.discounts)) });
    if (p.returns !== undefined && num(p.returns) !== 0)
      rows.push({ label: "Returns", value: kes(num(p.returns)) });
    if (p.closingCash !== undefined) rows.push({ label: "Closing Cash", value: kes(num(p.closingCash)) });
    if (p.variance !== undefined) rows.push({ label: "Variance", value: kes(num(p.variance)), bold: true });
    if (rows.length) extraBlocks.push({ heading: "DAY RECONCILIATION", rows });
  }

  return {
    kind,
    title: meta.title ?? RECEIPT_TITLES[kind] ?? "RECEIPT",
    docNo: str(p.receiptNo, str(p.zNo, meta.refNo ?? meta.receiptCode ?? "DOC")),
    receiptCode: meta.receiptCode,
    date: fmtDate(when),
    storeName: str(p.storeName, "DukaFlow"),
    storeAddress: str(p.storeAddress) || undefined,
    storePhone: str(p.storePhone) || undefined,
    tillNo: str(p.tillNo) || undefined,
    kraPin: str(p.kraPin) || undefined,
    cuInvoiceNumber: str(p.cuInvoiceNumber) || undefined,
    etimsEnabled: p.etimsEnabled === true,
    servedBy: str(p.servedBy, str(p.approvedBy)) || undefined,
    customerName: str(p.customerName) || undefined,
    customerLine: str(p.customerLine) || undefined,
    lines,
    totals,
    grandTotal: kes(grand),
    paymentLines,
    pointsLine,
    footerMessage: str(p.footerMessage) || undefined,
    extraBlocks: extraBlocks.length ? extraBlocks : undefined,
  };
}
