import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/suppliers/[id]/statement - everything the procurement reconciliation
 * statement needs for one supplier:
 *   • purchase orders (every status) with per-PO received/outstanding value,
 *   • return-to-vendor debit notes (credited vs pending),
 *   • the negotiated price list with catalog comparison (savings potential),
 *   • a reconciliation summary (purchased, returned, net traded, open orders).
 *
 * The UI renders this as a printable A4 supplier statement inside the
 * Procurement › Suppliers tab.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supplierId = Number(id);
  if (!Number.isFinite(supplierId)) {
    return NextResponse.json({ ok: false, error: "Bad supplier id" }, { status: 400 });
  }

  const supplier = await db.supplier.findUnique({
    where: { id: supplierId },
    include: { _count: { select: { purchaseOrders: true, supplierReturns: true, prices: true } } },
  });
  if (!supplier) return NextResponse.json({ ok: false, error: "Supplier not found" }, { status: 404 });

  // -- purchase orders (oldest first, statement reading order) --
  const pos = await db.purchaseOrder.findMany({
    where: { supplierId },
    orderBy: { orderedAt: "asc" },
    take: 100,
    include: {
      store: { select: { name: true } },
      items: { include: { product: { select: { name: true, emoji: true } } } },
    },
  });

  // -- RTV debit notes --
  const rtvs = await db.supplierReturn.findMany({
    where: { supplierId },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: {
      store: { select: { name: true } },
      items: { include: { product: { select: { name: true, emoji: true } } } },
    },
  });

  // -- negotiated price list vs catalog --
  const prices = await db.supplierPrice.findMany({
    where: { supplierId },
    include: { product: { select: { name: true, sku: true, unit: true, emoji: true, cost: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  // -- reconciliation math --
  // "purchased" = value actually received into stock (GRN-verified).
  const purchasedValue = pos.reduce(
    (a, po) => a + po.items.reduce((s, it) => s + it.received * it.unitCost, 0),
    0
  );
  const orderedValue = pos.reduce((a, po) => a + po.total, 0);
  // Open orders = sent (or partially received) POs' undelivered remainder.
  const openOrdersValue = pos
    .filter((po) => po.status === "Sent" || po.status === "Partially Received")
    .reduce((a, po) => a + po.items.reduce((s, it) => s + Math.max(0, it.qty - it.received) * it.unitCost, 0), 0);
  const cancelledValue = pos
    .filter((po) => po.status === "Cancelled")
    .reduce((a, po) => a + po.total, 0);

  const returnedValue = rtvs.reduce((a, r) => a + r.total, 0);
  const creditedValue = rtvs.filter((r) => r.status === "Credited").reduce((a, r) => a + r.total, 0);
  const pendingCreditValue = returnedValue - creditedValue;

  // Net traded = goods bought (received) − goods sent back, whether the credit
  // has landed or not - the debit note already reduced our stock value.
  const netTraded = purchasedValue - returnedValue;

  const priceListSavings = prices.reduce((a, p) => a + Math.max(0, p.product.cost - p.cost), 0);

  return NextResponse.json({
    ok: true,
    supplier: {
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone,
      email: supplier.email,
      kraPin: supplier.kraPin,
      category: supplier.category,
      leadDays: supplier.leadDays,
    },
    pos: pos.map((po) => {
      const received = po.items.reduce((s, it) => s + it.received * it.unitCost, 0);
      return {
        id: po.id,
        poNo: po.poNo,
        status: po.status,
        total: po.total,
        receivedValue: Math.round(received * 100) / 100,
        outstandingValue: Math.round((po.total - received) * 100) / 100,
        orderedAt: po.orderedAt.toISOString(),
        receivedAt: po.receivedAt?.toISOString() ?? null,
        storeName: po.store.name,
        lines: po.items.length,
        items: po.items.map((it) => ({
          name: it.product.name,
          emoji: it.product.emoji,
          qty: it.qty,
          received: it.received,
          unitCost: it.unitCost,
        })),
      };
    }),
    rtvs: rtvs.map((r) => ({
      id: r.id,
      rtnNo: r.rtnNo,
      debitNoteNo: r.debitNoteNo,
      reason: r.reason,
      total: r.total,
      status: r.status,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      storeName: r.store.name,
      items: r.items.map((it) => ({
        name: it.product.name,
        emoji: it.product.emoji,
        qty: it.qty,
        unitCost: it.unitCost,
      })),
    })),
    prices: prices.map((p) => ({
      productId: p.productId,
      name: p.product.name,
      emoji: p.product.emoji,
      sku: p.product.sku,
      unit: p.product.unit,
      catalogCost: p.product.cost,
      negotiatedCost: p.cost,
      savingPerUnit: Math.round((p.product.cost - p.cost) * 100) / 100,
      updatedAt: p.updatedAt.toISOString(),
    })),
    summary: {
      poCount: pos.length,
      openPos: pos.filter((po) => po.status === "Sent" || po.status === "Partially Received").length,
      orderedValue: Math.round(orderedValue * 100) / 100,
      purchasedValue: Math.round(purchasedValue * 100) / 100,
      openOrdersValue: Math.round(openOrdersValue * 100) / 100,
      cancelledValue: Math.round(cancelledValue * 100) / 100,
      rtvCount: rtvs.length,
      returnedValue: Math.round(returnedValue * 100) / 100,
      creditedValue: Math.round(creditedValue * 100) / 100,
      pendingCreditValue: Math.round(pendingCreditValue * 100) / 100,
      netTraded: Math.round(netTraded * 100) / 100,
      priceListCount: prices.length,
      priceListSavings: Math.round(priceListSavings * 100) / 100,
      generatedAt: new Date().toISOString(),
    },
  });
}
