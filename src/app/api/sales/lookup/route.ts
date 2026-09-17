import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/sales/lookup?receiptNo=INV-2847
 *
 * Powers the POS Quick-Return flow: a cashier scans (barcode gun) or types a
 * receipt number at the till and gets back the sale with, per line, how many
 * units are still REFUNDABLE (sold qty minus every prior return). Doing the
 * aggregation here keeps the till dumb and makes the over-return rule
 * impossible to bypass, because the process-return endpoint re-validates
 * server-side anyway (defence in depth).
 *
 * Response shape (404 when nothing matches):
 * { ok, sale: { id, receiptNo, createdAt, paymentMethod, total, subtotal,
 *   storeName, customerName, customerPhone, kraStatus,
 *   items: [{ id, productId, name, emoji, qty, unitPrice, alreadyReturned, refundable }] } }
 */
export async function GET(req: NextRequest) {
  const receiptNo = (new URL(req.url).searchParams.get("receiptNo") ?? "").trim();
  if (!receiptNo) {
    return NextResponse.json({ ok: false, error: "receiptNo is required" }, { status: 400 });
  }

  // Case-insensitive match so "inv-2847", "INV-2847" and "2847" all resolve.
  const raw = receiptNo.toUpperCase().replace(/\s/g, "");
  const normalized = raw.startsWith("INV-") ? raw : `INV-${raw.replace(/^INV/, "")}`;

  const sale = await db.sale.findFirst({
    where: { OR: [{ receiptNo: raw }, { receiptNo: normalized }] },
    include: {
      items: true,
      store: { select: { name: true } },
      customer: { select: { name: true, phone: true } },
    },
  });

  if (!sale) {
    return NextResponse.json({ ok: false, error: `No receipt found for ${receiptNo}` }, { status: 404 });
  }

  // Aggregate every prior return line of this sale → already-returned qty per SaleItem.
  const priorReturns = await db.salesReturn.findMany({
    where: { saleId: sale.id },
    select: { items: { select: { saleItemId: true, qty: true } } },
  });
  const returned = new Map<number, number>();
  for (const r of priorReturns) {
    for (const it of r.items) {
      if (it.saleItemId != null) returned.set(it.saleItemId, (returned.get(it.saleItemId) ?? 0) + it.qty);
    }
  }

  return NextResponse.json({
    ok: true,
    sale: {
      id: sale.id,
      receiptNo: sale.receiptNo,
      createdAt: sale.createdAt,
      paymentMethod: sale.paymentMethod,
      subtotal: sale.subtotal,
      total: sale.total,
      storeName: sale.store.name,
      customerName: sale.customer?.name ?? "Walk-in",
      customerPhone: sale.customer?.phone ?? null,
      kraStatus: sale.kraStatus,
      items: sale.items.map((it) => {
        const back = returned.get(it.id) ?? 0;
        return {
          id: it.id,
          productId: it.productId,
          name: it.name,
          emoji: it.emoji,
          qty: it.qty,
          unitPrice: it.unitPrice,
          alreadyReturned: back,
          refundable: Math.max(0, it.qty - back),
        };
      }),
    },
  });
}
