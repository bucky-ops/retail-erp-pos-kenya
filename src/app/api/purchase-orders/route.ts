import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/* DukaFlow — Procurement: suppliers + purchase orders.
 *
 * GET /api/purchase-orders                      → PO list (with supplier/store/items)
 * GET /api/purchase-orders?suggestions=1&storeId= → reorder suggestions:
 *     every StockLevel at/below its reorder point becomes a suggested line with
 *     suggested qty = (reorderPoint × 3) − qty  [cover ~3 cycles] and the
 *     product's real cost price. Products are grouped by the best-match supplier
 *     category so the UI can pre-pick a supplier per draft.
 * POST /api/purchase-orders                      → create PO { supplierId, storeId, items:[{productId, qty, unitCost?}], note? }
 */

/** GET — PO list or reorder suggestions. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("storeId");
  const status = searchParams.get("status");

  // ── Reorder suggestions mode ───────────────────────────────────────────────
  if (searchParams.get("suggestions")) {
    // SQLite/Prisma can't compare two columns directly in `where`, so fetch all
    // levels for the store (catalog is small) and filter in JS.
    const all = await db.stockLevel.findMany({
      where: storeId && storeId !== "all" ? { storeId: Number(storeId) } : {},
      include: { product: true, store: true },
    });
    const low = all.filter((l) => l.qty <= l.reorderPoint && l.product.active);
    low.sort((a, b) => a.qty / Math.max(1, a.reorderPoint) - b.qty / Math.max(1, b.reorderPoint));

    const suppliers = await db.supplier.findMany({ where: { active: true } });

    const suggestions = low.map((l) => {
      // Cover roughly 3 reorder cycles, rounded to a sane pack size (min 4).
      const suggestedQty = Math.max(4, Math.ceil((l.reorderPoint * 3 - l.qty) / 4) * 4);
      // Best supplier = one whose category matches the product category, else General.
      const supplier =
        suppliers.find((s) => s.category === l.product.category) ??
        suppliers.find((s) => s.category === "General") ??
        suppliers[0] ?? null;
      return {
        stockLevelId: l.id,
        productId: l.productId,
        name: l.product.name,
        emoji: l.product.emoji,
        sku: l.product.sku,
        category: l.product.category,
        storeId: l.storeId,
        storeName: l.store.name,
        qty: l.qty,
        reorderPoint: l.reorderPoint,
        suggestedQty,
        unitCost: l.product.cost,
        lineTotal: suggestedQty * l.product.cost,
        supplierId: supplier?.id ?? null,
        supplierName: supplier?.name ?? null,
        leadDays: supplier?.leadDays ?? 3,
      };
    });

    return NextResponse.json({ suggestions });
  }

  // ── Normal PO list mode ────────────────────────────────────────────────────
  const orders = await db.purchaseOrder.findMany({
    where: {
      ...(storeId && storeId !== "all" ? { storeId: Number(storeId) } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      supplier: true,
      store: { select: { name: true } },
      items: { include: { product: { select: { name: true, emoji: true, sku: true, unit: true } } } },
    },
    orderBy: { orderedAt: "desc" },
    take: 100,
  });

  return NextResponse.json(
    orders.map((po) => ({
      ...po,
      storeName: po.store.name,
      supplierName: po.supplier.name,
    }))
  );
}

/** POST — create a purchase order. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      supplierId: number;
      storeId: number;
      items: { productId: number; qty: number; unitCost?: number }[];
      note?: string;
    };

    if (!body.supplierId || !body.storeId || !body.items?.length) {
      return NextResponse.json({ ok: false, error: "Supplier, store and at least one line are required" }, { status: 400 });
    }

    const products = await db.product.findMany({
      where: { id: { in: body.items.map((i) => i.productId) } },
    });
    const pmap = new Map(products.map((p) => [p.id, p]));

    const lines = body.items
      .filter((i) => i.qty > 0 && pmap.has(i.productId))
      .map((i) => ({
        productId: i.productId,
        qty: i.qty,
        unitCost: i.unitCost ?? pmap.get(i.productId)!.cost,
      }));
    if (!lines.length) {
      return NextResponse.json({ ok: false, error: "No valid lines" }, { status: 400 });
    }
    const total = Math.round(lines.reduce((s, l) => s + l.qty * l.unitCost, 0) * 100) / 100;

    const poCount = await db.purchaseOrder.count();
    const po = await db.purchaseOrder.create({
      data: {
        poNo: `PO-${1000 + poCount + 1}`,
        supplierId: body.supplierId,
        storeId: body.storeId,
        status: "Draft",
        total,
        note: body.note ?? "",
        items: { create: lines },
      },
      include: { items: true, supplier: true },
    });

    return NextResponse.json({ ok: true, po });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not create PO" },
      { status: 500 }
    );
  }
}
