import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/settings — singleton settings. */
export async function GET() {
  const settings = await db.settings.findUnique({ where: { id: 1 } });
  return NextResponse.json(settings);
}

/** PUT /api/settings — update any subset. */
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const allowed = [
    "kraPin", "kraBranchId", "kraDeviceSerial", "kraCallbackUrl", "kraConnected",
    "mpesaConsumerKey", "mpesaConsumerSecret", "mpesaTillNumbers", "mpesaCallbackUrl",
    "mpesaEnvironment",
    "smsApiKey", "smsSenderName",
    "loyaltyEarnPerKes", "loyaltyPointValue", "loyaltyExpiryMonths",
    "vatRate",
    "happyHourEnabled", "happyHourStart", "happyHourEnd", "happyHourPercent", "happyHourCategory", "receiptPromoFooter", "receiptPrimaryColor", "receiptSecondaryColor",
    "companyName", "tierRules",
  ] as const;

  const data: Record<string, string | number | boolean | Date> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (keyNeedsSync(data)) data.kraLastSync = new Date();

  const settings = await db.settings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });
  return NextResponse.json({ ok: true, settings });
}

function keyNeedsSync(data: Record<string, unknown>): boolean {
  return "kraPin" in data || "kraBranchId" in data || "kraDeviceSerial" in data;
}
