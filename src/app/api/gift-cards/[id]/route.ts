import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** PATCH /api/gift-cards/[id] — topup or redeem (partial supported). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const card = await db.giftCard.findUnique({ where: { id: Number(id) } });
  if (!card) return NextResponse.json({ ok: false, error: "Card not found" }, { status: 404 });

  const amount = Number(body.amount);
  if (!amount || amount <= 0) {
    return NextResponse.json({ ok: false, error: "Amount must be positive" }, { status: 400 });
  }

  let balance = card.balance;
  if (body.action === "topup") {
    balance += amount;
  } else if (body.action === "redeem") {
    if (amount > card.balance) {
      return NextResponse.json({ ok: false, error: `Insufficient balance (KES ${card.balance.toLocaleString()})` }, { status: 400 });
    }
    balance -= amount;
  } else {
    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  }

  const updated = await db.giftCard.update({
    where: { id: card.id },
    data: { balance, status: balance <= 0 ? "Empty" : "Active" },
  });
  return NextResponse.json({ ok: true, card: updated });
}
