import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/bootstrap - everything the app shell needs at startup. */
export async function GET() {
  const [stores, staff, settings] = await Promise.all([
    db.store.findMany({ orderBy: { id: "asc" } }),
    db.staff.findMany({ orderBy: { id: "asc" } }),
    db.settings.findUnique({ where: { id: 1 } }),
  ]);

  const categories = [
    "All",
    ...Array.from(new Set((await db.product.findMany({ select: { category: true } })).map((p) => p.category))),
  ];

  return NextResponse.json({
    stores,
    staff: staff.map((s) => ({
      id: s.id, name: s.name, role: s.role, color: s.color, onShift: s.onShift, storeId: s.storeId,
    })),
    settings,
    categories,
  });
}
