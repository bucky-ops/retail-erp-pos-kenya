/**
 * DukaFlow seed — Kenyan-realistic data for a hardware store ERP+POS.
 * Run: bun prisma/seed.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const now = new Date();
const daysAgo = (d: number, h = 0) =>
  new Date(now.getTime() - d * 864e5 - h * 36e5);
const daysAhead = (d: number) => new Date(now.getTime() + d * 864e5);

async function main() {
  console.log("🌱 Seeding DukaFlow...");

  // wipe (order matters)
  await db.smsLog.deleteMany();
  await db.chatMessage.deleteMany();
  await db.chatChannel.deleteMany();
  await db.payslip.deleteMany();
  await db.employee.deleteMany();
  await db.debtPlan.deleteMany();
  await db.giftCard.deleteMany();
  await db.promoCode.deleteMany();
  await db.saleItem.deleteMany();
  await db.sale.deleteMany();
  await db.pipelineDeal.deleteMany();
  await db.stockTransfer.deleteMany();
  await db.stockLevel.deleteMany();
  await db.product.deleteMany();
  await db.customer.deleteMany();
  await db.staff.deleteMany();
  await db.store.deleteMany();
  await db.settings.deleteMany();

  // ─── Stores ──────────────────────────────────────────────
  const thika = await db.store.create({
    data: { name: "Thika Road", location: "Nairobi", isMain: true },
  });
  const kiambu = await db.store.create({
    data: { name: "Kiambu Road", location: "Kiambu" },
  });

  // ─── Staff (PIN login) ───────────────────────────────────
  await db.staff.createMany({
    data: [
      { name: "Mary Wanjiku", role: "Cashier", pin: "1234", color: "#0052CC", onShift: true, storeId: thika.id },
      { name: "James Otieno", role: "Store Keeper", pin: "2345", color: "#00C853", onShift: true, storeId: thika.id },
      { name: "Grace Akinyi", role: "Sales", pin: "3456", color: "#FF5630", onShift: false, storeId: kiambu.id },
      { name: "Owner (OK)", role: "Owner", pin: "0000", color: "#172B4D", onShift: true, storeId: thika.id },
    ],
  });

  // ─── Products ────────────────────────────────────────────
  const productData = [
    { name: "Bamburi Cement 50kg", sku: "CMT-001", category: "Cement", price: 1250, cost: 1100, emoji: "🧱", thika: 45, kiambu: 60, reorder: 20 },
    { name: "Crown Paint Gloss White 4L", sku: "PNT-012", category: "Paint", price: 3450, cost: 2900, emoji: "🎨", thika: 3, kiambu: 14, reorder: 10 },
    { name: 'PVC Pipe 3/4" 6m', sku: "PLB-033", category: "Plumbing", price: 650, cost: 520, emoji: "🚿", thika: 120, kiambu: 80, reorder: 24 },
    { name: "Hammer 16oz Stanley", sku: "TLS-009", category: "Tools", price: 1450, cost: 1150, emoji: "🔨", thika: 0, kiambu: 6, reorder: 8 },
    { name: "Electrical Cable 2.5mm", sku: "ELC-021", category: "Electrical", price: 890, cost: 700, emoji: "🔌", thika: 67, kiambu: 40, reorder: 15 },
    { name: "Gypsum Board 9mm", sku: "CMT-014", category: "Cement", price: 950, cost: 800, emoji: "🧱", thika: 22, kiambu: 30, reorder: 12 },
    { name: "Dulux Vinyl Matt 20L", sku: "PNT-018", category: "Paint", price: 6200, cost: 5400, emoji: "🎨", thika: 8, kiambu: 4, reorder: 6 },
    { name: "Angle Valve Brass", sku: "PLB-041", category: "Plumbing", price: 420, cost: 310, emoji: "🚰", thika: 54, kiambu: 35, reorder: 15 },
    { name: "Steel Nails 4in Kg", sku: "HWD-002", category: "Hardware", price: 180, cost: 130, emoji: "🔩", thika: 210, kiambu: 150, reorder: 40 },
    { name: "Wheelbarrow Heavy Duty", sku: "TLS-021", category: "Tools", price: 4800, cost: 3900, emoji: "🛒", thika: 12, kiambu: 7, reorder: 5 },
    { name: "Circuit Breaker 32A", sku: "ELC-040", category: "Electrical", price: 1350, cost: 1050, emoji: "⚡", thika: 18, kiambu: 9, reorder: 10 },
    { name: "Toilet Seat Set", sku: "PLB-077", category: "Plumbing", price: 7500, cost: 6200, emoji: "🚽", thika: 5, kiambu: 2, reorder: 4 },
  ];
  const products: Record<string, { id: number; price: number; name: string; emoji: string; category: string }> = {};
  for (const p of productData) {
    const created = await db.product.create({
      data: {
        name: p.name, sku: p.sku, category: p.category, price: p.price, cost: p.cost,
        emoji: p.emoji,
        barcode: `62${String(1000000 + productData.indexOf(p) * 137).padStart(11, "0")}`,
        stocks: {
          create: [
            { storeId: thika.id, qty: p.thika, reorderPoint: p.reorder },
            { storeId: kiambu.id, qty: p.kiambu, reorderPoint: p.reorder },
          ],
        },
      },
    });
    products[p.sku] = { id: created.id, price: p.price, name: p.name, emoji: p.emoji, category: p.category };
  }

  // ─── Customers ───────────────────────────────────────────
  const cust = await Promise.all(
    [
      { name: "John Kamau", phone: "0712345678", tier: "Gold", points: 420, spent: 125000, debt: 6000, limit: 50000, gift: 1000, last: "2 days ago" },
      { name: "Wanjiku Mwangi", phone: "0722111222", tier: "Silver", points: 120, spent: 54000, debt: 0, limit: 10000, gift: 0, last: "Today" },
      { name: "Otieno Ochieng", phone: "0700999888", tier: "Bronze", points: 20, spent: 12000, debt: 4500, limit: 5000, gift: 500, last: "5 days ago" },
      { name: "Achieng Atieno", phone: "0745333444", tier: "Gold", points: 1200, spent: 320000, debt: 0, limit: 100000, gift: 5000, last: "1 day ago" },
      { name: "Mutiso Kilonzo", phone: "0733777888", tier: "Silver", points: 310, spent: 78000, debt: 12000, limit: 20000, gift: 0, last: "3 days ago" },
      { name: "Chebet Rono", phone: "0710111000", tier: "Bronze", points: 45, spent: 9800, debt: 12000, limit: 5000, gift: 0, last: "1 week ago" },
      { name: "Kamau Hardware Ltd", phone: "0725555666", tier: "Gold", points: 890, spent: 450000, debt: 0, limit: 200000, gift: 2000, last: "4 hours ago" },
      { name: "Thika Builders Co", phone: "0734222333", tier: "Gold", points: 1560, spent: 612000, debt: 25000, limit: 300000, gift: 0, last: "Yesterday" },
    ].map((c) =>
      db.customer.create({
        data: {
          name: c.name, phone: c.phone, tier: c.tier, loyaltyPoints: c.points,
          totalSpent: c.spent, debtBalance: c.debt, creditLimit: c.limit,
          giftCardBalance: c.gift, lastVisit: c.last,
          storeId: c.name.includes("Kiambu") ? kiambu.id : thika.id,
          birthday: c.name === "Achieng Atieno" ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : null,
        },
      })
    )
  );
  const [john, wanjiku, otieno, achieng, mutiso, chebet, kamauHw, thikaB] = cust;

  // ─── Sales history (incl. live feed rows) ────────────────
  const mkSale = async (
    receiptNo: string, storeId: number, customerId: number | null, staffName: string,
    lines: { sku: string; qty: number }[], paymentMethod: string, hoursAgo: number,
    kraStatus: "Verified" | "Pending" = "Verified", discount = 0, pointsEarned = 0, pointsRedeemed = 0
  ) => {
    const subtotal = lines.reduce((s, l) => s + products[l.sku].price * l.qty, 0);
    const afterDisc = subtotal - discount;
    const vat = Math.round(afterDisc * 0.16);
    const total = afterDisc + vat;
    const created = await db.sale.create({
      data: {
        receiptNo, storeId, customerId: customerId ?? undefined, staffName,
        subtotal, discount, vat, total, paymentMethod,
        pointsEarned: pointsEarned || Math.floor(total / 100),
        pointsRedeemed, tierAtSale: customerId ? cust.find((c) => c.id === customerId)?.tier : null,
        kraStatus, cuInvoiceNumber: kraStatus === "Verified" ? `KRAMW${storeId}${String(400 + Math.floor(Math.random() * 500))}·${receiptNo.slice(-4)}` : null,
        createdAt: daysAgo(0, hoursAgo), syncedAt: daysAgo(0, hoursAgo),
        items: {
          create: lines.map((l) => ({
            productId: products[l.sku].id, name: products[l.sku].name,
            emoji: products[l.sku].emoji, qty: l.qty,
            unitPrice: products[l.sku].price, total: products[l.sku].price * l.qty,
          })),
        },
      },
    });
    return created;
  };

  // Older sales (previous days) for trends — ~30 records
  let seq = 2800;
  const olderStores = [thika.id, kiambu.id];
  const payModes = ["M-Pesa", "Cash", "Till", "M-Pesa", "Gift Card", "Cash"];
  for (let d = 1; d <= 7; d++) {
    for (let n = 0; n < 4; n++) {
      const c = cust[(d + n) % cust.length];
      const skuList = Object.keys(products);
      const lines = [
        { sku: skuList[(d * 3 + n) % skuList.length], qty: 1 + ((d + n) % 4) },
        { sku: skuList[(d * 5 + n) % skuList.length], qty: 1 + (n % 3) },
      ];
      const payMode = payModes[(d + n) % payModes.length];
      await mkSale(`INV-${seq++}`, olderStores[(d + n) % 2], c.id, "Mary Wanjiku", lines, payMode, d * 24 + n * 3, n % 3 === 0 ? "Pending" : "Verified");
    }
  }

  // Live feed sales (today)
  await mkSale("INV-2847", thika.id, john.id, "Mary Wanjiku", [{ sku: "CMT-001", qty: 6 }, { sku: "HWD-002", qty: 2 }], "M-Pesa", 0.5);
  await mkSale("INV-2846", kiambu.id, wanjiku.id, "Grace Akinyi", [{ sku: "PNT-012", qty: 2 }], "Cash", 1, "Pending");
  await mkSale("INV-2845", thika.id, otieno.id, "Mary Wanjiku", [{ sku: "PLB-033", qty: 4 }, { sku: "PLB-041", qty: 1 }], "Till", 2);
  await mkSale("INV-2844", thika.id, achieng.id, "Mary Wanjiku", [{ sku: "CMT-001", qty: 30 }], "M-Pesa", 3);
  await mkSale("INV-2843", kiambu.id, mutiso.id, "Grace Akinyi", [{ sku: "TLS-009", qty: 0 }], "Gift Card", 3.8);
  // fix: hammer out-of-stock — replace with valve
  const gcardSale = await db.sale.findFirst({ where: { receiptNo: "INV-2843" } });
  if (gcardSale) {
    await db.saleItem.deleteMany({ where: { saleId: gcardSale.id } });
    await db.saleItem.createMany({
      data: [{ saleId: gcardSale.id, productId: products["PLB-041"].id, name: products["PLB-041"].name, emoji: products["PLB-041"].emoji, qty: 2, unitPrice: 420, total: 840 }],
    });
    await db.sale.update({ where: { id: gcardSale.id }, data: { subtotal: 840, vat: 134, total: 974 } });
  }
  await mkSale("INV-2842", thika.id, chebet.id, "James Otieno", [{ sku: "ELC-021", qty: 5 }], "Cash", 5, "Pending");

  // ─── Pipeline deals ──────────────────────────────────────
  const hist = (stages: string[]) =>
    JSON.stringify(stages.map((s, i) => ({ stage: s, at: daysAgo(5 - i, 4).toISOString(), by: "Owner" })));
  await db.pipelineDeal.createMany({
    data: [
      { stage: "quotation", customerName: "Kamau Hardware Ltd", customerPhone: "0725555666", amount: 45000, itemCount: 3, assignee: "M", title: "Monthly cement restock", history: hist(["quotation"]), createdAt: daysAgo(2) },
      { stage: "quotation", customerName: "Thika Builders Co", customerPhone: "0734222333", amount: 125000, itemCount: 12, assignee: "J", title: "Site B materials", history: hist(["quotation"]), createdAt: daysAgo(0, 5) },
      { stage: "proforma", customerName: "Wanjiku Homes", customerPhone: "0799111222", amount: 78000, itemCount: 5, assignee: "G", title: "Roofing + paint package", history: hist(["quotation", "proforma"]), createdAt: daysAgo(1) },
      { stage: "order", customerName: "Kiambu Estate Dev", customerPhone: "0720333444", amount: 230000, itemCount: 22, assignee: "M", title: "Phase 2 electricals", history: hist(["quotation", "proforma", "order"]), createdAt: daysAgo(3) },
      { stage: "invoiced", customerName: "John Kamau", customerPhone: "0712345678", amount: 12500, itemCount: 2, assignee: "J", title: "Cement + nails", history: hist(["quotation", "proforma", "order", "invoiced"]), createdAt: daysAgo(0, 8) },
      { stage: "paid", customerName: "Otieno & Sons", customerPhone: "0711444555", amount: 56000, itemCount: 4, assignee: "M", title: "Plumbing fit-out", history: hist(["quotation", "proforma", "order", "invoiced", "paid"]), createdAt: daysAgo(6) },
    ],
  });

  // ─── Gift cards ──────────────────────────────────────────
  await db.giftCard.createMany({
    data: [
      { code: "GC-1234", balance: 5000, initialBalance: 5000, customerId: john.id, expiry: daysAhead(300), gradient: "blue-green" },
      { code: "GC-1235", balance: 1500, initialBalance: 5000, customerId: otieno.id, expiry: daysAhead(200), gradient: "navy" },
      { code: "GC-1236", balance: 5000, initialBalance: 5000, customerId: achieng.id, expiry: daysAhead(360), gradient: "gold" },
      { code: "GC-1237", balance: 0, initialBalance: 2000, customerId: null, expiry: daysAhead(30), status: "Empty", gradient: "blue" },
      { code: "GC-1238", balance: 2500, initialBalance: 2500, customerId: null, expiry: daysAhead(180), gradient: "green" },
      { code: "GC-1239", balance: 10000, initialBalance: 10000, customerId: kamauHw.id, expiry: daysAhead(365), gradient: "navy-gold" },
    ],
  });

  // ─── Debt plans ──────────────────────────────────────────
  await db.debtPlan.createMany({
    data: [
      { customerId: john.id, invoiceNo: "INV-2847", totalDebt: 6000, installmentType: "Weekly", installmentAmount: 2000, nextDueDate: daysAhead(1), overdueDays: 5 },
      { customerId: otieno.id, invoiceNo: "INV-2810", totalDebt: 4500, installmentType: "Monthly", installmentAmount: 5000, nextDueDate: daysAhead(3), overdueDays: 0 },
      { customerId: chebet.id, invoiceNo: "INV-2799", totalDebt: 12000, installmentType: "Weekly", installmentAmount: 3000, nextDueDate: daysAhead(-4), overdueDays: 12 },
      { customerId: mutiso.id, invoiceNo: "INV-2750", totalDebt: 12000, installmentType: "Weekly", installmentAmount: 2500, nextDueDate: daysAhead(6), overdueDays: 0 },
      { customerId: thikaB.id, invoiceNo: "INV-2701", totalDebt: 25000, installmentType: "Monthly", installmentAmount: 10000, nextDueDate: daysAhead(2), overdueDays: 0 },
    ],
  });

  // ─── Employees & payslips (Sep 2026) ─────────────────────
  const employees = [
    { name: "Mary Wanjiku", idNo: "12345678", dept: "Sales", role: "Cashier", basic: 30000, house: 5000, transport: 3000, helb: 0, mpesa: "0712345678" },
    { name: "James Otieno", idNo: "23456789", dept: "Store", role: "Store Keeper", basic: 25000, house: 3000, transport: 2000, helb: 1500, mpesa: "0722333444" },
    { name: "Grace Akinyi", idNo: "34567890", dept: "Cashier", role: "Sales", basic: 22000, house: 2000, transport: 1000, helb: 0, mpesa: "0733555666" },
    { name: "Peter Kimani", idNo: "45678901", dept: "Management", role: "Store Manager", basic: 65000, house: 15000, transport: 8000, helb: 5000, mpesa: "0744777888" },
  ].map((e) => ({ ...e, house: e.house, transport: e.transport }));

  for (const e of employees) {
    const emp = await db.employee.create({
      data: {
        name: e.name, idNo: e.idNo, dept: e.dept, role: e.role, basic: e.basic,
        houseAllowance: e.house, transport: e.transport, helb: e.helb, mpesaNumber: e.mpesa,
        bankAccount: `Equity ••${e.idNo.slice(-4)}`,
      },
    });
    await db.payslip.create({
      data: { employeeId: emp.id, period: "2026-09", basic: e.basic, houseAllowance: e.house, transport: e.transport, gross: 0, nssf: 0, shif: 0, housingLevy: 0, paye: 0, helb: e.helb, net: 0, status: "Draft" },
    });
  }

  // ─── Raven chat ──────────────────────────────────────────
  const channels = [
    { name: "general", description: "Company-wide announcements", members: 24 },
    { name: "thika-road", description: "Thika Road branch", members: 12 },
    { name: "kiambu-store", description: "Kiambu Road branch", members: 9 },
    { name: "managers-only", description: "Management discussions", members: 4 },
    { name: "stock-alerts", description: "Low stock & transfer alerts", members: 24, unread: 3 },
    { name: "deliveries", description: "Delivery coordination", members: 11 },
  ];
  const chan: Record<string, number> = {};
  for (const c of channels) {
    const created = await db.chatChannel.create({ data: c });
    chan[c.name] = created.id;
  }
  await db.chatMessage.createMany({
    data: [
      { channelId: chan["thika-road"], author: "Mary Wanjiku", initials: "MW", content: "Morning team! Cement stock low in Thika — 3 bags left. Need transfer from Kiambu.", createdAt: daysAgo(0, 7) },
      { channelId: chan["thika-road"], author: "James Otieno", initials: "JO", content: "On it. Transferring 20 bags now. ETA 45 mins.", createdAt: daysAgo(0, 6.7), docLink: JSON.stringify({ title: "Stock Transfer STK-0012", sub: "Cement ×20 • Kiambu → Thika • View", kind: "stock" }) },
      { channelId: chan["thika-road"], author: "Grace Akinyi", initials: "GA", content: "Customer John Kamau asking for credit extension. Debt KES 6k overdue 5 days. Block at POS?", createdAt: daysAgo(0, 6.4) },
    ],
  });
  await db.chatMessage.createMany({
    data: [
      { channelId: chan["stock-alerts"], author: "System Bot", initials: "SB", content: "⚠️ LOW STOCK: Bamburi Cement 50kg — 3 left at Thika Road (reorder point 20).", createdAt: daysAgo(0, 8) },
      { channelId: chan["stock-alerts"], author: "System Bot", initials: "SB", content: "⚠️ OUT OF STOCK: Hammer 16oz Stanley at Thika Road.", createdAt: daysAgo(0, 5) },
      { channelId: chan["stock-alerts"], author: "System Bot", initials: "SB", content: "⚠️ LOW STOCK: Dulux Vinyl Matt 20L — 4 left at Kiambu Road.", createdAt: daysAgo(0, 2) },
    ],
  });
  await db.chatMessage.create({
    data: { channelId: chan["general"], author: "Owner", initials: "OK", content: "Welcome to Raven — our in-house chat. Share ERP docs with / command. Karibuni!", createdAt: daysAgo(30) },
  });

  // ─── SMS logs ────────────────────────────────────────────
  await db.smsLog.createMany({
    data: [
      { customerId: john.id, phone: "0712345678", message: "Hi John Kamau, Receipt INV-2847, Total KES 12,944. Points earned 129. Balance 549 pts. Asante!", type: "Receipt", status: "Delivered", cost: 1, createdAt: daysAgo(0, 0.5) },
      { customerId: achieng.id, phone: "0745333444", message: "Happy Birthday Achieng! Here's 10% off anything today at DukaFlow. 💙", type: "Birthday", status: "Delivered", cost: 1, createdAt: daysAgo(1) },
      { customerId: chebet.id, phone: "0710111000", message: "Reminder: KES 12,000 due. Settle to keep shopping on credit.", type: "DebtReminder", status: "Delivered", cost: 1, createdAt: daysAgo(2) },
      { customerId: wanjiku.id, phone: "0722111222", message: "NEW: Dulux Vinyl Matt now in stock! Gold members 10% off.", type: "Promo", status: "Delivered", cost: 1, createdAt: daysAgo(3) },
    ],
  });

  // ─── Promo codes ─────────────────────────────────────────
  await db.promoCode.createMany({
    data: [
      { code: "GOLD10", type: "flat", value: 500, minSpend: 5000 },
      { code: "KARIBU5", type: "percent", value: 5, minSpend: 0 },
      { code: "CIMENT50", type: "flat", value: 50, minSpend: 1250 },
    ],
  });

  // ─── Settings singleton ──────────────────────────────────
  await db.settings.create({
    data: { kraLastSync: daysAgo(0, 0.05) },
  });

  const counts = {
    stores: await db.store.count(), products: await db.product.count(),
    customers: await db.customer.count(), sales: await db.sale.count(),
    deals: await db.pipelineDeal.count(), employees: await db.employee.count(),
    channels: await db.chatChannel.count(), giftCards: await db.giftCard.count(),
    debtPlans: await db.debtPlan.count(),
  };
  console.log("✅ Seed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
