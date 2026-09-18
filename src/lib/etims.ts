/**
 * KRA eTIMS helpers - CU invoice numbers, QR payload, status machine.
 * This is a local simulator (mock endpoint) standing in for the KRA eTIMS OSU API.
 */
import QRCode from "qrcode";

export interface EtimsInvoicePayload {
  kraPin: string;
  branchId: string;
  deviceSerial: string;
  invoiceNumber: string;
  dateTime: Date;
  total: number;
  tax: number;
  buyerPin?: string | null;
}

export interface EtimsSubmission {
  ok: boolean;
  cuInvoiceNumber?: string;
  qrData?: string;
  message: string;
}

/** Simulates POST to KRA eTIMS → returns CU invoice number + QR string. */
export async function submitToEtims(p: EtimsInvoicePayload): Promise<EtimsSubmission> {
  // Deterministic-ish CU number: KRAMW{branch}{seq}{yyyymmdd}
  const d = p.dateTime;
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const seq = String(Math.floor(Math.random() * 900) + 100);
  const cuInvoiceNumber = `KRAMW${p.branchId}${seq}-${ymd}-${p.invoiceNumber.replace(/[^0-9]/g, "").slice(-4)}`;

  // eTIMS QR payload: KRA PIN;INVOICE;DATETIME;TOTAL;CU NUMBER;MRD
  const qrData = [
    p.kraPin,
    p.invoiceNumber,
    d.toISOString().replace("T", " ").slice(0, 19),
    p.total.toFixed(2),
    cuInvoiceNumber,
    p.deviceSerial,
  ].join(";");

  return { ok: true, cuInvoiceNumber, qrData, message: "Invoice successfully submitted to KRA eTIMS" };
}

/** Renders the QR (PNG data URL, base64) for the invoice payload. */
export async function generateInvoiceQr(qrData: string): Promise<string> {
  return QRCode.toDataURL(qrData, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
    color: { dark: "#172B4D", light: "#FFFFFF" },
  });
}

/** Generic QR for gift cards / loyalty cards / anything. */
export async function generateQr(text: string, width = 260): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width, color: { dark: "#172B4D", light: "#FFFFFF" } });
}
