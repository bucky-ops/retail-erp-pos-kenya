import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DealDto } from "@/types";

export const dynamic = "force-dynamic";

const toDto = (d: {
  id: string; stage: string; customerName: string; customerPhone: string | null;
  title: string; amount: number; itemCount: number; assignee: string; notes: string | null;
  history: string; createdAt: Date;
}): DealDto => ({
  ...d,
  history: JSON.parse(d.history || "[]"),
  createdAt: d.createdAt.toISOString(),
});

const STAGE_LABEL: Record<string, string> = {
  quotation: "Quotation Created",
  proforma: "Proforma Sent",
  order: "Sales Order Confirmed",
  invoiced: "Invoiced",
  paid: "Paid",
};

/** GET /api/pipeline - all deals for the kanban. */
export async function GET() {
  const deals = await db.pipelineDeal.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(deals.map(toDto));
}

/** POST /api/pipeline - new quotation. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.customerName || !body.amount) {
    return NextResponse.json({ ok: false, error: "Customer and amount required" }, { status: 400 });
  }
  const deal = await db.pipelineDeal.create({
    data: {
      customerName: body.customerName,
      customerPhone: body.customerPhone ?? null,
      title: body.title ?? "New deal",
      amount: Number(body.amount),
      itemCount: Number(body.itemCount ?? 1),
      assignee: body.assignee ?? "M",
      notes: body.notes ?? null,
      history: JSON.stringify([{ stage: "Quotation Created", at: new Date().toISOString(), by: "Owner" }]),
    },
  });
  return NextResponse.json(toDto(deal));
}
