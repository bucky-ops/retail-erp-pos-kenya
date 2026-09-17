import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/labels?storeId=&category=&q=
 *
 * Supplies the Barcode Label Printer (Inventory screen) with everything a
 * 50×30mm thermal sticker needs: product identity, shelf price, the barcode
 * value (which the POS scan field and the stock-take counter both accept as
 * input) plus company branding from Settings. Prices are live (tier promos
 * etc. apply at the till) — labels show the store-facing shelf price.
 *
 * Response: { company: { name, kraPin }, products: [{ id, name, sku, barcode,
 * emoji, price, category, qty, storeName }] }
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("storeId");
  const category = searchParams.get("category");
  const q = searchParams.get("q")?.trim();

  const products = await db.product.findMany({
    where: {
      active: true,
      ...(category && category !== "All" ? { category } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }, { barcode: { contains: q } }] } : {}),
    },
    include: {
      stocks: storeId && storeId !== "all" ? { where: { storeId: Number(storeId) } } : true,
    },
    orderBy: { name: "asc" },
  });

  const settings = await db.settings.findFirst();
  const storeName =
    storeId && storeId !== "all"
      ? (await db.store.findUnique({ where: { id: Number(storeId) } }))?.name ?? null
      : null;

  return NextResponse.json({
    company: {
      name: settings?.companyName ?? "DukaFlow",
      kraPin: settings?.kraPin ?? null,
    },
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      emoji: p.emoji,
      price: p.price,
      category: p.category,
      qty: p.stocks.reduce((s, l) => s + l.qty, 0),
      storeName,
    })),
  });
}
