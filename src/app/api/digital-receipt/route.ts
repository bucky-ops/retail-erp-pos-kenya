import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createDigitalReceipt, logAudit } from "@/lib/supermarket-server";
import { RECEIPT_TITLES } from "@/lib/receipt";

export const dynamic = "force-dynamic";

/**
 * Digital receipts: every printable document gets a public twin at
 * /receipt/{receiptCode} (NVS-DUKA-YYYY-XXXXX). Public lookup needs no login
 * - the code itself is the capability (obfuscated, unguessable sequence is
 * paired with a UUID alias used by support).
 */

/** GET /api/digital-receipt?code=NVS-DUKA-2026-00001  (public, no auth). */
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const code = sp.get("code");
  const list = sp.get("list");

  // Admin listing for the Receipts screen (latest first).
  if (list) {
    const take = Math.min(Number(sp.get("limit") ?? 60), 200);
    const kind = sp.get("kind");
    const rows = await db.digitalReceipt.findMany({
      where: kind ? { kind } : undefined,
      orderBy: { createdAt: "desc" },
      take,
    });
    return NextResponse.json({
      receipts: rows.map((r) => ({
        id: r.id,
        receiptCode: r.receiptCode,
        uuid: r.uuid,
        kind: r.kind,
        refNo: r.refNo,
        url: r.url,
        qrDataUrl: r.qrDataUrl,
        createdAt: r.createdAt,
      })),
    });
  }

  if (!code) return NextResponse.json({ ok: false, error: "code required" }, { status: 400 });
  const row = await db.digitalReceipt.findFirst({
    where: { OR: [{ receiptCode: code }, { uuid: code }] },
  });
  if (!row) return NextResponse.json({ ok: false, error: "Receipt not found" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    receipt: {
      receiptCode: row.receiptCode,
      uuid: row.uuid,
      kind: row.kind,
      title: RECEIPT_TITLES[row.kind] ?? "RECEIPT",
      refNo: row.refNo,
      url: row.url,
      qrDataUrl: row.qrDataUrl,
      payload: JSON.parse(row.payloadJson || "{}"),
      createdAt: row.createdAt,
    },
  });
}

/**
 * POST /api/digital-receipt - create a digital twin for any document.
 * Body: { kind, refNo?, payload } -> { receiptCode, url, qrDataUrl }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { kind: string; refNo?: string; payload?: unknown; actor?: string };
    if (!body.kind) return NextResponse.json({ ok: false, error: "kind required" }, { status: 400 });
    const doc = await createDigitalReceipt(body.kind, body.payload ?? {}, { refNo: body.refNo ?? "" });
    await logAudit({
      actor: body.actor ?? "system",
      action: "CREATE",
      entity: "DigitalReceipt",
      label: doc.receiptCode,
      details: body.kind,
    });
    return NextResponse.json({ ok: true, ...doc });
  } catch (err) {
    console.error("digital-receipt POST", err);
    return NextResponse.json({ ok: false, error: "Could not create digital receipt" }, { status: 500 });
  }
}
