import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Supplier statement email - mock mailer (audited in Messages → SmsLog
 * channel "Email", type "Supplier Statement"), mirroring the debtor
 * statement email flow. Closes the procurement reconciliation loop: the
 * buyer sends the supplier the net position (goods received − RTV −
 * pending credits) straight from the statement they already print.
 *
 * GET  /api/suppliers/[id]/statement/email          → preview (no send)
 * POST /api/suppliers/[id]/statement/email { to? }  → send; a typed address
 *                                                     is saved on the supplier
 *                                                     for future statements.
 */

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const fmtDay = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const built = await buildSupplierStatementEmail(Number(id));
  if (!built) return NextResponse.json({ ok: false, error: "Supplier not found" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    subject: built.subject,
    body: built.body,
    to: built.supplierEmail,
    supplierName: built.supplier.name,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supplierId = Number(id);
  let to = "";
  try {
    const b = (await req.json()) as { to?: string };
    to = (b.to ?? "").trim();
  } catch {
    /* empty body is fine - fall back to the email on file */
  }

  const built = await buildSupplierStatementEmail(supplierId);
  if (!built) return NextResponse.json({ ok: false, error: "Supplier not found" }, { status: 404 });

  const recipient = to || built.supplierEmail;
  if (!recipient) {
    return NextResponse.json(
      { ok: false, error: "No email address - enter one, or save an email on the supplier first." },
      { status: 400 }
    );
  }

  // Mock mailer → auditable message log (same channel the real provider would use).
  await db.smsLog.create({
    data: {
      phone: recipient,
      message: built.body,
      channel: "Email",
      type: "Supplier Statement",
      status: "Delivered",
      cost: 0,
    },
  });

  // Persist a typed address so future statements auto-address themselves.
  if (to && to !== built.supplierEmail) {
    await db.supplier.update({ where: { id: supplierId }, data: { email: to } });
  }

  return NextResponse.json({ ok: true, to: recipient, supplier: built.supplier.name });
}

/** Loads the supplier's full reconciliation picture and renders the email body. */
async function buildSupplierStatementEmail(supplierId: number) {
  const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return null;

  const pos = await db.purchaseOrder.findMany({
    where: { supplierId },
    orderBy: { orderedAt: "asc" },
    take: 100,
    include: { items: true },
  });
  const rtvs = await db.supplierReturn.findMany({
    where: { supplierId },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  const prices = await db.supplierPrice.findMany({
    where: { supplierId },
    include: { product: { select: { cost: true } } },
  });

  const settings = await db.settings.findFirst();
  const companyName = settings?.companyName ?? "DukaFlow Ltd";

  // Same reconciliation math as GET /api/suppliers/[id]/statement.
  const purchasedValue = pos.reduce(
    (a, po) => a + po.items.reduce((s, it) => s + it.received * it.unitCost, 0),
    0
  );
  const openOrdersValue = pos
    .filter((po) => po.status === "Sent" || po.status === "Partially Received")
    .reduce((a, po) => a + po.items.reduce((s, it) => s + Math.max(0, it.qty - it.received) * it.unitCost, 0), 0);
  const returnedValue = rtvs.reduce((a, r) => a + r.total, 0);
  const creditedValue = rtvs.filter((r) => r.status === "Credited").reduce((a, r) => a + r.total, 0);
  const pendingCreditValue = returnedValue - creditedValue;
  const netTraded = purchasedValue - returnedValue;
  const priceListSavings = prices.reduce((a, p) => a + Math.max(0, p.product.cost - p.cost), 0);

  const poLines = pos.length
    ? pos
        .slice(-8) // last 8 POs keep the email readable; full history is in the app
        .map((po) => {
          const received = po.items.reduce((s, it) => s + it.received * it.unitCost, 0);
          const outstanding = Math.max(0, po.total - received);
          return `  • ${po.poNo} - ${fmtDay(po.orderedAt)} - ${po.status} - ordered ${fmtKES(po.total)}${
            po.status === "Cancelled" ? "" : `, received ${fmtKES(received)}${outstanding > 0 ? `, outstanding ${fmtKES(outstanding)}` : ""}`
          }`;
        })
        .join("\n")
    : "  • (no purchase orders yet)";
  const dnLines = rtvs.length
    ? rtvs
        .map(
          (r) =>
            `  • ${r.debitNoteNo} - ${fmtDay(r.createdAt)} - ${fmtKES(r.total)} - ${r.status}${
              r.status !== "Credited" ? " ⚠ awaiting supplier credit" : ""
            }`
        )
        .join("\n")
    : "  • (none - thank you!)";

  const subject = `${companyName} - Supplier Statement ${supplier.name} (net traded ${fmtKES(netTraded)})`;
  const body = [
    `Habari ${supplier.name},`,
    "",
    `Here is the procurement reconciliation statement for your account with ${companyName}. Kindly confirm the figures below against your invoices, especially any pending debit-note credits.`,
    "",
    `Statement date:   ${fmtDay(new Date())}`,
    `Supplier:         ${supplier.name}${supplier.phone ? ` (${supplier.phone})` : ""}`,
    `KRA PIN:          ${supplier.kraPin || "-"}   •   Lead time: ${supplier.leadDays} days`,
    "",
    "Reconciliation summary",
    `  Goods received (GRN-verified):   ${fmtKES(purchasedValue)}`,
    `  Returned to vendor (RTV):        −${fmtKES(returnedValue)}`,
    `  NET TRADED:                      ${fmtKES(netTraded)}`,
    `  Open purchase orders:            ${fmtKES(openOrdersValue)}`,
    `  Debit notes not yet credited:    ${pendingCreditValue > 0 ? fmtKES(pendingCreditValue) + "  ⚠ follow up" : fmtKES(0)}`,
    "",
    "Recent purchase orders",
    poLines,
    "",
    "Debit notes (returns to vendor)",
    dnLines,
    "",
    prices.length
      ? `Negotiated price list: ${prices.length} item${prices.length === 1 ? "" : "s"} on file - saving ${fmtKES(priceListSavings)} per reorder cycle vs catalog.`
      : "Negotiated price list: none on file yet - happy to set one up.",
    "",
    netTraded >= 0
      ? "Kindly issue/confirm any pending credit notes with your next delivery."
      : "A credit balance is due to us - kindly process the refund or offset it on the next order.",
    "Asante sana for the continued partnership!",
    `${companyName} • procurement@dukaflow.co.ke • +254 700 123 456`,
  ].join("\n");

  return { supplier, subject, body, supplierEmail: supplier.email || "" };
}
