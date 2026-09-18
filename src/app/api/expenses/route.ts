import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/* DukaFlow - Operating expenses (petty cash, bills, rent...).
 *
 * GET  /api/expenses?storeId=&from=&to=
 *      → { expenses, summary: { total, today, month, byCategory } }
 * POST /api/expenses { storeId, category, amount, note?, paidVia?, refNo?, staffName? }
 */

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("storeId");
  const days = Number(searchParams.get("days") ?? 30);

  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const expenses = await db.expense.findMany({
    where: {
      ...(storeId && storeId !== "all" ? { storeId: Number(storeId) } : {}),
      spentAt: { gte: since },
    },
    include: { store: { select: { name: true } } },
    orderBy: { spentAt: "desc" },
    take: 200,
  });

  // ── Aggregates ─────────────────────────────────────────────────────────────
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const today = expenses.filter((e) => new Date(e.spentAt) >= startOfToday).reduce((s, e) => s + e.amount, 0);
  const month = expenses.filter((e) => new Date(e.spentAt) >= startOfMonth).reduce((s, e) => s + e.amount, 0);

  const catMap = new Map<string, number>();
  for (const e of expenses) catMap.set(e.category, (catMap.get(e.category) ?? 0) + e.amount);
  const byCategory = [...catMap.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  return NextResponse.json({
    expenses: expenses.map((e) => ({ ...e, storeName: e.store.name })),
    summary: { total, today, month, count: expenses.length, byCategory },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      storeId: number;
      category?: string;
      amount: number;
      note?: string;
      paidVia?: string;
      refNo?: string;
      staffName?: string;
    };

    if (!body.storeId || !body.amount || body.amount <= 0) {
      return NextResponse.json({ ok: false, error: "Store and a positive amount are required" }, { status: 400 });
    }

    const expense = await db.expense.create({
      data: {
        storeId: body.storeId,
        category: body.category ?? "Other",
        amount: body.amount,
        note: body.note ?? "",
        paidVia: body.paidVia ?? "Cash",
        refNo: body.refNo || null,
        staffName: body.staffName ?? "Owner",
      },
      include: { store: { select: { name: true } } },
    });

    return NextResponse.json({ ok: true, expense: { ...expense, storeName: expense.store.name } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not record expense" },
      { status: 500 }
    );
  }
}
