/**
 * One-off backfill: give every StockLevel a believable receivedAt date so the
 * Stock Aging report has a realistic distribution (most stock fresh, some stale).
 * Deterministic per (productId, storeId) so re-running yields the same ages.
 *
 * Run: bun run scripts/backfill-stock-age.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/** Small deterministic hash → 0..1 pseudo-random from a pair of ids. */
function unit(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

async function main() {
  const levels = await db.stockLevel.findMany({ include: { product: true } });
  let moved = 0;

  for (const lv of levels) {
    const r = unit(lv.productId * 7 + lv.storeId * 13);
    // Distribution: 55% fresh (0–30d), 22% (31–60d), 12% (61–90d), 11% stale (90–180d).
    const days =
      r < 0.55
        ? Math.floor(r * 55) // 0–30
        : r < 0.77
          ? 31 + Math.floor((r - 0.55) * 130) // 31–60
          : r < 0.89
            ? 61 + Math.floor((r - 0.77) * 240) // 61–90
            : 91 + Math.floor((r - 0.89) * 800); // 91–180

    // Zero-qty rows were "sold out" — treat as freshly restocked candidates.
    const finalDays = lv.qty <= 0 ? Math.floor(unit(lv.id) * 20) : days;
    const receivedAt = new Date(Date.now() - finalDays * 864e5);
    await db.stockLevel.update({ where: { id: lv.id }, data: { receivedAt } });
    moved++;
    console.log(`#${lv.id} ${lv.product.name.padEnd(28)} qty=${String(lv.qty).padStart(6)} → ${finalDays}d old`);
  }
  console.log(`\nBackfilled receivedAt on ${moved} stock rows.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
