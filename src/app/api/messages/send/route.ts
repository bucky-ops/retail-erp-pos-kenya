import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Africa's Talking-style sender (simulated). Renders merge tags per customer. */
function renderTemplate(body: string, c: { name: string; loyaltyPoints: number; debtBalance: number; tier: string }) {
  return body
    .replaceAll("{customer_name}", c.name.split(" ")[0])
    .replaceAll("{full_name}", c.name)
    .replaceAll("{points_balance}", String(c.loyaltyPoints))
    .replaceAll("{debt_balance}", String(Math.round(c.debtBalance)))
    .replaceAll("{tier}", c.tier)
    .replaceAll("{shop_name}", "DukaFlow");
}

/**
 * POST /api/messages/send — blast SMS/WhatsApp to an audience.
 * body: { audience: all|gold|hasDebt|birthdayToday|boughtLast7|customer, customerId?, channel: SMS|WhatsApp, body }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const audience = body.audience ?? "all";
  const channel = body.channel === "WhatsApp" ? "WhatsApp" : "SMS";
  const template = body.body ?? "";

  if (!template.trim()) {
    return NextResponse.json({ ok: false, error: "Message body required" }, { status: 400 });
  }

  let targets: { id: number; name: string; phone: string; loyaltyPoints: number; debtBalance: number; tier: string; birthday: Date | null }[] = [];

  if (audience === "customer" && body.customerId) {
    const c = await db.customer.findUnique({ where: { id: Number(body.customerId) } });
    if (c) targets = [c];
  } else {
    const where =
      audience === "gold" ? { tier: "Gold" }
      : audience === "hasDebt" ? { debtBalance: { gt: 0 } }
      : audience === "birthdayToday"
        ? {
            birthday: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
              lt: new Date(new Date().setHours(23, 59, 59, 999)),
            },
          }
        : audience === "boughtLast7"
          ? { sales: { some: { createdAt: { gte: new Date(Date.now() - 7 * 864e5) } } } }
          : {};
    targets = await db.customer.findMany({ where, take: 200 });
  }

  if (targets.length === 0) {
    return NextResponse.json({ ok: false, error: "No customers match this audience" }, { status: 400 });
  }

  // per-customer render + log (segments: 160 chars = 1 SMS unit @ KES 1)
  let cost = 0;
  const logsData = targets.map((c) => {
    const message = renderTemplate(template, c);
    const segments = Math.max(1, Math.ceil(message.length / 160));
    cost += segments;
    return {
      customerId: c.id, phone: c.phone, message,
      channel, type: body.label ?? "Promo", status: "Delivered", cost: segments,
    };
  });

  await db.smsLog.createMany({ data: logsData });

  return NextResponse.json({
    ok: true,
    sent: targets.length,
    cost,
    channel,
    sample: logsData[0]?.message,
  });
}
