import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { submitToEtims, generateInvoiceQr } from "@/lib/etims";

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/[id]/etims — (re)submit a sale to KRA eTIMS.
 * Used for invoices stuck in "Pending" (e.g. offline sync, device downtime).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sale = await db.sale.findUnique({ where: { id: Number(id) } });
  if (!sale) return NextResponse.json({ ok: false, error: "Sale not found" }, { status: 404 });

  if (sale.kraStatus === "Verified") {
    return NextResponse.json({ ok: true, sale, message: "Already verified with KRA eTIMS" });
  }

  const settings = await db.settings.findUnique({ where: { id: 1 } });
  if (!settings?.kraConnected) {
    return NextResponse.json({ ok: false, error: "KRA eTIMS not connected — check Settings" }, { status: 400 });
  }

  const submission = await submitToEtims({
    kraPin: settings.kraPin,
    branchId: settings.kraBranchId,
    deviceSerial: settings.kraDeviceSerial,
    invoiceNumber: sale.receiptNo,
    dateTime: sale.createdAt,
    total: sale.total,
    tax: sale.vat,
  });

  if (!submission.ok) {
    return NextResponse.json({ ok: false, error: submission.message }, { status: 502 });
  }

  const qrCodeBase64 = await generateInvoiceQr(submission.qrData ?? sale.receiptNo);
  const updated = await db.sale.update({
    where: { id: sale.id },
    data: {
      kraStatus: "Verified",
      cuInvoiceNumber: submission.cuInvoiceNumber ?? null,
      qrCodeBase64,
    },
  });

  return NextResponse.json({ ok: true, sale: updated, message: `Invoice submitted — CU ${submission.cuInvoiceNumber}` });
}
