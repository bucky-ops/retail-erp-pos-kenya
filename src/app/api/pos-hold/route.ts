import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/supermarket-server";

export const dynamic = "force-dynamic";

/**
 * Naivas HOLD + resume. A cashier parks the cart (1 click), serves the next
 * customer, then resumes. Holds live on the server so they survive refresh,
 * module switches, logout and device swaps; the POS also mirrors them into
 * localStorage for offline resilience.
 */

interface HoldItem {
  productId: number;
  name: string;
  emoji: string;
  qty: number;
  unitPrice: number;
  discount: number;
  total: number;
  unit: string;
}

/** GET /api/pos-hold?storeId=1 - parked carts (newest first). */
export async function GET(req: NextRequest) {
  const storeId = Number(new URL(req.url).searchParams.get("storeId") ?? 0);
  const holds = await db.posHold.findMany({
    where: { storeId: storeId || undefined, status: "Held" },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({
    holds: holds.map((h) => ({
      ...h,
      items: JSON.parse(h.itemsJson || "[]"),
      ageMins: Math.round((Date.now() - h.createdAt.getTime()) / 60000),
    })),
  });
}

/** POST /api/pos-hold - park the current cart. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      storeId: number;
      staffName: string;
      customerId?: number | null;
      customerName?: string;
      label?: string;
      items: HoldItem[];
    };
    if (!body.items?.length) {
      return NextResponse.json({ ok: false, error: "Cart is empty" }, { status: 400 });
    }
    const count = await db.posHold.count();
    const holdCode = `HOLD-${String(count + 1).padStart(4, "0")}`;
    const subtotal = body.items.reduce((s, i) => s + (i.total ?? i.unitPrice * i.qty), 0);
    const hold = await db.posHold.create({
      data: {
        holdCode,
        staffName: body.staffName || "Cashier",
        storeId: body.storeId,
        customerId: body.customerId ?? null,
        customerName: body.customerName ?? "",
        label: body.label ?? "",
        itemsJson: JSON.stringify(body.items),
        itemCount: body.items.reduce((s, i) => s + i.qty, 0),
        subtotal,
        total: subtotal,
      },
    });
    await logAudit({
      actor: hold.staffName,
      action: "CREATE",
      entity: "PosHold",
      entityId: hold.id,
      label: holdCode,
      details: JSON.stringify({ items: body.items.length, total: subtotal }),
      storeId: body.storeId,
    });
    return NextResponse.json({ ok: true, hold: { ...hold, items: body.items } });
  } catch (err) {
    console.error("pos-hold POST", err);
    return NextResponse.json({ ok: false, error: "Hold failed" }, { status: 500 });
  }
}

/** DELETE /api/pos-hold?id= - resume (returns the cart then frees the slot). */
export async function DELETE(req: NextRequest) {
  const id = Number(new URL(req.url).searchParams.get("id") ?? 0);
  const hold = await db.posHold.findUnique({ where: { id } });
  if (!hold) return NextResponse.json({ ok: false, error: "Hold not found" }, { status: 404 });
  await db.posHold.update({
    where: { id },
    data: { status: "Resumed", resumedAt: new Date() },
  });
  await logAudit({
    actor: hold.staffName,
    action: "RESUME",
    entity: "PosHold",
    entityId: hold.id,
    label: hold.holdCode,
  });
  return NextResponse.json({ ok: true, items: JSON.parse(hold.itemsJson || "[]"), hold });
}
