import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emitLive } from "@/lib/live-emit";

export const dynamic = "force-dynamic";

/**
 * DukaFlow — Return to Vendor (RTV) with numbered debit notes.
 *
 * GET  /api/supplier-returns → recent RTVs (supplier, store, lines, totals)
 * POST /api/supplier-returns → create one
 *      body: { supplierId, storeId, reason, note?, lines: [{productId, qty}] }
 *
 * Lines are valued at product COST (that is what the supplier owes us back,
 * not the shelf price). Stock leaves the store immediately, each outbound
 * batch is audited to #stock-alerts, and `supplier:return` fires on the live
 * bus. Debit note numbers (DN-xxxx) are what the accountant nets off the
 * supplier statement.
 */
export async function GET() {
  const returns = await db.supplierReturn.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      supplier: { select: { id: true, name: true } },
      store: { select: { id: true, name: true } },
      items: { include: { product: { select: { id: true, name: true, emoji: true, sku: true } } } },
    },
  });
  return NextResponse.json(returns);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supplierId = Number(body.supplierId);
    const storeId = Number(body.storeId);
    const reason = String(body.reason ?? "Damaged");
    const note = String(body.note ?? "");
    const rawLines = Array.isArray(body.lines) ? body.lines : [];

    if (!supplierId || !storeId) {
      return NextResponse.json({ ok: false, error: "supplierId and storeId are required" }, { status: 400 });
    }
    if (rawLines.length === 0) {
      return NextResponse.json({ ok: false, error: "At least one product line is required" }, { status: 400 });
    }

    const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
    const store = await db.store.findUnique({ where: { id: storeId } });
    if (!supplier || !store) {
      return NextResponse.json({ ok: false, error: "Supplier or store not found" }, { status: 404 });
    }

    // Validate every line against real stock before touching anything.
    const validated: { productId: number; qty: number; unitCost: number; total: number; name: string }[] = [];
    for (const line of rawLines) {
      const productId = Number(line.productId);
      const qty = Number(line.qty);
      if (!productId || !Number.isFinite(qty) || qty <= 0) {
        return NextResponse.json({ ok: false, error: "Each line needs a productId and a positive qty" }, { status: 400 });
      }
      const level = await db.stockLevel.findUnique({
        where: { productId_storeId: { productId, storeId } },
        include: { product: true },
      });
      if (!level) {
        return NextResponse.json({ ok: false, error: `No stock record for product ${productId} at this store` }, { status: 404 });
      }
      if (qty > level.qty) {
        return NextResponse.json(
          { ok: false, error: `Cannot return ${qty} × ${level.product.name} — only ${level.qty} in stock at ${store.name}` },
          { status: 400 }
        );
      }
      validated.push({ productId, qty, unitCost: level.product.cost, total: qty * level.product.cost, name: level.product.name });
    }

    const total = validated.reduce((s, l) => s + l.total, 0);
    const seq = (await db.supplierReturn.count()) + 1;
    const rtnNo = `RTV-${String(seq).padStart(4, "0")}`;
    const debitNoteNo = `DN-${String(seq).padStart(4, "0")}`;

    const rtn = await db.supplierReturn.create({
      data: {
        rtnNo,
        debitNoteNo,
        supplierId,
        storeId,
        reason,
        note,
        total,
        items: {
          create: validated.map((l) => ({ productId: l.productId, qty: l.qty, unitCost: l.unitCost, total: l.total })),
        },
      },
    });

    // Decrement live stock (outbound). No receivedAt reset — the batch shrinks, not refreshes.
    for (const line of validated) {
      await db.stockLevel.update({
        where: { productId_storeId: { productId: line.productId, storeId } },
        data: { qty: { decrement: line.qty } },
      });
    }

    // Audit line to #stock-alerts + live bus
    const channel = await db.chatChannel.findFirst({ where: { name: "stock-alerts" } });
    if (channel) {
      const lines = validated.map((l) => `  • ${l.qty} × ${l.name} (KES ${Math.round(l.total).toLocaleString()})`).join("\n");
      const msg = `📤 ${rtnNo} — goods returned to ${supplier.name} (${reason}). ${debitNoteNo} raised for KES ${Math.round(total).toLocaleString()}.\n${lines}\nFrom ${store.name}. Stock decremented.`;
      await db.chatMessage.create({ data: { channelId: channel.id, author: "Procurement Bot", initials: "PB", content: msg } });
      await db.chatChannel.update({ where: { id: channel.id }, data: { unread: { increment: 1 } } });
      emitLive("chat:new", { channelId: channel.id, channelName: channel.name, id: 0, author: "Procurement Bot", initials: "PB", content: msg, createdAt: new Date().toISOString() });
    }

    emitLive("supplier:return", { rtnNo, debitNoteNo, supplier: supplier.name, total });

    return NextResponse.json({ ok: true, id: rtn.id, rtnNo, debitNoteNo, total, lines: validated.length });
  } catch (err) {
    console.error("supplier-returns POST failed", err);
    return NextResponse.json({ ok: false, error: "Return to vendor failed" }, { status: 500 });
  }
}

/**
 * PATCH /api/supplier-returns — mark a debit note as credited by the supplier
 * (owner reconciles when the credit actually lands on the supplier statement).
 * body: { id, status: "Credited" }
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const id = Number(body.id);
  if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  const updated = await db.supplierReturn.update({
    where: { id },
    data: { status: "Credited" },
  });
  return NextResponse.json({ ok: true, rtnNo: updated.rtnNo, status: updated.status });
}
