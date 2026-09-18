import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/products?storeId=&q=&category= - catalog with per-store stock. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const category = searchParams.get("category");
  const storeId = searchParams.get("storeId");

  const products = await db.product.findMany({
    where: {
      archivedAt: null,
      active: true,
      ...(q
        ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }, { barcode: { contains: q } }] }
        : {}),
      ...(category && category !== "All" ? { category } : {}),
    },
    include: {
      stocks: storeId ? { where: { storeId: Number(storeId) } } : true,
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(
    products.map((p) => ({
      id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, category: p.category,
      price: p.price, cost: p.cost, unit: p.unit, emoji: p.emoji,
      stock: p.stocks.map((s) => ({ storeId: s.storeId, qty: s.qty, reorderPoint: s.reorderPoint })),
    }))
  );
}
