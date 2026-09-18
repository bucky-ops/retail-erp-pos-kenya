/**
 * Supermarket upgrade seed - Naivas-style test data.
 * Run: bunx tsx prisma/seed-supermarket.ts  (or bun prisma/seed-supermarket.ts)
 * Adds: scale products, loyalty customers, 10 held carts, 3 closed Z reports
 * with digital receipts, one full Quotation -> Payment chain, gift cards.
 * Idempotent: wipes and recreates only its own rows (keeps all other data).
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  console.log("Seeding supermarket upgrade data...");

  const stores = await db.store.findMany({ orderBy: { id: "asc" } });
  const mainStore = stores[0];
  const secondStore = stores[1] ?? stores[0];

  // --- 1. Scale (weight) products - Kenyan greengrocery ----------------------
  const scaleProducts = [
    { name: "Fresh Bananas (kg)", sku: "GRV-001", scaleCode: "10001", price: 129, unit: "kg", emoji: "🍌", category: "Groceries", barcode: "2010001000009" },
    { name: "Sukuma Wiki (kg)", sku: "GRV-002", scaleCode: "10002", price: 65, unit: "kg", emoji: "🥬", category: "Groceries", barcode: "2010002000006" },
    { name: "Red Tomatoes (kg)", sku: "GRV-003", scaleCode: "10003", price: 89, unit: "kg", emoji: "🍅", category: "Groceries", barcode: "2010003000003" },
    { name: "Navel Oranges (kg)", sku: "GRV-004", scaleCode: "10004", price: 149, unit: "kg", emoji: "🍊", category: "Groceries", barcode: "2010004000000" },
  ];
  for (const p of scaleProducts) {
    const existing = await db.product.findUnique({ where: { sku: p.sku } });
    if (existing) continue;
    const created = await db.product.create({ data: { ...p, isScale: true, cost: Math.round(p.price * 0.7) } });
    for (const s of stores) {
      await db.stockLevel.create({
        data: { productId: created.id, storeId: s.id, qty: 80, reorderPoint: 20 },
      });
    }
    console.log("  + scale product", created.name);
  }

  // --- 2. Five loyalty customers with points --------------------------------
  const loyaltyCustomers = [
    { name: "John Kamau", phone: "+254712000101", tier: "Gold", loyaltyPoints: 420, totalSpent: 186000 },
    { name: "Naomi Wairimu", phone: "+254712000102", tier: "Gold", loyaltyPoints: 2100, totalSpent: 402000 },
    { name: "Peter Mwangi", phone: "+254712000103", tier: "Silver", loyaltyPoints: 750, totalSpent: 96000 },
    { name: "Brian Otieno", phone: "+254712000104", tier: "Bronze", loyaltyPoints: 45, totalSpent: 12400 },
    { name: "Grace Njeri", phone: "+254712000105", tier: "Silver", loyaltyPoints: 510, totalSpent: 88000 },
  ];
  for (const c of loyaltyCustomers) {
    const existing = await db.customer.findUnique({ where: { phone: c.phone } });
    if (existing) {
      await db.customer.update({ where: { id: existing.id }, data: { loyaltyPoints: c.loyaltyPoints, tier: c.tier } });
      continue;
    }
    await db.customer.create({ data: { ...c, creditLimit: c.tier === "Gold" ? 50000 : 10000 } });
    console.log("  + customer", c.name, c.tier, c.loyaltyPoints, "pts");
  }

  // --- 3. Gift cards for QR balance check ------------------------------------
  const giftCards = [
    { code: "GF-NAIVAS-0500", balance: 500, initialBalance: 500 },
    { code: "GF-NAIVAS-2000", balance: 1375, initialBalance: 2000 },
  ];
  for (const g of giftCards) {
    const existing = await db.giftCard.findUnique({ where: { code: g.code } });
    if (!existing) {
      await db.giftCard.create({ data: { ...g, gradient: "emerald" } });
      console.log("  + gift card", g.code, "balance", g.balance);
    }
  }

  // --- 4. Ten held carts (HOLD + resume demo) --------------------------------
  const products = await db.product.findMany({ take: 12 });
  if (products.length >= 4) {
    await db.posHold.deleteMany({});
    const holdRows = [
      { staffName: "Mary Wanjiku", label: "Basket at counter 2", customer: "John Kamau", picks: [0, 1], qtys: [2, 1.25] },
      { staffName: "James Otieno", label: "Customer went to ATM", customer: "", picks: [2, 3, 4], qtys: [1, 3, 2] },
      { staffName: "Grace Akinyi", label: "Half-picked hardware order", customer: "Naomi Wairimu", picks: [5, 6], qtys: [10, 4] },
      { staffName: "Mary Wanjiku", label: "Waiting for M-Pesa", customer: "", picks: [7, 8], qtys: [1, 2] },
      { staffName: "James Otieno", label: "Price check hold", customer: "Peter Mwangi", picks: [9, 10, 11], qtys: [5, 1, 3] },
      { staffName: "Grace Akinyi", label: "Groceries + cement mix", customer: "", picks: [0, 2, 5], qtys: [4.5, 2, 1] },
      { staffName: "Mary Wanjiku", label: "School run - will return", customer: "Grace Njeri", picks: [3, 6, 7], qtys: [2, 1, 3] },
      { staffName: "James Otieno", label: "Bulk paint order", customer: "", picks: [8, 9], qtys: [12, 6] },
      { staffName: "Grace Akinyi", label: "Evening rush basket", customer: "Brian Otieno", picks: [10, 11, 0], qtys: [1, 2, 3.2] },
      { staffName: "Mary Wanjiku", label: "Split payment pending", customer: "", picks: [1, 4, 6], qtys: [2, 1, 2] },
    ];
    let n = 0;
    for (const h of holdRows) {
      n += 1;
      const items = h.picks.map((pi, i) => {
        const p = products[pi % products.length];
        return {
          productId: p.id, name: p.name, emoji: p.emoji, unit: p.unit,
          qty: h.qtys[i], unitPrice: p.price, discount: 0,
          total: r2(p.price * h.qtys[i]),
        };
      });
      const subtotal = r2(items.reduce((s, i) => s + i.total, 0));
      await db.posHold.create({
        data: {
          holdCode: `HOLD-${String(n).padStart(4, "0")}`,
          staffName: h.staffName,
          storeId: n % 3 === 0 ? secondStore.id : mainStore.id,
          customerName: h.customer,
          label: h.label,
          itemsJson: JSON.stringify(items),
          itemCount: items.reduce((s, i) => s + i.qty, 0),
          subtotal,
          total: subtotal,
          createdAt: new Date(Date.now() - n * 7 * 60000),
        },
      });
    }
    console.log("  + 10 held carts");
  }

  // --- 5. Three closed Z reports with digital receipts ------------------------
  await db.dayClose.deleteMany({ where: { status: "Closed", note: { contains: "seeded Z" } } });
  const settings = await db.settings.findUnique({ where: { id: 1 } });
  const zDays = [3, 2, 1]; // business days ago
  let zCount = 0;
  for (const daysAgo of zDays) {
    zCount += 1;
    const d = new Date(Date.now() - daysAgo * 86400000);
    const pad = (x: number) => String(x).padStart(2, "0");
    const businessDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const zNo = `Z-${businessDate.replace(/-/g, "")}-THIKA`;
    const exists = await db.dayClose.findUnique({ where: { zNo } });
    if (exists) continue;
    const cash = r2(38400 + zCount * 1200);
    const mpesa = r2(43100 - zCount * 800);
    const paybill = r2(5200 * zCount);
    const card = r2(3100 + zCount * 150);
    const points = r2(900 * zCount);
    const salesTotal = r2(cash + mpesa + paybill + card + points);
    const z = await db.dayClose.create({
      data: {
        zNo, storeId: mainStore.id, businessDate, status: "Closed",
        salesTotal, receipts: 35 + zCount * 4,
        cashSystem: cash, cashCounted: r2(cash - 50 * zCount),
        mpesaSystem: mpesa, mpesaCounted: mpesa,
        cardSystem: card, paybillSystem: paybill, pointsSystem: points,
        discountsTotal: r2(1450 * zCount), returnsTotal: r2(zCount === 2 ? 1899 : 0),
        variance: r2(-50 * zCount), approvedBy: zCount === 3 ? "Owner" : "",
        staffOnDuty: "Mary Wanjiku, James Otieno, Grace Akinyi",
        openingCash: 15000, closingCash: r2(cash - 50 * zCount),
        note: "seeded Z report - supermarket upgrade demo",
        openedAt: new Date(d.getTime() - 12 * 3600000),
        closedAt: new Date(d.getTime() + 2 * 3600000),
      },
    });
    // Digital twin so the printed QR opens a live page.
    const drCount = await db.digitalReceipt.count();
    const receiptCode = `NVS-DUKA-${new Date().getFullYear()}-${String(drCount + 1).padStart(5, "0")}`;
    const url = `https://retail-erp-pos-kenya.vercel.app/receipt/${receiptCode}`;
    await db.digitalReceipt.create({
      data: {
        receiptCode, kind: "ZREPORT", refNo: z.zNo, url,
        payloadJson: JSON.stringify({
          zNo: z.zNo, businessDate, storeName: mainStore.name,
          openingFloat: 15000,
          salesByMethod: { cash, mpesaTill: mpesa, mpesaPaybill: paybill, card, points },
          totalSales: salesTotal, receipts: z.receipts,
          discounts: z.discountsTotal, returns: z.returnsTotal,
          closingCash: z.closingCash, variance: z.variance,
          approvedBy: z.approvedBy, staffOnDuty: z.staffOnDuty,
        }),
      },
    });
    await db.dayClose.update({ where: { id: z.id }, data: { digitalCode: receiptCode } });
    console.log("  + Z report", zNo, "->", receiptCode);
  }

  // --- 6. One full Quotation -> Proforma -> Order -> Invoice -> Payment chain --
  const dealId = "seed-chain-full-0001";
  const chainAmount = 184500;
  const existingDeal = await db.pipelineDeal.findUnique({ where: { id: dealId } });
  if (!existingDeal) {
    const specs: { stage: string; prefix: string; kind: string; label: string }[] = [
      { stage: "quotation", prefix: "QT", kind: "QUOTATION", label: "Quotation" },
      { stage: "proforma", prefix: "PF", kind: "PROFORMA", label: "Proforma" },
      { stage: "order", prefix: "SO", kind: "ORDER", label: "Sales Order" },
      { stage: "invoiced", prefix: "INV", kind: "INVOICE", label: "Invoice" },
      { stage: "paid", prefix: "PAY", kind: "PAYMENT", label: "Payment" },
    ];
    const docs: Record<string, { no: string; digitalCode: string; url: string; kind: string; at: string }> = {};
    let dr = await db.digitalReceipt.count();
    for (const s of specs) {
      dr += 1;
      const no = `${s.prefix}-9001`;
      const receiptCode = `NVS-DUKA-${new Date().getFullYear()}-${String(dr).padStart(5, "0")}`;
      const url = `https://retail-erp-pos-kenya.vercel.app/receipt/${receiptCode}`;
      await db.digitalReceipt.create({
        data: {
          receiptCode, kind: s.kind, refNo: no, url,
          payloadJson: JSON.stringify({
            dealId, customerName: "Naomi Wairimu", title: "Fit-out order - cement, paint, plumbing",
            amount: chainAmount, lines: [
              { no: 1, name: "Bamburi Cement 50kg x 40", qty: 40, unit: "pc", unitPrice: 1250, discount: 0, total: 50000 },
              { no: 2, name: "Crown Paint Gloss White 4L x 30", qty: 30, unit: "pc", unitPrice: 2450, discount: 0, total: 73500 },
              { no: 3, name: "Angle Valve Brass x 90", qty: 90, unit: "pc", unitPrice: 420, discount: 0, total: 37800 },
              { no: 4, name: "PVC Pipes bundle", qty: 1, unit: "lot", unitPrice: 23200, discount: 0, total: 23200 },
            ],
            grandTotal: `KES ${chainAmount.toLocaleString()}`,
          }),
        },
      });
      docs[s.stage] = { no, digitalCode: receiptCode, url, kind: s.kind, at: new Date().toISOString() };
    }
    const history = specs.map((s) => ({ stage: s.label + " Created", at: new Date().toISOString(), by: "Owner" }));
    await db.pipelineDeal.create({
      data: {
        id: dealId,
        stage: "paid",
        customerName: "Naomi Wairimu",
        customerPhone: "+254712000102",
        title: "Fit-out order - cement, paint, plumbing",
        amount: chainAmount,
        itemCount: 161,
        assignee: "G",
        notes: "Seeded full chain: quotation matured to payment in one click demo.",
        history: JSON.stringify(history),
        docsJson: JSON.stringify(docs),
      },
    });
    console.log("  + full chain deal QT -> PAY with 5 digital receipts");
  }

  console.log("Supermarket seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
