import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { submitToEtims, generateInvoiceQr } from "@/lib/etims";
import { happyHourMatchesCategory, isHappyHourActive } from "@/lib/happy-hour";
import { emitLive } from "@/lib/live-emit";
import { SalePayload } from "@/types";

export const dynamic = "force-dynamic";

/** GET /api/sales?storeId=&customerId=&limit= — receipt/invoice list. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("storeId");
  const customerId = searchParams.get("customerId");
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

  const sales = await db.sale.findMany({
    where: {
      ...(storeId ? { storeId: Number(storeId) } : {}),
      ...(customerId ? { customerId: Number(customerId) } : {}),
    },
    include: { items: true, store: true, customer: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(
    sales.map((s) => ({
      ...s,
      storeName: s.store.name,
      customerName: s.customer?.name ?? "Walk-in",
      customerTier: s.customer?.tier ?? null,
    }))
  );
}

/**
 * POST /api/sales — create a POS receipt / sale.
 * Full business logic:
 *  1. Debt blocking (credit sale blocked when plan overdue > 7 days + auto-block on)
 *  2. Tier discount (Gold 10%, Silver 5%) when no explicit discount
 *  3. Promo code validation (flat/percent, minSpend)
 *  4. Loyalty: earn 1pt/100KES (configurable), redeem points → KES
 *  5. Gift card redemption (code or customer balance)
 *  6. VAT 16%, stock decrement
 *  7. Credit sale → debt increase + auto Debt Plan
 *  8. eTIMS submission (CU number + QR PNG base64)
 *  9. Receipt SMS log
 */
export async function POST(req: NextRequest) {
  try {
    const payload: SalePayload = await req.json();
    const { storeId, items, paymentMethod } = payload;

    if (!items?.length) {
      return NextResponse.json({ ok: false, error: "Cart is empty" }, { status: 400 });
    }

    // offline dedupe
    if (payload.clientId) {
      const dupe = await db.sale.findUnique({ where: { clientId: payload.clientId } });
      if (dupe) {
        return NextResponse.json({ ok: true, sale: dupe, deduped: true });
      }
    }

    const settings = await db.settings.findUnique({ where: { id: 1 } });
    if (!settings) return NextResponse.json({ ok: false, error: "Settings missing" }, { status: 500 });

    const customer = payload.customerId
      ? await db.customer.findUnique({ where: { id: payload.customerId } })
      : null;

    // ── 1. Debt blocking ─────────────────────────────────
    if (customer && paymentMethod === "Credit Sale") {
      const plans = await db.debtPlan.findMany({ where: { customerId: customer.id } });
      const blocking = plans.find((p) => p.autoBlockPosOverdue && p.overdueDays > 7 && p.status === "Active");
      if (blocking) {
        return NextResponse.json({
          ok: false,
          blocked: {
            reason: `${customer.name} has an overdue debt plan (KES ${Math.round(blocking.totalDebt).toLocaleString()}, ${blocking.overdueDays} days overdue). Credit sale blocked.`,
            overdueDays: blocking.overdueDays,
          },
        }, { status: 403 });
      }
      if (customer.debtBalance + 1 > customer.creditLimit) {
        return NextResponse.json({
          ok: false,
          blocked: { reason: `Credit limit reached (KES ${customer.creditLimit.toLocaleString()}).`, overdueDays: 0 },
        }, { status: 403 });
      }
    }

    // ── 2. Pricing from DB ───────────────────────────────
    const dbProducts = await db.product.findMany({
      where: { id: { in: items.map((i) => i.productId) } },
    });
    const priceMap = new Map(dbProducts.map((p) => [p.id, p]));
    const subtotal = items.reduce((s, i) => {
      const p = priceMap.get(i.productId);
      return s + (p ? p.price * i.qty : 0);
    }, 0);

    // ── 3. Discounts: tier → promo → happy hour → bill ────
    let discount = 0;
    const appliedPromo = payload.promoCode?.trim().toUpperCase() || null;

    if (customer?.tier === "Gold") discount += subtotal * 0.1;
    else if (customer?.tier === "Silver") discount += subtotal * 0.05;

    if (appliedPromo) {
      const promo = await db.promoCode.findFirst({ where: { code: appliedPromo, active: true } });
      if (promo && subtotal >= promo.minSpend) {
        discount += promo.type === "percent" ? subtotal * (promo.value / 100) : promo.value;
      } else if (promo && subtotal < promo.minSpend) {
        return NextResponse.json({ ok: false, error: `Promo ${promo.code} needs a minimum spend of KES ${promo.minSpend.toLocaleString()}` }, { status: 400 });
      }
    }

    // Happy Hour auto-pricing — % off qualifying categories while the window
    // runs. Evaluated at the sale's own timestamp so offline-replayed sales
    // get the price that was on the till when they were rung up.
    const saleTime = payload.createdAt ? new Date(payload.createdAt) : new Date();
    if (isHappyHourActive(settings, saleTime)) {
      for (const item of items) {
        const p = priceMap.get(item.productId);
        if (p && happyHourMatchesCategory(settings, p.category)) {
          discount += p.price * item.qty * (settings.happyHourPercent / 100);
        }
      }
    }

    if (payload.billDiscount) discount += payload.billDiscount;

    // ── 4. Loyalty points redemption ─────────────────────
    const pointsRedeemed = Math.min(payload.pointsRedeemed ?? 0, customer?.loyaltyPoints ?? 0);
    const pointsValue = pointsRedeemed * settings.loyaltyPointValue;
    discount += pointsValue;

    const afterDiscount = Math.max(0, subtotal - discount);
    const vat = Math.round(afterDiscount * settings.vatRate);
    const total = Math.round(afterDiscount + vat);

    // Gift card payment validation
    if (paymentMethod === "Gift Card") {
      if (!customer || customer.giftCardBalance < total) {
        return NextResponse.json({ ok: false, error: "Insufficient gift card balance" }, { status: 400 });
      }
    }

    // ── 5. Stock decrement (capture pre-sale qty for reorder crossing) ──
    const prevQty = new Map<number, number>();
    for (const item of items) {
      const stock = await db.stockLevel.findUnique({
        where: { productId_storeId: { productId: item.productId, storeId } },
      });
      if (!stock) {
        return NextResponse.json({ ok: false, error: `No stock record for product ${item.productId}` }, { status: 400 });
      }
      if (stock.qty < item.qty) {
        const p = priceMap.get(item.productId);
        return NextResponse.json({ ok: false, error: `Insufficient stock: ${p?.name ?? "Item"} (have ${stock.qty})` }, { status: 400 });
      }
      prevQty.set(item.productId, stock.qty);
    }
    for (const item of items) {
      await db.stockLevel.update({
        where: { productId_storeId: { productId: item.productId, storeId } },
        data: { qty: { decrement: item.qty } },
      });
    }

    // ── 6. Loyalty earned ────────────────────────────────
    const pointsEarned = Math.floor(total / settings.loyaltyEarnPerKes);

    // ── 7. Receipt number ────────────────────────────────
    const count = await db.sale.count();
    const receiptNo = `INV-${2848 + count}`;

    // ── 8. eTIMS ─────────────────────────────────────────
    let kraStatus: string = "Pending";
    let cuInvoiceNumber: string | null = null;
    let qrCodeBase64: string | null = null;
    if (settings.kraConnected) {
      const submission = await submitToEtims({
        kraPin: settings.kraPin,
        branchId: settings.kraBranchId,
        deviceSerial: settings.kraDeviceSerial,
        invoiceNumber: receiptNo,
        dateTime: payload.createdAt ? new Date(payload.createdAt) : new Date(),
        total,
        tax: vat,
      });
      if (submission.ok) {
        kraStatus = "Verified";
        cuInvoiceNumber = submission.cuInvoiceNumber ?? null;
        qrCodeBase64 = await generateInvoiceQr(submission.qrData ?? receiptNo);
      }
    }

    // ── 9. Create sale ───────────────────────────────────
    const sale = await db.sale.create({
      data: {
        receiptNo, storeId, customerId: customer?.id ?? null,
        staffName: payload.staffName ?? "Counter 1",
        subtotal: Math.round(subtotal), discount: Math.round(discount), vat, total,
        paymentMethod, pointsRedeemed, pointsEarned,
        tierAtSale: customer?.tier ?? null,
        promoCode: appliedPromo,
        kraStatus, cuInvoiceNumber, qrCodeBase64,
        offlineCreated: payload.offlineCreated ?? false,
        clientId: payload.clientId ?? null,
        createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
        syncedAt: new Date(),
        items: {
          create: items.map((i) => {
            const p = priceMap.get(i.productId)!;
            return {
              productId: p.id, name: p.name, emoji: p.emoji,
              qty: i.qty, unitPrice: p.price, total: p.price * i.qty,
            };
          }),
        },
      },
      include: { items: true },
    });

    // ── 10. Customer side effects ────────────────────────
    let loyaltyBalance = customer?.loyaltyPoints ?? 0;
    if (customer) {
      loyaltyBalance = customer.loyaltyPoints - pointsRedeemed + pointsEarned;
      const debtDelta = paymentMethod === "Credit Sale" ? total : 0;
      const giftDelta = paymentMethod === "Gift Card" ? total : 0;
      await db.customer.update({
        where: { id: customer.id },
        data: {
          loyaltyPoints: loyaltyBalance,
          totalSpent: { increment: total },
          debtBalance: { increment: debtDelta },
          giftCardBalance: { decrement: giftDelta },
          lastVisit: "Today",
        },
      });

      // Auto debt plan on credit sale
      if (paymentMethod === "Credit Sale" && debtDelta > 0) {
        const installmentAmount = debtDelta > 10000 ? Math.ceil(debtDelta / 5 / 500) * 500 : debtDelta;
        const nextDue = new Date();
        nextDue.setDate(nextDue.getDate() + 7);
        await db.debtPlan.create({
          data: {
            customerId: customer.id, invoiceNo: receiptNo, totalDebt: debtDelta,
            installmentType: debtDelta > 10000 ? "Monthly" : "Weekly",
            installmentAmount, nextDueDate: nextDue,
          },
        });
      }
    }

    // ── 11. Receipt SMS ──────────────────────────────
    if (customer && paymentMethod !== "Credit Sale") {
      await db.smsLog.create({
        data: {
          customerId: customer.id, phone: customer.phone,
          message: `Hi ${customer.name}, Receipt ${receiptNo}, Total KES ${total.toLocaleString()}, Points earned ${pointsEarned}, Balance ${loyaltyBalance} pts. Asante!`,
          type: "Receipt", channel: "SMS", status: "Delivered", cost: 1,
        },
      });
    }

    // ── 11b. Auto e-invoice email on KRA verify ──────────
    // When eTIMS stamped the invoice and the customer has an email on file,
    // deliver the electronic tax invoice automatically (best-effort — a mail
    // hiccup must never fail a committed sale).
    if (customer?.email && kraStatus === "Verified") {
      try {
        const { buildInvoiceEmailForSale } = await import("@/lib/invoice-email");
        const email = await buildInvoiceEmailForSale(sale.id);
        if (email) {
          await db.smsLog.create({
            data: {
              customerId: customer.id, phone: customer.email,
              message: email.body, channel: "Email", type: "Invoice",
              status: "Delivered", cost: 0,
            },
          });
        }
      } catch {
        /* auto email is best-effort */
      }
    }

    // ── 12. Realtime broadcast + low-stock watchdog ─────
    // Push the committed sale to every open dashboard (socket.io via the
    // live-feed service). Best-effort — must never fail the sale.
    const store = await db.store.findUnique({ where: { id: storeId } });
    emitLive("sale:new", {
      receiptNo,
      storeName: store?.name ?? "Store",
      customerName: customer?.name ?? "Walk-in",
      customerTier: customer?.tier ?? null,
      total,
      paymentMethod,
      kraStatus,
      staffName: sale.staffName,
      offlineCreated: sale.offlineCreated,
      createdAt: sale.createdAt,
    });

    // Low-stock watchdog: when a sale takes an item AT/BELOW its reorder
    // point, alert #stock-alerts in Raven and push a stock:low event so open
    // dashboards toast immediately. Only fires on the crossing itself so a
    // run of sales never spams the channel.
    for (const item of items) {
      const fresh = await db.stockLevel.findUnique({
        where: { productId_storeId: { productId: item.productId, storeId } },
      });
      const before = prevQty.get(item.productId);
      const p = priceMap.get(item.productId);
      if (!fresh || !p || before === undefined) continue;
      if (before > fresh.reorderPoint && fresh.qty <= fresh.reorderPoint) {
        const channel = await db.chatChannel.findFirst({ where: { name: "stock-alerts" } });
        if (channel) {
          await db.chatMessage.create({
            data: {
              channelId: channel.id,
              author: "Stock Bot",
              initials: "SB",
              content: `⚠️ Low stock: ${p.emoji} ${p.name} at ${store?.name ?? "store"} is down to ${fresh.qty} (reorder at ${fresh.reorderPoint}). Raised by sale ${receiptNo}.`,
            },
          });
          await db.chatChannel.update({ where: { id: channel.id }, data: { unread: { increment: 1 } } });
          emitLive("chat:new", {
            channelId: channel.id,
            channelName: channel.name,
            id: 0,
            author: "Stock Bot",
            initials: "SB",
            content: `⚠️ Low stock: ${p.emoji} ${p.name} at ${store?.name ?? "store"} is down to ${fresh.qty} (reorder at ${fresh.reorderPoint}). Raised by sale ${receiptNo}.`,
            createdAt: new Date().toISOString(),
          });
        }
        emitLive("stock:low", {
          productName: p.name,
          emoji: p.emoji,
          storeName: store?.name ?? "Store",
          qty: fresh.qty,
          reorderPoint: fresh.reorderPoint,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      sale: { ...sale, storeName: store?.name, customerName: customer?.name ?? "Walk-in" },
      loyalty: { earned: pointsEarned, balance: loyaltyBalance, redeemed: pointsRedeemed },
    });
  } catch (err) {
    console.error("Sale error", err);
    return NextResponse.json({ ok: false, error: "Sale failed on server" }, { status: 500 });
  }
}
