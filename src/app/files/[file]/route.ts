import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

/**
 * GET /files/qr_{receiptCode}.png - QR image endpoint.
 * QR PNGs are generated on the fly from the code in the filename, so the URL
 * contract (/files/qr_NVS-DUKA-2026-00001.png) is stable and serverless-safe
 * (no filesystem writes needed - Vercel's disk is read-only).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const match = /^qr_(.+)\.png$/.exec(file);
  if (!match) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let text = decodeURIComponent(match[1]);
  // Bare receipt codes link to the live digital receipt page.
  if (/^NVS-DUKA-/.test(text)) {
    const base = process.env.NEXT_PUBLIC_PUBLIC_BASE_URL || "https://retail-erp-pos-kenya.vercel.app";
    text = `${base}/receipt/${text}`;
  }
  const png = await QRCode.toBuffer(text, {
    type: "png",
    width: 480,
    margin: 2,
    errorCorrectionLevel: "M",
  });
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
