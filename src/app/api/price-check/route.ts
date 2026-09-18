import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseScaleBarcode } from "@/lib/receipt";

export const dynamic = "force-dynamic";

/**
 * PUBLIC price check (kiosk + POS price mode + gift card QR balance check).
 * ?code=<barcode | sku | gift card code>[&kg=1.25]
 * Weight scale barcodes (2 AAAAA WWWWW C) resolve the embedded item and the
 * weight so the kiosk shows "1.25 kg x KES 129 = KES 161.25" like Naivas.
 */
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const code = (sp.get("code") ?? "").trim();
  const kgParam = Number(sp.get("kg") ?? 0);
  if (!code) return NextResponse.json({ found: false, error: "Scan or type a code" }, { status: 400 });

  // 1. Gift card balance check (codes look like GF-XXXX)
  const gift = await db.giftCard.findFirst({ where: { code: code.toUpperCase() } });
  if (gift) {
    return NextResponse.json({
      found: true,
      type: "giftcard",
      name: `Gift Card ${gift.code}`,
      balance: gift.balance,
      initialBalance: gift.initialBalance,
      status: gift.status,
      expiry: gift.expiry,
    });
  }

  // 2. Exact barcode / SKU (SQLite matches ASCII case-insensitively)
  let product = await db.product.findFirst({
    where: { OR: [{ barcode: code }, { sku: code.toUpperCase() }, { sku: code.toLowerCase() }] },
  });

  // 3. Scale barcode (EAN-13 prefixed 2): 2 AAAAA WWWWW C
  let scaleKg = 0;
  if (!product) {
    const scale = parseScaleBarcode(code);
    if (scale) {
      product = await db.product.findFirst({ where: { scaleCode: scale.scaleCode } });
      if (product) scaleKg = scale.kg;
    }
  }

  if (!product) {
    // 4. Loose name match so the kiosk stays useful without a gun
    product = await db.product.findFirst({
      where: { name: { contains: code } },
    });
  }

  if (!product) return NextResponse.json({ found: false, error: `No match for "${code}"` });

  const kg = kgParam > 0 ? kgParam : scaleKg;
  const qty = product.isScale ? kg || 1 : 1;
  return NextResponse.json({
    found: true,
    type: "product",
    name: product.name,
    emoji: product.emoji,
    price: product.price,
    unit: product.unit,
    category: product.category,
    isScale: product.isScale,
    kg: product.isScale ? kg : undefined,
    qty,
    computed: Math.round(product.price * qty * 100) / 100,
  });
}
