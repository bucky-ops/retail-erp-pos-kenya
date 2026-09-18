/**
 * One-off: seed Round-6 procurement + expense + returns demo data.
 *  • 5 Kenyan suppliers across categories
 *  • 2 purchase orders (one Received with stock already applied? no - historical
 *    one is marked Received without touching stock, one live Draft/Sent for the UI)
 *  • ~12 expenses across stores/categories for the P&L view
 * Safe to re-run: skips when its data already exists.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // -- Suppliers --------------------------------------------------------------
  if ((await db.supplier.count()) === 0) {
    await db.supplier.createMany({
      data: [
        { name: "Bamburi Building Supplies", phone: "0722 111 001", email: "sales@bamburibuild.co.ke", kraPin: "P051111111A", category: "Cement", leadDays: 2 },
        { name: "Crown Paints Distributors", phone: "0733 222 002", email: "orders@crowndist.co.ke", kraPin: "P052222222B", category: "Paint", leadDays: 3 },
        { name: "PlumbFast Kenya Ltd", phone: "0720 333 003", email: "hello@plumbfast.co.ke", kraPin: "P053333333C", category: "Plumbing", leadDays: 4 },
        { name: "ToolMaster Imports", phone: "0711 444 004", email: "info@toolmaster.co.ke", kraPin: "P054444444D", category: "Tools", leadDays: 7 },
        { name: "General Traders EA", phone: "0700 555 005", email: "sales@gtraders.co.ke", kraPin: "P055555555E", category: "General", leadDays: 5 },
      ],
    });
    console.log("seeded 5 suppliers");
  }

  // -- Purchase orders --------------------------------------------------------
  if ((await db.purchaseOrder.count()) === 0) {
    const suppliers = await db.supplier.findMany();
    const stores = await db.store.findMany();
    const main = stores.find((s) => s.isMain) ?? stores[0];
    const second = stores.find((s) => !s.isMain) ?? stores[0];
    const cement = await db.product.findFirst({ where: { category: "Cement" } });
    const paint = await db.product.findFirst({ where: { category: "Paint" } });
    const plumbing = await db.product.findFirst({ where: { category: "Plumbing" } });

    if (cement && paint && plumbing && main && second && suppliers.length) {
      const cementSup = suppliers.find((s) => s.category === "Cement")!;
      const paintSup = suppliers.find((s) => s.category === "Paint")!;

      // A fully received historical PO (stock effect intentionally NOT applied -
      // it predates the feature; live stock already includes it narratively).
      const d1 = new Date();
      d1.setDate(d1.getDate() - 9);
      await db.purchaseOrder.create({
        data: {
          poNo: "PO-1001",
          supplierId: cementSup.id,
          storeId: main.id,
          status: "Received",
          total: 300 * cement.cost,
          note: "Weekly cement replenishment",
          orderedAt: d1,
          receivedAt: new Date(d1.getTime() + 2 * 24 * 3600 * 1000),
          items: { create: [{ productId: cement.id, qty: 300, unitCost: cement.cost, received: 300 }] },
        },
      });

      // A live Draft PO the UI can act on.
      await db.purchaseOrder.create({
        data: {
          poNo: "PO-1002",
          supplierId: paintSup.id,
          storeId: second.id,
          status: "Draft",
          total: 60 * paint.cost + 40 * plumbing.cost,
          note: "Kiambu branch restock before month-end promo",
          items: { create: [{ productId: paint.id, qty: 60, unitCost: paint.cost }, { productId: plumbing.id, qty: 40, unitCost: plumbing.cost }] },
        },
      });
      console.log("seeded 2 purchase orders");
    }
  }

  // -- Expenses ---------------------------------------------------------------
  if ((await db.expense.count()) === 0) {
    const stores = await db.store.findMany();
    if (stores.length) {
      const rows: { storeId: number; category: string; note: string; amount: number; paidVia: string; daysAgo: number; refNo?: string }[] = [
        { storeId: stores[0].id, category: "Rent", note: "Monthly shop rent - Thika Road plaza", amount: 85000, paidVia: "Bank", daysAgo: 12, refNo: "RENT-SEP" },
        { storeId: stores[0].id, category: "Electricity", note: "KPLC token purchase", amount: 12400, paidVia: "M-Pesa", daysAgo: 6, refNo: "KPLC-88213" },
        { storeId: stores[0].id, category: "Transport", note: "Delivery boda runs - last week", amount: 3200, paidVia: "Cash", daysAgo: 4 },
        { storeId: stores[0].id, category: "Supplies", note: "Receipt rolls + shopping bags", amount: 4600, paidVia: "Cash", daysAgo: 3 },
        { storeId: stores[0].id, category: "Marketing", note: "Radio spot - Rastra 100.3FM", amount: 15000, paidVia: "M-Pesa", daysAgo: 8 },
        { storeId: stores[0].id, category: "Repairs", note: "POS drawer + shutter servicing", amount: 5500, paidVia: "Cash", daysAgo: 2 },
      ];
      if (stores[1]) {
        rows.push(
          { storeId: stores[1].id, category: "Rent", note: "Monthly shop rent - Kiambu stand", amount: 48000, paidVia: "Bank", daysAgo: 12, refNo: "RENT-KB-SEP" },
          { storeId: stores[1].id, category: "Electricity", note: "KPLC token purchase", amount: 7800, paidVia: "M-Pesa", daysAgo: 7, refNo: "KPLC-88410" },
          { storeId: stores[1].id, category: "Salaries", note: "Casual loader wages (week)", amount: 9000, paidVia: "M-Pesa", daysAgo: 5 },
          { storeId: stores[1].id, category: "Transport", note: "Stock pickup from Thika HQ", amount: 4500, paidVia: "Cash", daysAgo: 3 },
        );
      }
      for (const r of rows) {
        const at = new Date();
        at.setDate(at.getDate() - r.daysAgo);
        await db.expense.create({
          data: {
            storeId: r.storeId,
            category: r.category,
            note: r.note,
            amount: r.amount,
            paidVia: r.paidVia,
            refNo: r.refNo ?? null,
            spentAt: at,
          },
        });
      }
      console.log(`seeded ${rows.length} expenses`);
    }
  }

  // -- One historical sales return for the returns history UI ------------------
  if ((await db.salesReturn.count()) === 0) {
    const sale = await db.sale.findFirst({
      where: { items: { some: {} }, paymentMethod: { not: "Credit Sale" } },
      include: { items: true, store: true, customer: true },
      orderBy: { createdAt: "desc" },
    });
    if (sale && sale.items.length) {
      const line = sale.items[0];
      const qty = Math.max(1, Math.floor(line.qty / 2));
      const at = new Date();
      at.setHours(at.getHours() - 20);
      await db.salesReturn.create({
        data: {
          returnNo: "RET-1000",
          saleId: sale.id,
          storeId: sale.storeId,
          customerId: sale.customerId,
          staffName: "Store Manager",
          reason: "Damaged in transit",
          refundMethod: "Cash refund",
          restocked: false,
          total: line.unitPrice * qty,
          createdAt: at,
          items: {
            create: [{
              saleItemId: line.id,
              productId: line.productId,
              name: line.name,
              emoji: line.emoji,
              qty,
              unitPrice: line.unitPrice,
              total: line.unitPrice * qty,
            }],
          },
        },
      });
      console.log(`seeded 1 historical return on ${sale.receiptNo}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
