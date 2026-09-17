import { NextRequest, NextResponse } from "next/server";
import { generateQr } from "@/lib/etims";

export const dynamic = "force-dynamic";

/** GET /api/qr?text=&width= — on-demand QR as data URL (loyalty cards, gift cards). */
export async function GET(req: NextRequest) {
  const text = new URL(req.url).searchParams.get("text") ?? "DukaFlow";
  const width = Number(new URL(req.url).searchParams.get("width") ?? 240);
  const dataUrl = await generateQr(text, Math.min(Math.max(width, 80), 600));
  return NextResponse.json({ dataUrl });
}
