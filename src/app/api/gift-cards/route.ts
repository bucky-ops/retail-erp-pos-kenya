import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateQr } from "@/lib/etims";

export const dynamic = "force-dynamic";

/** GET /api/gift-cards — all gift cards with QR data URLs. */
export async function GET() {
  const cards = await db.giftCard.findMany({
    include: { customer: true },
    orderBy: { createdAt: "desc" },
  });

  const withQr = await Promise.all(
    cards.map(async (c) => ({
      id: c.id, code: c.code, balance: c.balance, initialBalance: c.initialBalance,
      customerId: c.customerId, customerName: c.customer?.name ?? null,
      expiry: c.expiry?.toISOString() ?? null, status: c.status, gradient: c.gradient,
      qr: await generateQr(`DUKAFLOW-GIFT:${c.code}:${c.balance}`, 200),
    }))
  );
  return NextResponse.json(withQr);
}

/** POST /api/gift-cards — issue a new gift card. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const initialBalance = Number(body.initialBalance);
  if (!initialBalance || initialBalance <= 0) {
    return NextResponse.json({ ok: false, error: "Initial balance required" }, { status: 400 });
  }

  const count = await db.giftCard.count();
  const code = body.code ?? `GC-${1230 + count + 1}`;
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + Number(body.months ?? 12));

  const card = await db.giftCard.create({
    data: {
      code, balance: initialBalance, initialBalance,
      customerId: body.customerId ?? null,
      expiry, gradient: body.gradient ?? "blue-green",
    },
  });

  if (body.customerId) {
    await db.customer.update({
      where: { id: body.customerId },
      data: { giftCardBalance: { increment: initialBalance } },
    });
  }

  return NextResponse.json({
    ok: true, card,
    qr: await generateQr(`DUKAFLOW-GIFT:${card.code}:${card.balance}`, 200),
  });
}
