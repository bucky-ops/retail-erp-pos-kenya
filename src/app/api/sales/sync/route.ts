import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/sync — batch upload of offline POS sales from IndexedDB.
 * Returns per-clientId results so the queue can be cleared selectively.
 */
export async function POST(req: NextRequest) {
  const { sales } = await req.json();
  if (!Array.isArray(sales) || sales.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const results: { clientId: string; ok: boolean; receiptNo?: string; error?: string }[] = [];
  const origin = new URL(req.url).origin;

  for (const payload of sales) {
    try {
      // Re-use POST /api/sales logic internally via fetch to same server
      const res = await fetch(`${origin}/api/sales`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, offlineCreated: true }),
      });
      const data = await res.json();
      results.push({
        clientId: payload.clientId,
        ok: data.ok === true,
        receiptNo: data.sale?.receiptNo,
        error: data.error ?? data.blocked?.reason,
      });
    } catch (e) {
      results.push({ clientId: payload.clientId, ok: false, error: "Sync failed" });
    }
  }

  const synced = results.filter((r) => r.ok).length;
  return NextResponse.json({ results, synced, failed: results.length - synced });
}
