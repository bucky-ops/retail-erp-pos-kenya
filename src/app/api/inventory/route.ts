import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/inventory?storeId=&q=&tab= - multi-store stock view with margins. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("storeId");
  const q = searchParams.get("q") ?? "";
  const tab = searchParams.get("tab") ?? "All Items";

  const levels = await db.stockLevel.findMany({
    where: {
      ...(storeId && storeId !== "all" ? { storeId: Number(storeId) } : {}),
      ...(q ? { product: { OR: [{ name: { contains: q } }, { sku: { contains: q } }, { barcode: { contains: q } }] } } : {}),
    },
    include: { product: true, store: true },
  });

  /** Age of the current batch in days (Stock Aging report) - from StockLevel.receivedAt. */
  const ageDays = (receivedAt: Date) =>
    Math.max(0, Math.floor((Date.now() - new Date(receivedAt).getTime()) / 864e5));

  // tab filters: All Items | Low Stock | Out of Stock | Transfers
  let rows = levels;
  if (tab === "Low Stock") rows = levels.filter((l) => l.qty > 0 && l.qty <= l.reorderPoint);
  if (tab === "Out of Stock") rows = levels.filter((l) => l.qty <= 0);

  const transfers = await db.stockTransfer.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const stores = await db.store.findMany();

  return NextResponse.json({
    rows: rows.map((l) => ({
      id: l.id,
      productId: l.product.id,
      name: l.product.name,
      emoji: l.product.emoji,
      sku: l.product.sku,
      barcode: l.product.barcode,
      category: l.product.category,
      price: l.product.price,
      cost: l.product.cost,
      margin: l.product.price > 0 ? Math.round(((l.product.price - l.product.cost) / l.product.price) * 100) : 0,
      qty: l.qty,
      reorderPoint: l.reorderPoint,
      storeId: l.storeId,
      store: l.store.name,
      stockAgeDays: ageDays(l.receivedAt),
    })),
    transfers: transfers.map((t) => ({
      ...t,
      productId: t.productId,
      qty: t.qty,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
    })),
    stores: stores.map((s) => ({ id: s.id, name: s.name })),
    summary: {
      totalValue: Math.round(rows.reduce((a, r) => a + r.qty * r.product.cost, 0)),
      lowStock: levels.filter((l) => l.qty > 0 && l.qty <= l.reorderPoint).length,
      outOfStock: levels.filter((l) => l.qty <= 0).length,
      skuCount: new Set(rows.map((r) => r.productId)).size,
    },
  });
}
