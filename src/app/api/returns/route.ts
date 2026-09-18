import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emitLive } from "@/lib/live-emit";

export const dynamic = "force-dynamic";

/* DukaFlow - Sales returns & refunds.
 *
 * GET  /api/returns?saleId=&limit=   → return history (newest first)
 * POST /api/returns                  → process a return against an original receipt
 *
 * Business rules enforced here (mirrors real Kenyan retail backoffice):
 *  1. A line can never be refunded more than its original qty (already-returned
 *     quantities are aggregated per SaleItem and subtracted).
 *  2. Refund value = the price the customer actually paid (unit price × qty;
 *     discounts were already baked into the line at sale time).
 *  3. refundMethod:
 *       • Cash refund   → reduces the open till session's expected cash (drawer payout)
 *       • M-Pesa B2C    → audit SMS row (mock Daraja B2C payout)
 *       • Credit note   → numbered CN-xxxx; if the original sale was a Credit Sale
 *                         with a customer, it reduces their debt balance
 *       • Gift card     → issues a store-credit gift card with the refund balance
 *  4. Restock puts goods back into the store's StockLevel and stamps receivedAt
 *     so the Stock Aging report stays truthful.
 */

/** GET - return history with receipt context. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const saleId = searchParams.get("saleId");
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

  const returns = await db.salesReturn.findMany({
    where: saleId ? { saleId: Number(saleId) } : {},
    include: {
      items: true,
      sale: { select: { receiptNo: true, paymentMethod: true, total: true } },
      store: { select: { name: true } },
      customer: { select: { name: true, phone: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(
    returns.map((r) => ({
      ...r,
      storeName: r.store.name,
      receiptNo: r.sale.receiptNo,
      customerName: r.customer?.name ?? "Walk-in",
    }))
  );
}

/** Already-returned qty per SaleItem id, across every prior return of this sale. */
async function returnedQtyBySaleItem(saleId: number) {
  const prior = await db.salesReturn.findMany({
    where: { saleId },
    select: { items: { select: { saleItemId: true, qty: true } } },
  });
  const map = new Map<number, number>();
  for (const r of prior) {
    for (const it of r.items) {
      if (it.saleItemId != null) {
        map.set(it.saleItemId, (map.get(it.saleItemId) ?? 0) + it.qty);
      }
    }
  }
  return map;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      saleId: number;
      items: { saleItemId: number; qty: number }[];
      reason?: string;
      refundMethod?: string;
      restock?: boolean;
      staffName?: string;
    };

    const { saleId } = body;
    const lines = (body.items ?? []).filter((i) => i.qty > 0);
    if (!saleId || !lines.length) {
      return NextResponse.json({ ok: false, error: "Select at least one item with a quantity" }, { status: 400 });
    }

    const sale = await db.sale.findUnique({
      where: { id: saleId },
      include: { items: true, store: true, customer: true },
    });
    if (!sale) {
      return NextResponse.json({ ok: false, error: "Receipt not found" }, { status: 404 });
    }

    const saleItemMap = new Map(sale.items.map((i) => [i.id, i]));
    const alreadyReturned = await returnedQtyBySaleItem(saleId);

    /* Proportional "what the customer actually paid" ratio for this receipt.
     * total/subtotal captures VAT (×1.16) minus bill-level discounts, promo and
     * loyalty-point redemption in one number, so each refunded line reflects the
     * real money out of the drawer - not the pre-VAT shelf price. */
    const paidRatio = sale.subtotal > 0 ? sale.total / sale.subtotal : 1;

    // ── Validate quantities against originals minus prior returns ────────────
    const validated: {
      saleItemId: number; productId: number | null; name: string;
      emoji: string; qty: number; unitPrice: number; total: number;
    }[] = [];
    for (const line of lines) {
      const original = saleItemMap.get(line.saleItemId);
      if (!original) {
        return NextResponse.json({ ok: false, error: "Unknown receipt line" }, { status: 400 });
      }
      const returnedBefore = alreadyReturned.get(original.id) ?? 0;
      const refundable = original.qty - returnedBefore;
      if (line.qty > refundable + 1e-9) {
        return NextResponse.json(
          { ok: false, error: `Only ${refundable} × ${original.name} refundable on this receipt` },
          { status: 400 }
        );
      }
      validated.push({
        saleItemId: original.id,
        productId: original.productId,
        name: original.name,
        emoji: original.emoji,
        qty: line.qty,
        unitPrice: original.unitPrice, // shelf price paid
        total: Math.round(original.unitPrice * line.qty * paidRatio * 100) / 100, // actual money paid for this line
      });
    }

    const refundTotal = Math.round(validated.reduce((s, l) => s + l.total, 0) * 100) / 100;
    const refundMethod = body.refundMethod ?? "Cash refund";
    const reason = body.reason ?? "Customer changed mind";
    const restock = body.restock ?? true;

    // ── Sequential document numbers (RET / CN) ───────────────────────────────
    const [retCount, cnCount] = await Promise.all([
      db.salesReturn.count(),
      db.salesReturn.count({ where: { creditNoteNo: { not: null } } }),
    ]);
    const returnNo = `RET-${1000 + retCount + 1}`;
    const creditNoteNo = refundMethod === "Credit note" ? `CN-${1000 + cnCount + 1}` : null;

    // ── Method side-effects ──────────────────────────────────────────────────
    let giftCardCode: string | null = null;
    let tillUpdated = false;

    if (refundMethod === "Gift card") {
      // Store credit: issue a gift card carrying the refund balance.
      const gcCount = await db.giftCard.count();
      giftCardCode = `GC-${1000 + gcCount + 1}`;
      await db.giftCard.create({
        data: {
          code: giftCardCode,
          balance: refundTotal,
          initialBalance: refundTotal,
          customerId: sale.customerId,
          expiry: new Date(Date.now() + 365 * 24 * 3600 * 1000),
          status: "Active",
          gradient: "green",
        },
      });
    }

    if (refundMethod === "Cash refund") {
      // Drawer payout: reduce the open till session's expected cash so the next
      // Z report reconciles against reality.
      const openTill = await db.tillSession.findFirst({
        where: { storeId: sale.storeId, status: "Open" },
        orderBy: { openedAt: "desc" },
      });
      if (openTill) {
        await db.tillSession.update({
          where: { id: openTill.id },
          data: { expectedCash: Math.max(0, (openTill.expectedCash ?? 0) - refundTotal) },
        });
        tillUpdated = true;
      }
    }

    if (refundMethod === "M-Pesa B2C" && sale.customer) {
      // Mock B2C payout audit trail (real impl would call Daraja b2c).
      await db.smsLog.create({
        data: {
          customerId: sale.customer.id,
          phone: sale.customer.phone,
          message: `DukaFlow: B2C refund of KES ${refundTotal.toFixed(0)} for receipt ${sale.receiptNo} (${returnNo}) is being processed to your M-Pesa.`,
          channel: "SMS",
          type: "Refund",
          status: "Sent",
          cost: 1,
        },
      });
    }

    if (refundMethod === "Credit note" && sale.customerId && sale.paymentMethod === "Credit Sale") {
      // A credit note against a credit invoice reduces what the customer owes.
      await db.customer.update({
        where: { id: sale.customerId },
        data: { debtBalance: { decrement: refundTotal } },
      });
      // …and the linked DebtPlan balance, so the Debts screen, statements and
      // the POS overdue-blocker all stay in sync with reality.
      const plan = await db.debtPlan.findFirst({
        where: { customerId: sale.customerId, status: "Active", invoiceNo: sale.receiptNo },
      });
      if (plan) {
        await db.debtPlan.update({
          where: { id: plan.id },
          data: { totalDebt: Math.max(0, plan.totalDebt - refundTotal) },
        });
      }
    }

    // ── Persist return + lines ───────────────────────────────────────────────
    const ret = await db.salesReturn.create({
      data: {
        returnNo,
        saleId,
        storeId: sale.storeId,
        customerId: sale.customerId,
        staffName: body.staffName ?? "Owner",
        reason,
        refundMethod,
        restocked: restock,
        total: refundTotal,
        creditNoteNo,
        giftCardCode,
        items: {
          create: validated.map((v) => ({
            saleItemId: v.saleItemId,
            productId: v.productId,
            name: v.name,
            emoji: v.emoji,
            qty: v.qty,
            unitPrice: v.unitPrice,
            total: v.total,
          })),
        },
      },
      include: { items: true },
    });

    // ── Restock: put goods back on the shelf (fresh receivedAt for aging) ────
    if (restock) {
      for (const v of validated) {
        if (v.productId == null) continue;
        const level = await db.stockLevel.findUnique({
          where: { productId_storeId: { productId: v.productId, storeId: sale.storeId } },
        });
        if (level) {
          await db.stockLevel.update({
            where: { id: level.id },
            data: { qty: { increment: v.qty }, receivedAt: new Date() },
          });
        } else {
          await db.stockLevel.create({
            data: { productId: v.productId, storeId: sale.storeId, qty: v.qty },
          });
        }
      }
    }

    // ── Chat audit trail + realtime ──────────────────────────────────────────
    const lineText = validated.map((v) => `${v.qty} × ${v.name}`).join(", ");
    try {
      const channel = await db.chatChannel.findFirst({ where: { name: "stock-alerts" } });
      if (channel) {
        await db.chatMessage.create({
          data: {
            channelId: channel.id,
            author: "Returns Bot",
            initials: "RB",
            content: `↩️ ${returnNo}: ${lineText} returned on ${sale.receiptNo} • KES ${refundTotal.toLocaleString()} via ${refundMethod}${restock ? " • restocked" : " • NOT restocked"}${creditNoteNo ? ` • ${creditNoteNo}` : ""}${giftCardCode ? ` • ${giftCardCode}` : ""}`,
          },
        });
      }
    } catch {
      /* chat audit is best-effort */
    }
    emitLive("sale:return", {
      returnNo, receiptNo: sale.receiptNo, total: refundTotal,
      method: refundMethod, store: sale.store.name,
    });

    return NextResponse.json({
      ok: true,
      return: ret,
      receiptNo: sale.receiptNo,
      giftCardCode,
      creditNoteNo,
      tillUpdated,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Return failed" },
      { status: 500 }
    );
  }
}
