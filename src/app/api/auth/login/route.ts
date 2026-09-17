import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** POST /api/auth/login — staff PIN or owner login. */
export async function POST(req: NextRequest) {
  const { pin, role } = await req.json();

  if (!pin || String(pin).length !== 4) {
    return NextResponse.json({ ok: false, error: "Enter your 4-digit PIN" }, { status: 400 });
  }

  const staff = await db.staff.findFirst({
    where: role === "owner" ? { pin: String(pin), role: "Owner" } : { pin: String(pin) },
    include: { store: true },
  });

  if (!staff) {
    return NextResponse.json({ ok: false, error: "Invalid PIN. Try 1234 (cashier) or 0000 (owner)." }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    user: { id: staff.id, name: staff.name, role: staff.role, color: staff.color, storeId: staff.storeId, storeName: staff.store?.name },
  });
}
