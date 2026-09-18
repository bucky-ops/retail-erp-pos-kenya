// One-off: seed a small payment ledger for the demo debtors so the new
// printable statement has history to show. Safe to re-run (dedupes by plan+amount+day).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const plans = await db.debtPlan.findMany({ include: { customer: true } });
  let created = 0;
  for (const plan of plans) {
    const existing = await db.debtPayment.count({ where: { debtPlanId: plan.id } });
    if (existing > 0) continue;
    const methods = ["M-Pesa", "Cash", "Bank"];
    // 1-2 historical installments, spaced a week apart.
    const n = plan.totalDebt > 20000 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const amount = Math.min(plan.installmentAmount, plan.totalDebt);
      const at = new Date();
      at.setDate(at.getDate() - (i + 1) * 7);
      await db.debtPayment.create({
        data: {
          debtPlanId: plan.id,
          customerId: plan.customerId,
          amount,
          method: methods[i % methods.length],
          note: i === 0 ? "Installment received - thank you" : "Installment received",
          createdAt: at,
        },
      });
      created++;
    }
  }
  console.log(`seeded ${created} debt payments across ${plans.length} plans`);
}

main().finally(() => db.$disconnect());
