import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/audit?limit=120 - full audit trail (who did what, when). */
export async function GET(req: NextRequest) {
  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 120), 500);
  const logs = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return NextResponse.json({ logs });
}
