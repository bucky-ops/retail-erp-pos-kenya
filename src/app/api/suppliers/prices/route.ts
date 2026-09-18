import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * DukaFlow - supplier price lists (negotiated per-product costs).
 *
 * GET  /api/suppliers/prices?supplierId=1  → every negotiated cost for one
 *      supplier (product-joined). Omit supplierId → the full matrix (used to
 *      preview savings on reorder suggestions).
 * PUT  /api/suppliers/prices
 *      body: { supplierId, prices: [{ productId, cost }] }
 *      → upsert each row in one transaction; cost ≤ 0 or missing rows delete
 *        the override so the supplier falls back to the catalog cost.
 *
 * Reorder suggestions + new PO lines read this table first (see
 * /api/purchase-orders) so buyers always quote the negotiated price.
 */
export async function GET(req: NextRequest) {
  const supplierId = new URL(req.url).searchParams.get("supplierId");

  const prices = await db.supplierPrice.findMany({
    where: supplierId ? { supplierId: Number(supplierId) } : {},
    include: {
      product: { select: { id: true, name: true, sku: true, emoji: true, category: true, cost: true, unit: true } },
      supplier: { select: { id: true, name: true, category: true } },
    },
    orderBy: { id: "asc" },
  });

  return NextResponse.json(
    prices.map((p) => ({
      id: p.id,
      supplierId: p.supplierId,
      supplierName: p.supplier.name,
      productId: p.productId,
      productName: p.product.name,
      sku: p.product.sku,
      emoji: p.product.emoji,
      category: p.product.category,
      unit: p.product.unit,
      catalogCost: p.product.cost,
      cost: p.cost,
      saving: Math.round((p.product.cost - p.cost) * 100) / 100, // + = cheaper than catalog
      updatedAt: p.updatedAt,
    }))
  );
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      supplierId: number;
      prices: { productId: number; cost: number | null }[];
    };

    const supplierId = Number(body.supplierId);
    if (!supplierId || !Array.isArray(body.prices)) {
      return NextResponse.json({ ok: false, error: "supplierId and prices[] are required" }, { status: 400 });
    }
    const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) {
      return NextResponse.json({ ok: false, error: "Supplier not found" }, { status: 404 });
    }

    const upserts = body.prices.filter((p) => Number(p.cost) > 0);
    const clears = body.prices.filter((p) => p.cost === null || Number(p.cost) <= 0);

    await db.$transaction([
      ...upserts.map((p) =>
        db.supplierPrice.upsert({
          where: { supplierId_productId: { supplierId, productId: p.productId } },
          create: { supplierId, productId: p.productId, cost: Number(p.cost) },
          update: { cost: Number(p.cost) },
        })
      ),
      ...clears.map((p) =>
        db.supplierPrice.deleteMany({ where: { supplierId, productId: p.productId } })
      ),
    ]);

    return NextResponse.json({ ok: true, saved: upserts.length, cleared: clears.length, supplierName: supplier.name });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Price list update failed" },
      { status: 500 }
    );
  }
}
