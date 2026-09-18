import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/customers?q=&tier=&hasDebt= - searchable customer list. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const tier = searchParams.get("tier");
  const hasDebt = searchParams.get("hasDebt");

  const customers = await db.customer.findMany({
    where: {
      ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }] } : {}),
      ...(tier ? { tier } : {}),
      ...(hasDebt === "1" ? { debtBalance: { gt: 0 } } : {}),
    },
    orderBy: { totalSpent: "desc" },
    take: 100,
  });

  return NextResponse.json(customers);
}

/** POST /api/customers - walk-in signup at POS. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name || !body.phone) {
    return NextResponse.json({ ok: false, error: "Name and phone required" }, { status: 400 });
  }
  const existing = await db.customer.findUnique({ where: { phone: body.phone } });
  if (existing) return NextResponse.json(existing);

  const customer = await db.customer.create({
    data: {
      name: body.name,
      phone: body.phone,
      email: body.email ?? null,
      tier: "Bronze",
      creditLimit: body.creditLimit ?? 0,
      storeId: body.storeId ?? null,
    },
  });
  return NextResponse.json(customer);
}
