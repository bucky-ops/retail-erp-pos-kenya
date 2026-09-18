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

/** PATCH /api/pipeline/[id] - move stage (one-click mature) or edit. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const existing = await db.pipelineDeal.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });

  const history = JSON.parse(existing.history || "[]") as { stage: string; at: string; by: string }[];
  if (body.stage && body.stage !== existing.stage) {
    history.push({ stage: STAGE_LABEL[body.stage] ?? body.stage, at: new Date().toISOString(), by: body.by ?? "Owner" });
    // When a deal reaches "invoiced", create the actual Sale record
    if (body.stage === "invoiced") {
      const count = await db.sale.count();
      await db.sale.create({
        data: {
          receiptNo: `INV-${2849 + count}`, storeId: 1, staffName: "Sales Pipeline",
          subtotal: existing.amount, discount: 0, vat: 0, total: existing.amount,
          paymentMethod: "Credit Sale", status: "Completed", kraStatus: "Pending",
        },
      });
    }
  }

  const deal = await db.pipelineDeal.update({
    where: { id },
    data: {
      ...(body.stage ? { stage: body.stage } : {}),
      ...(body.amount !== undefined ? { amount: Number(body.amount) } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      history: JSON.stringify(history),
    },
  });
  return NextResponse.json(toDto(deal));
}

/** DELETE /api/pipeline/[id] */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.pipelineDeal.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
