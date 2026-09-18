/**
 * DukaFlow seed - Kenyan-realistic data for a hardware store ERP+POS.
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
  await db.staffAdvance.deleteMany();
  await db.attendance.deleteMany();
  await db.employee.deleteMany();
  await db.journalLine.deleteMany();
  await db.journalEntry.deleteMany();
  await db.account.deleteMany();
  await db.bankStatementLine.deleteMany();
  await db.dayClose.deleteMany();
  await db.supplierPrice.deleteMany();
  await db.purchaseOrderItem.deleteMany();
  await db.purchaseOrder.deleteMany();
  await db.stockTakeItem.deleteMany();
  await db.stockTake.deleteMany();
  await db.supplierReturnItem.deleteMany();
  await db.supplierReturn.deleteMany();
  await db.expense.deleteMany();
  await db.supplier.deleteMany();
  await db.debtPlan.deleteMany();
  await db.giftCard.deleteMany();
  await db.promoCode.deleteMany();
  await db.saleReturnItem.deleteMany();
  await db.salesReturn.deleteMany();
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

  // --- Stores ----------------------------------------------
  const thika = await db.store.create({
    data: { name: "Thika Road", location: "Nairobi", isMain: true },
  });
  const kiambu = await db.store.create({
    data: { name: "Kiambu Road", location: "Kiambu" },
  });

  // --- Staff (PIN login) -----------------------------------
  await db.staff.createMany({
    data: [
      { name: "Mary Wanjiku", role: "Cashier", pin: "1234", color: "#0052CC", onShift: true, storeId: thika.id },
      { name: "James Otieno", role: "Store Keeper", pin: "2345", color: "#00C853", onShift: true, storeId: thika.id },
      { name: "Grace Akinyi", role: "Sales", pin: "3456", color: "#FF5630", onShift: false, storeId: kiambu.id },
      { name: "Owner (OK)", role: "Owner", pin: "0000", color: "#172B4D", onShift: true, storeId: thika.id },
    ],
  });

  // --- Products --------------------------------------------
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

  // --- Customers -------------------------------------------
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

  // --- Sales history (incl. live feed rows) ----------------
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

  // Older sales (previous days) for trends - ~30 records
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
  // fix: hammer out-of-stock - replace with valve
  const gcardSale = await db.sale.findFirst({ where: { receiptNo: "INV-2843" } });
  if (gcardSale) {
    await db.saleItem.deleteMany({ where: { saleId: gcardSale.id } });
    await db.saleItem.createMany({
      data: [{ saleId: gcardSale.id, productId: products["PLB-041"].id, name: products["PLB-041"].name, emoji: products["PLB-041"].emoji, qty: 2, unitPrice: 420, total: 840 }],
    });
    await db.sale.update({ where: { id: gcardSale.id }, data: { subtotal: 840, vat: 134, total: 974 } });
  }
  await mkSale("INV-2842", thika.id, chebet.id, "James Otieno", [{ sku: "ELC-021", qty: 5 }], "Cash", 5, "Pending");

  // --- Pipeline deals --------------------------------------
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

  // --- Gift cards ------------------------------------------
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

  // --- Debt plans ------------------------------------------
  await db.debtPlan.createMany({
    data: [
      { customerId: john.id, invoiceNo: "INV-2847", totalDebt: 6000, installmentType: "Weekly", installmentAmount: 2000, nextDueDate: daysAhead(1), overdueDays: 5 },
      { customerId: otieno.id, invoiceNo: "INV-2810", totalDebt: 4500, installmentType: "Monthly", installmentAmount: 5000, nextDueDate: daysAhead(3), overdueDays: 0 },
      { customerId: chebet.id, invoiceNo: "INV-2799", totalDebt: 12000, installmentType: "Weekly", installmentAmount: 3000, nextDueDate: daysAhead(-4), overdueDays: 12 },
      { customerId: mutiso.id, invoiceNo: "INV-2750", totalDebt: 12000, installmentType: "Weekly", installmentAmount: 2500, nextDueDate: daysAhead(6), overdueDays: 0 },
      { customerId: thikaB.id, invoiceNo: "INV-2701", totalDebt: 25000, installmentType: "Monthly", installmentAmount: 10000, nextDueDate: daysAhead(2), overdueDays: 0 },
    ],
  });

  // --- Employees (HRMS) & payslips -------------------------
  const employees = [
    { name: "Mary Wanjiku", idNo: "12345678", dept: "Sales", role: "Cashier", basic: 30000, house: 5000, transport: 3000, helb: 0, mpesa: "0712345678", status: "Active", storeId: thika.id, joined: daysAgo(760), annualUsed: 10, sickUsed: 1, att: 98, late: 2 },
    { name: "James Otieno", idNo: "23456789", dept: "Store", role: "Store Keeper", basic: 25000, house: 3000, transport: 2000, helb: 1500, mpesa: "0722333444", status: "Active", storeId: thika.id, joined: daysAgo(620), annualUsed: 12, sickUsed: 2, att: 95, late: 4 },
    { name: "Grace Akinyi", idNo: "34567890", dept: "Cashier", role: "Sales", basic: 22000, house: 2000, transport: 1000, helb: 0, mpesa: "0733555666", status: "Active", storeId: kiambu.id, joined: daysAgo(540), annualUsed: 8, sickUsed: 0, att: 97, late: 1 },
    { name: "Peter Kimani", idNo: "45678901", dept: "Management", role: "Store Manager", basic: 65000, house: 15000, transport: 8000, helb: 5000, mpesa: "0744777888", status: "Active", storeId: thika.id, joined: daysAgo(1100), annualUsed: 6, sickUsed: 0, att: 99, late: 0 },
    { name: "Faith Njeri", idNo: "56789012", dept: "Sales", role: "Senior Cashier", basic: 35000, house: 6000, transport: 3000, helb: 0, mpesa: "0755111222", status: "On Leave", storeId: thika.id, joined: daysAgo(900), annualUsed: 15, sickUsed: 3, att: 94, late: 3 },
    { name: "Samuel Mwangi", idNo: "67890123", dept: "Store", role: "Loader", basic: 18000, house: 1500, transport: 1000, helb: 1000, mpesa: "0766222333", status: "Active", storeId: thika.id, joined: daysAgo(410), annualUsed: 4, sickUsed: 1, att: 92, late: 5 },
    { name: "Esther Kilonzo", idNo: "78901234", dept: "Accounts", role: "Accountant", basic: 55000, house: 12000, transport: 6000, helb: 3000, mpesa: "0777333444", status: "Active", storeId: thika.id, joined: daysAgo(980), annualUsed: 7, sickUsed: 0, att: 98, late: 1 },
    { name: "Brian Ochieng", idNo: "89012345", dept: "Sales", role: "Sales Rep", basic: 28000, house: 4000, transport: 3500, helb: 1500, mpesa: "0788444555", status: "Active", storeId: kiambu.id, joined: daysAgo(300), annualUsed: 5, sickUsed: 2, att: 96, late: 2 },
    { name: "Lucy Wambui", idNo: "90123456", dept: "Store", role: "Store Keeper", basic: 24000, house: 3000, transport: 2000, helb: 0, mpesa: "0799555666", status: "Active", storeId: kiambu.id, joined: daysAgo(350), annualUsed: 9, sickUsed: 1, att: 93, late: 4 },
    { name: "Dennis Mutua", idNo: "11223344", dept: "IT", role: "Systems Admin", basic: 60000, house: 14000, transport: 7000, helb: 4000, mpesa: "0700666777", status: "Active", storeId: thika.id, joined: daysAgo(500), annualUsed: 8, sickUsed: 0, att: 97, late: 1 },
    { name: "Alice Chepkemoi", idNo: "22334455", dept: "Sales", role: "Cashier", basic: 26000, house: 3500, transport: 2500, helb: 0, mpesa: "0711777888", status: "Active", storeId: kiambu.id, joined: daysAgo(280), annualUsed: 3, sickUsed: 0, att: 95, late: 2 },
    { name: "Victor Omondi", idNo: "33445566", dept: "Security", role: "Guard", basic: 16000, house: 1000, transport: 800, helb: 0, mpesa: "0722888999", status: "Active", storeId: thika.id, joined: daysAgo(720), annualUsed: 6, sickUsed: 2, att: 99, late: 0 },
  ];

  for (let i = 0; i < employees.length; i++) {
    const e = employees[i];
    const emp = await db.employee.create({
      data: {
        staffNo: `DF-${String(i + 1).padStart(3, "0")}`,
        name: e.name, idNo: e.idNo, dept: e.dept, role: e.role, basic: e.basic,
        houseAllowance: e.house, transport: e.transport, helb: e.helb,
        mpesaNumber: e.mpesa, bankAccount: `Equity ••${e.idNo.slice(-4)}`,
        kraPin: `A00${e.idNo.slice(0, 5)}Z`, nssfNo: `NSSF${e.idNo.slice(0, 6)}`,
        shifNo: `SHIF${e.idNo.slice(0, 6)}`, housingNo: `HL${e.idNo.slice(0, 6)}`,
        emergencyName: e.name.split(" ")[1] ? `${e.name.split(" ")[0]} Kin` : "Next of Kin",
        emergencyPhone: `07${e.idNo.slice(2, 4)}999${e.idNo.slice(0, 2)}`,
        leaveAnnual: 21, leaveAnnualUsed: e.annualUsed, leaveSick: 7, leaveSickUsed: e.sickUsed,
        attendancePct: e.att, status: e.status, storeId: e.storeId, joinedAt: e.joined,
      },
    });
    // current + previous payslip
    for (const period of ["2026-08", "2026-09"]) {
      await db.payslip.create({
        data: { employeeId: emp.id, period, basic: e.basic, houseAllowance: e.house, transport: e.transport, gross: 0, nssf: 0, shif: 0, housingLevy: 0, paye: 0, helb: e.helb, net: 0, status: period === "2026-09" ? "Draft" : "Paid" },
      });
    }
    // attendance register: last 7 days
    for (let d = 0; d < 7; d++) {
      const day = new Date(now.getTime() - d * 864e5);
      const isSunday = day.getDay() === 0;
      const onLeave = e.status === "On Leave" && d < 3;
      const late = d === e.late % 7 && !onLeave;
      const status = isSunday ? "OFF" : onLeave ? "Leave" : late ? "Late" : d === 5 && e.role === "Loader" ? "Absent" : "Present";
      await db.attendance.create({
        data: {
          employeeId: emp.id, date: day.toISOString().slice(0, 10), status,
          checkIn: status === "Present" ? "07:5" + (5 + (i % 4)) : status === "Late" ? "08:03" : null,
          checkOut: status === "Present" || status === "Late" ? "17:1" + (i % 6) : null,
          overtimeHrs: d === 4 && e.role !== "Guard" ? 2 : 0,
        },
      });
    }
  }
  // advances: 3 staff owe
  for (const [idx, amt] of [[1, 15000], [5, 8000], [8, 20000]] as const) {
    const emp = await db.employee.findFirst({ where: { staffNo: `DF-${String(idx + 1).padStart(3, "0")}` } });
    if (emp) {
      await db.staffAdvance.create({
        data: { employeeId: emp.id, ref: `ADV-${String(idx).padStart(3, "0")}`, principal: amt, installment: Math.round(amt / 6), outstanding: Math.round(amt * 0.6), reason: "School fees", takenAt: daysAgo(70) },
      });
    }
  }

  // --- Day closing: 2 closed days + today open -------------
  const mkDayClose = async (date: Date, sales: number, receipts: number, cash: number, mpesa: number, cashCounted: number, mpesaCounted: number, closed: boolean) => {
    const d = date.toISOString().slice(0, 10).replace(/-/g, "");
    const variance = closed ? cashCounted + mpesaCounted - cash - mpesa : 0;
    await db.dayClose.create({
      data: {
        zNo: `Z-${d}-THIKA`, storeId: thika.id, businessDate: date.toISOString().slice(0, 10),
        status: closed ? "Closed" : "Open", salesTotal: sales, receipts,
        cashSystem: cash, cashCounted: closed ? cashCounted : null,
        mpesaSystem: mpesa, mpesaCounted: closed ? mpesaCounted : null,
        cardSystem: Math.round(sales * 0.04), variance,
        approvedBy: closed ? "Peter Kimani (Owner)" : "",
        staffOnDuty: "Mary Wanjiku, James Otieno, Samuel Mwangi, Victor Omondi",
        openingCash: 15000, closingCash: closed ? cashCounted : null,
        openedAt: date, closedAt: closed ? new Date(date.getTime() + 20 * 36e5) : null,
      },
    });
  };
  await mkDayClose(daysAgo(2), 118300, 42, 47200, 52800, 47000, 52800, true);
  await mkDayClose(daysAgo(1), 131050, 48, 52400, 58700, 52800, 58700, true);
  const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  await mkDayClose(todayNoon, 96400, 35, 38600, 43100, 0, 0, false);

  // --- Accounting: chart of accounts + journals + bank stmt -
  const coa: { code: string; name: string; type: string; parent?: string; isGroup?: boolean }[] = [
    { code: "1000", name: "ASSETS", type: "Asset", isGroup: true },
    { code: "1010", name: "Cash - Thika Road", type: "Asset", parent: "1000" },
    { code: "1020", name: "Cash - Kiambu Road", type: "Asset", parent: "1000" },
    { code: "1030", name: "M-Pesa Till 123456", type: "Asset", parent: "1000" },
    { code: "1100", name: "Bank - Equity Current", type: "Asset", parent: "1000" },
    { code: "1200", name: "Inventory", type: "Asset", parent: "1000" },
    { code: "1300", name: "Debtors (Receivables)", type: "Asset", parent: "1000" },
    { code: "1400", name: "VAT Input (Recoverable)", type: "Asset", parent: "1000" },
    { code: "2000", name: "LIABILITIES", type: "Liability", isGroup: true },
    { code: "2100", name: "Creditors (Suppliers)", type: "Liability", parent: "2000" },
    { code: "2200", name: "VAT Output (Payable)", type: "Liability", parent: "2000" },
    { code: "2300", name: "PAYE / NSSF / SHIF Payable", type: "Liability", parent: "2000" },
    { code: "2400", name: "Customer Deposits", type: "Liability", parent: "2000" },
    { code: "3000", name: "EQUITY", type: "Equity", isGroup: true },
    { code: "3100", name: "Owner Capital", type: "Equity", parent: "3000" },
    { code: "3200", name: "Retained Earnings", type: "Equity", parent: "3000" },
    { code: "4000", name: "REVENUE", type: "Revenue", isGroup: true },
    { code: "4100", name: "Sales - Hardware", type: "Revenue", parent: "4000" },
    { code: "4200", name: "Sales - Cement & Building", type: "Revenue", parent: "4000" },
    { code: "4300", name: "Other Income", type: "Revenue", parent: "4000" },
    { code: "5000", name: "COST OF GOODS SOLD", type: "COGS", isGroup: true },
    { code: "5100", name: "Purchases", type: "COGS", parent: "5000" },
    { code: "5200", name: "Stock Adjustments", type: "COGS", parent: "5000" },
    { code: "6000", name: "EXPENSES", type: "Expense", isGroup: true },
    { code: "6100", name: "Salaries & Wages", type: "Expense", parent: "6000" },
    { code: "6200", name: "Rent", type: "Expense", parent: "6000" },
    { code: "6300", name: "Electricity & Water", type: "Expense", parent: "6000" },
    { code: "6400", name: "Transport & Fuel", type: "Expense", parent: "6000" },
    { code: "6500", name: "Licenses & eTIMS", type: "Expense", parent: "6000" },
  ];
  for (const a of coa) {
    await db.account.create({ data: { code: a.code, name: a.name, type: a.type, parent: a.parent ?? null, isGroup: a.isGroup ?? false } });
  }
  const acc = (code: string) => ({ account: { connect: { code } } });

  const mkJournal = async (jvNo: string, date: string, memo: string, source: string, refNo: string, lines: { code: string; debit?: number; credit?: number; memo?: string }[]) => {
    await db.journalEntry.create({
      data: {
        jvNo, date, memo, source, refNo, storeId: thika.id,
        lines: { create: lines.map((l) => ({ ...acc(l.code), debit: l.debit ?? 0, credit: l.credit ?? 0, memo: l.memo ?? "" })) },
      },
    });
  };

  // opening capital
  await mkJournal("JV-0001", daysAgo(30).toISOString().slice(0, 10), "Opening balances - owner injection", "Manual", "", [
    { code: "1010", debit: 850000 }, { code: "1030", debit: 320000 }, { code: "1100", debit: 1400000 },
    { code: "1200", debit: 2100000 }, { code: "3100", credit: 4670000 },
  ]);
  // two historical day-close journals (Sep 17 & 16)
  await mkJournal("JV-0002", daysAgo(2).toISOString().slice(0, 10), "Daily sales - Z-2026-0917-THIKA", "DayClose", "Z-2026-0917-THIKA", [
    { code: "1010", debit: 47200, memo: "Cash sales" }, { code: "1030", debit: 52800, memo: "M-Pesa sales" },
    { code: "1100", debit: 4732, memo: "Card settlements" }, { code: "2200", credit: 16868, memo: "VAT 16%" },
    { code: "4100", credit: 62000 }, { code: "4200", credit: 33864 },
    { code: "5100", debit: 78900, memo: "COGS" }, { code: "1200", credit: 78900 },
  ]);
  await mkJournal("JV-0003", daysAgo(1).toISOString().slice(0, 10), "Daily sales - Z-2026-0918-THIKA", "DayClose", "Z-2026-0918-THIKA", [
    { code: "1010", debit: 52400, memo: "Cash sales" }, { code: "1030", debit: 58700, memo: "M-Pesa sales" },
    { code: "2200", credit: 18210, memo: "VAT 16%" },
    { code: "4100", credit: 70000 }, { code: "4200", credit: 22890 },
    { code: "5100", debit: 87120, memo: "COGS" }, { code: "1200", credit: 87120 },
  ]);
  await mkJournal("JV-0004", daysAgo(1).toISOString().slice(0, 10), "Electricity bill - Kenya Power", "Manual", "KPLC-8891", [
    { code: "6300", debit: 18400 }, { code: "1010", credit: 18400 },
  ]);
  await mkJournal("JV-0005", daysAgo(5).toISOString().slice(0, 10), "Rent - Thika Road shop", "Manual", "RENT-SEP", [
    { code: "6200", debit: 120000 }, { code: "1100", credit: 120000 },
  ]);

  // cached account balances (debit-positive)
  const agg = await db.journalLine.groupBy({ by: ["accountId"], _sum: { debit: true, credit: true } });
  for (const g of agg) {
    const debit = g._sum.debit ?? 0, credit = g._sum.credit ?? 0;
    await db.account.update({ where: { id: g.accountId }, data: { balance: debit - credit } });
  }

  // --- Bank recon: M-Pesa till statement -------------------
  const stmt: { date: string; ref: string; description: string; amount: number; matched: boolean; matchRef?: string }[] = [
    { date: daysAgo(2).toISOString().slice(0, 10), ref: "SBE4721KL", description: "Customer payment INV-2891", amount: 52800, matched: true, matchRef: "JV-0002" },
    { date: daysAgo(2).toISOString().slice(0, 10), ref: "SBE4722KL", description: "Paybill transfer to Equity", amount: -30000, matched: true, matchRef: "JV-0002" },
    { date: daysAgo(1).toISOString().slice(0, 10), ref: "SBE4790KL", description: "Customer payment INV-2902", amount: 58700, matched: true, matchRef: "JV-0003" },
    { date: daysAgo(1).toISOString().slice(0, 10), ref: "SBE4791KL", description: "M-Pesa charges", amount: -220, matched: false },
    { date: now.toISOString().slice(0, 10), ref: "SBE4801KL", description: "Customer payment INV-2910", amount: 21400, matched: false },
    { date: now.toISOString().slice(0, 10), ref: "SBE4802KL", description: "Supplier Bamburi refund", amount: 4300, matched: false },
  ];
  for (const s of stmt) {
    await db.bankStatementLine.create({ data: { date: s.date, ref: s.ref, description: s.description, amount: s.amount, matched: s.matched, matchRef: s.matchRef ?? "" } });
  }

  // --- Raven chat ------------------------------------------
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
      { channelId: chan["thika-road"], author: "Mary Wanjiku", initials: "MW", content: "Morning team! Cement stock low in Thika - 3 bags left. Need transfer from Kiambu.", createdAt: daysAgo(0, 7) },
      { channelId: chan["thika-road"], author: "James Otieno", initials: "JO", content: "On it. Transferring 20 bags now. ETA 45 mins.", createdAt: daysAgo(0, 6.7), docLink: JSON.stringify({ title: "Stock Transfer STK-0012", sub: "Cement ×20 • Kiambu → Thika • View", kind: "stock" }) },
      { channelId: chan["thika-road"], author: "Grace Akinyi", initials: "GA", content: "Customer John Kamau asking for credit extension. Debt KES 6k overdue 5 days. Block at POS?", createdAt: daysAgo(0, 6.4) },
    ],
  });
  await db.chatMessage.createMany({
    data: [
      { channelId: chan["stock-alerts"], author: "System Bot", initials: "SB", content: "⚠️ LOW STOCK: Bamburi Cement 50kg - 3 left at Thika Road (reorder point 20).", createdAt: daysAgo(0, 8) },
      { channelId: chan["stock-alerts"], author: "System Bot", initials: "SB", content: "⚠️ OUT OF STOCK: Hammer 16oz Stanley at Thika Road.", createdAt: daysAgo(0, 5) },
      { channelId: chan["stock-alerts"], author: "System Bot", initials: "SB", content: "⚠️ LOW STOCK: Dulux Vinyl Matt 20L - 4 left at Kiambu Road.", createdAt: daysAgo(0, 2) },
    ],
  });
  await db.chatMessage.create({
    data: { channelId: chan["general"], author: "Owner", initials: "OK", content: "Welcome to Raven - our in-house chat. Share ERP docs with / command. Karibuni!", createdAt: daysAgo(30) },
  });

  // --- SMS logs --------------------------------------------
  await db.smsLog.createMany({
    data: [
      { customerId: john.id, phone: "0712345678", message: "Hi John Kamau, Receipt INV-2847, Total KES 12,944. Points earned 129. Balance 549 pts. Asante!", type: "Receipt", status: "Delivered", cost: 1, createdAt: daysAgo(0, 0.5) },
      { customerId: achieng.id, phone: "0745333444", message: "Happy Birthday Achieng! Here's 10% off anything today at DukaFlow. 💙", type: "Birthday", status: "Delivered", cost: 1, createdAt: daysAgo(1) },
      { customerId: chebet.id, phone: "0710111000", message: "Reminder: KES 12,000 due. Settle to keep shopping on credit.", type: "DebtReminder", status: "Delivered", cost: 1, createdAt: daysAgo(2) },
      { customerId: wanjiku.id, phone: "0722111222", message: "NEW: Dulux Vinyl Matt now in stock! Gold members 10% off.", type: "Promo", status: "Delivered", cost: 1, createdAt: daysAgo(3) },
    ],
  });

  // --- Promo codes -----------------------------------------
  await db.promoCode.createMany({
    data: [
      { code: "GOLD10", type: "flat", value: 500, minSpend: 5000 },
      { code: "KARIBU5", type: "percent", value: 5, minSpend: 0 },
      { code: "CIMENT50", type: "flat", value: 50, minSpend: 1250 },
    ],
  });

  // --- Settings singleton ----------------------------------
  await db.settings.create({
    data: { kraLastSync: daysAgo(0, 0.05) },
  });

  const counts = {
    stores: await db.store.count(), products: await db.product.count(),
    customers: await db.customer.count(), sales: await db.sale.count(),
    deals: await db.pipelineDeal.count(), employees: await db.employee.count(),
    attendances: await db.attendance.count(), dayCloses: await db.dayClose.count(),
    accounts: await db.account.count(), journals: await db.journalEntry.count(),
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
