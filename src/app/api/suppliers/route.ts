import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/* DukaFlow — Supplier directory (procurement masters).
 *
 * GET  /api/suppliers            → active suppliers (with PO counts)
 * POST /api/suppliers { name, phone?, email?, kraPin?, category?, leadDays? }
 */

export async function GET() {
  const suppliers = await db.supplier.findMany({
    where: { active: true },
    include: { _count: { select: { purchaseOrders: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(
    suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      email: s.email,
      kraPin: s.kraPin,
      category: s.category,
      leadDays: s.leadDays,
      poCount: s._count.purchaseOrders,
    }))
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      name: string;
      phone?: string;
      email?: string;
      kraPin?: string;
      category?: string;
      leadDays?: number;
    };
    if (!body.name?.trim()) {
      return NextResponse.json({ ok: false, error: "Supplier name is required" }, { status: 400 });
    }
    const supplier = await db.supplier.create({
      data: {
        name: body.name.trim(),
        phone: body.phone ?? "",
        email: body.email ?? "",
        kraPin: body.kraPin ?? "",
        category: body.category ?? "General",
        leadDays: body.leadDays ?? 3,
      },
    });
    return NextResponse.json({ ok: true, supplier });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not create supplier" },
      { status: 500 }
    );
  }
}
