import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emitLive } from "@/lib/live-emit";

export const dynamic = "force-dynamic";

/* DukaFlow - Purchase order lifecycle.
 *
 * PATCH /api/purchase-orders/[id]
 *   { action: "send" }                          → Draft → Sent
 *   { action: "cancel" }                        → → Cancelled
 *   { action: "receive", lines: [{itemId, qty}] } → GRN: increments store stock,
 *     stamps fresh receivedAt (stock aging), sets per-line received qty and
 *     flips the PO to Received when fully (or Partially when partially) received.
 *
 * Receiving also posts an audit line to the #stock-alerts Raven channel and
 * emits `po:received` on the live event bus.
 */

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const poId = Number(id);
    const body = (await req.json()) as {
      action: "send" | "cancel" | "receive";
      lines?: { itemId: number; qty: number }[];
    };

    const po = await db.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true, supplier: true, store: true },
    });
    if (!po) {
      return NextResponse.json({ ok: false, error: "Purchase order not found" }, { status: 404 });
    }

    // -- send / cancel ---------------------------------------------------------
    if (body.action === "send") {
      if (po.status !== "Draft") {
        return NextResponse.json({ ok: false, error: `Only Draft orders can be sent (current: ${po.status})` }, { status: 400 });
      }
      const updated = await db.purchaseOrder.update({ where: { id: poId }, data: { status: "Sent" } });
      return NextResponse.json({ ok: true, po: updated });
    }

    if (body.action === "cancel") {
      if (po.status === "Received") {
        return NextResponse.json({ ok: false, error: "Received orders cannot be cancelled" }, { status: 400 });
      }
      const updated = await db.purchaseOrder.update({ where: { id: poId }, data: { status: "Cancelled" } });
      return NextResponse.json({ ok: true, po: updated });
    }

    // -- receive (Goods Received Note) -----------------------------------------
    if (body.action === "receive") {
      if (po.status === "Received" || po.status === "Cancelled") {
        return NextResponse.json({ ok: false, error: `Order already ${po.status.toLowerCase()}` }, { status: 400 });
      }

      const incoming = (body.lines ?? []).filter((l) => l.qty > 0);
      if (!incoming.length) {
        return NextResponse.json({ ok: false, error: "Enter received quantities for at least one line" }, { status: 400 });
      }
      const itemMap = new Map(po.items.map((i) => [i.id, i]));

      // Validate: cannot receive more than ordered (per line, cumulative).
      for (const line of incoming) {
        const item = itemMap.get(line.itemId);
        if (!item) {
          return NextResponse.json({ ok: false, error: "Unknown PO line" }, { status: 400 });
        }
        if (item.received + line.qty > item.qty + 1e-9) {
          return NextResponse.json(
            { ok: false, error: `Cannot receive more than ordered for ${item.productId} (ordered ${item.qty}, already received ${item.received})` },
            { status: 400 }
          );
        }
      }

      // Apply stock + line updates. Fresh stock resets receivedAt → stock aging.
      const now = new Date();
      let receivedAny = false;
      for (const line of incoming) {
        const item = itemMap.get(line.itemId)!;
        receivedAny = true;
        await db.purchaseOrderItem.update({
          where: { id: item.id },
          data: { received: { increment: line.qty } },
        });
        const level = await db.stockLevel.findUnique({
          where: { productId_storeId: { productId: item.productId, storeId: po.storeId } },
        });
        if (level) {
          await db.stockLevel.update({
            where: { id: level.id },
            data: { qty: { increment: line.qty }, receivedAt: now },
          });
        } else {
          await db.stockLevel.create({
            data: { productId: item.productId, storeId: po.storeId, qty: line.qty, receivedAt: now },
          });
        }
      }

      const fresh = await db.purchaseOrder.findUnique({
        where: { id: poId },
        include: { items: true },
      });
      const allIn = fresh!.items.every((i) => i.received >= i.qty - 1e-9);
      const updated = await db.purchaseOrder.update({
        where: { id: poId },
        data: {
          status: allIn ? "Received" : "Partially Received",
          receivedAt: allIn ? now : null,
        },
      });

      // Audit trail in Raven #stock-alerts + realtime ping.
      const linesText = incoming
        .map((l) => {
          const item = itemMap.get(l.itemId)!;
          return `+${l.qty} × ${item.productId}`;
        })
        .join(", ");
      try {
        const channel = await db.chatChannel.findFirst({ where: { name: "stock-alerts" } });
        if (channel) {
          await db.chatMessage.create({
            data: {
              channelId: channel.id,
              author: "Procurement Bot",
              initials: "PB",
              content: `📥 GRN ${po.poNo} received at ${po.store.name} from ${po.supplier.name} • ${linesText} • order now ${updated.status}`,
            },
          });
        }
      } catch {
        /* best-effort */
      }
      emitLive("po:received", { poNo: po.poNo, supplier: po.supplier.name, store: po.store.name, status: updated.status });

      return NextResponse.json({ ok: true, po: updated });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "PO update failed" },
      { status: 500 }
    );
  }
}
