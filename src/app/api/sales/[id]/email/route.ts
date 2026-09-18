import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildInvoiceEmailForSale } from "@/lib/invoice-email";

export const dynamic = "force-dynamic";

/**
 * DukaFlow - KRA e-invoice email.
 *
 * GET  /api/sales/[id]/email  → preview (subject + body + suggested recipient)
 *                               without sending - powers the Receipts dialog.
 * POST /api/sales/[id]/email  { to?: string }
 *                             → sends (mock mailer → SmsLog channel "Email",
 *                               type "Invoice", auditable in Messages) and
 *                               stamps the customer's email on file when the
 *                               caller didn't override it.
 *
 * Only KRA-Verified sales can be emailed: an "e-invoice" is only legally real
 * once eTIMS has stamped its CU number - pending receipts get a 400 telling
 * the cashier to run Retry eTIMS first.
 */

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const data = await buildInvoiceEmailForSale(Number(id));
  if (!data) return NextResponse.json({ ok: false, error: "Sale not found" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    subject: data.subject,
    body: data.body,
    to: data.customerEmail,
    kraStatus: data.sale.kraStatus,
    verified: data.sale.kraStatus === "Verified",
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const payload = (await req.json().catch(() => ({}))) as { to?: string };
    const data = await buildInvoiceEmailForSale(Number(id));
    if (!data) return NextResponse.json({ ok: false, error: "Sale not found" }, { status: 404 });

    if (data.sale.kraStatus !== "Verified") {
      return NextResponse.json(
        { ok: false, error: "Invoice is not KRA-verified yet - run Retry eTIMS first" },
        { status: 400 }
      );
    }

    const to = (payload.to ?? "").trim() || data.customerEmail;
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return NextResponse.json(
        { ok: false, error: "No valid recipient email - the customer has no email on file, type one in" },
        { status: 400 }
      );
    }

    await db.smsLog.create({
      data: {
        customerId: data.sale.customerId,
        phone: to,
        message: data.body,
        channel: "Email",
        type: "Invoice",
        status: "Delivered",
        cost: 0,
      },
    });

    // Remember the address on the customer so future invoices auto-send.
    if (data.sale.customerId && !data.customerEmail) {
      await db.customer.update({ where: { id: data.sale.customerId }, data: { email: to } });
    }

    return NextResponse.json({ ok: true, to, subject: data.subject });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Email failed" },
      { status: 500 }
    );
  }
}
