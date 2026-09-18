/**
 * Server helpers for Naivas-style supermarket mode.
 * Digital receipts, business-date locking, audit + version logging.
 */
import { db } from "@/lib/db";
import { generateQr } from "@/lib/etims";
import { receiptCodeFromCount, receiptUrlFor, ReceiptKind } from "@/lib/receipt";

/** Business date in Africa/Nairobi (the shop clock). */
export function businessDate(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
}

/** Create a DigitalReceipt row (public twin at /receipt/{code}). */
export async function createDigitalReceipt(
  kind: ReceiptKind | string,
  payload: unknown,
  opts: { saleId?: number; refNo?: string } = {},
): Promise<{ receiptCode: string; url: string; qrDataUrl: string }> {
  const count = await db.digitalReceipt.count();
  const receiptCode = receiptCodeFromCount(count);
  const url = receiptUrlFor(receiptCode);
  let qrDataUrl = "";
  try {
    qrDataUrl = await generateQr(url, 300);
  } catch {
    qrDataUrl = "";
  }
  await db.digitalReceipt.create({
    data: {
      receiptCode,
      kind,
      saleId: opts.saleId ?? null,
      refNo: opts.refNo ?? "",
      url,
      qrDataUrl,
      payloadJson: JSON.stringify(payload ?? {}),
    },
  });
  return { receiptCode, url, qrDataUrl };
}

/**
 * Naivas day lock: once a business date is closed (Z issued) no sales can be
 * added to that date WITHOUT a manager PIN. Returns null when allowed, or a
 * response-ready error object.
 */
export async function checkDayLock(
  storeId: number,
  at: Date = new Date(),
  managerPin?: string,
): Promise<{ locked: boolean; reason?: string; zNo?: string }> {
  const date = businessDate(at);
  const closed = await db.dayClose.findFirst({
    where: { storeId, businessDate: date, status: "Closed" },
  });
  if (!closed) return { locked: false };
  if (managerPin) {
    const mgr = await db.staff.findFirst({
      where: {
        pin: String(managerPin),
        role: { in: ["Manager", "Owner"] },
      },
    });
    if (mgr) return { locked: false };
  }
  return {
    locked: true,
    reason: `Day ${date} is closed (Z ${closed.zNo}). Sales for this date are locked. A Manager or Owner PIN is required to override.`,
    zNo: closed.zNo,
  };
}

export async function logAudit(entry: {
  actor: string;
  action: string;
  entity: string;
  entityId?: string | number;
  label?: string;
  details?: string;
  storeId?: number | null;
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actor: entry.actor || "system",
        action: entry.action,
        entity: entry.entity,
        entityId: String(entry.entityId ?? ""),
        label: entry.label ?? "",
        details: entry.details ?? "",
        storeId: entry.storeId ?? null,
      },
    });
  } catch {
    /* audit must never break the request */
  }
}

/** Diff two row objects and record an ERPNext style version log. */
export async function logVersion(
  entity: string,
  entityId: number,
  editor: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  try {
    const changes: { field: string; from: unknown; to: unknown }[] = [];
    for (const key of Object.keys(after)) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changes.push({ field: key, from: before[key], to: after[key] });
      }
    }
    if (!changes.length) return;
    await db.versionLog.create({
      data: { entity, entityId, editor: editor || "system", changes: JSON.stringify(changes) },
    });
  } catch {
    /* never break the request */
  }
}
