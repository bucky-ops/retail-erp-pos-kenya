import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DealDto } from "@/types";
import { createDigitalReceipt, logAudit } from "@/lib/supermarket-server";
import { docNumber, kes, fmtDate } from "@/lib/receipt";

export const dynamic = "force-dynamic";

const toDto = (d: {
  id: string; stage: string; customerName: string; customerPhone: string | null;
  title: string; amount: number; itemCount: number; assignee: string; notes: string | null;
  history: string; docsJson: string; createdAt: Date;
}): DealDto => ({
  ...d,
  history: JSON.parse(d.history || "[]"),
  docs: JSON.parse(d.docsJson || "{}"),
  createdAt: d.createdAt.toISOString(),
});

const STAGE_LABEL: Record<string, string> = {
  quotation: "Quotation Created",
  proforma: "Proforma Sent",
  order: "Sales Order Confirmed",
  invoiced: "Invoiced",
  paid: "Paid",
};

interface ChainDoc {
  no: string;
  digitalCode: string;
  url: string;
  kind: string;
  at: string;
}

/** Doc numbers are independent sequences per document family. */
async function nextDocNo(prefix: string, table: "journalEntry" | "purchaseOrder" | "sale" | "dayClose", field: string): Promise<string> {
  void table; void field;
  const rows = await db.pipelineDeal.findMany({ select: { docsJson: true } });
  let max = 0;
  for (const r of rows) {
    const docs = JSON.parse(r.docsJson || "{}") as Record<string, ChainDoc | undefined>;
    for (const d of Object.values(docs)) {
      if (!d?.no.startsWith(prefix)) continue;
      const m = /(\d+)$/.exec(d.no);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return docNumber(prefix, max + 1);
}

/** Build + persist the digital twin for one chain document. */
async function makeChainDoc(
  kind: string,
  prefix: string,
  deal: { id: string; customerName: string; customerPhone: string | null; title: string; amount: number; itemCount: number },
  stage: string,
  settings: { companyName: string; kraPin: string; companyAddress: string; companyPhone: string; tillNo: string } | null,
): Promise<ChainDoc> {
  const no = await nextDocNo(prefix, "sale", "receiptNo");
  const doc = await createDigitalReceipt(
    kind,
    {
      dealId: deal.id,
      title: deal.title,
      customerName: deal.customerName,
      customerPhone: deal.customerPhone,
      amount: deal.amount,
      itemCount: deal.itemCount,
      stage,
      lines: [{ no: 1, name: deal.title || "Goods", qty: deal.itemCount || 1, unit: "pc", unitPrice: deal.amount / Math.max(1, deal.itemCount || 1), discount: 0, total: deal.amount }],
      grandTotal: kes(deal.amount),
    },
    { refNo: no },
  );
  void settings;
  return { no, digitalCode: doc.receiptCode, url: doc.url, kind, at: new Date().toISOString() };
}

/** PATCH /api/pipeline/[id] - move stage, one-click mature, or full chain. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    action?: "mature" | "matureAll";
    to?: string;
    stage?: string;
    by?: string;
    amount?: number;
    notes?: string;
    title?: string;
  };
  const existing = await db.pipelineDeal.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });

  const history = JSON.parse(existing.history || "[]") as { stage: string; at: string; by: string }[];
  const docs = JSON.parse(existing.docsJson || "{}") as Record<string, ChainDoc>;
  const settings = await db.settings.findUnique({ where: { id: 1 } });

  // -- MASTER BUTTON: mature the whole chain at once -----------------------
  if (body.action === "matureAll") {
    const CHAIN: { stage: string; kind: string; prefix: string; label: string }[] = [
      { stage: "quotation", kind: "QUOTATION", prefix: "QT", label: "Quotation" },
      { stage: "proforma", kind: "PROFORMA", prefix: "PF", label: "Proforma" },
      { stage: "order", kind: "ORDER", prefix: "SO", label: "Sales Order" },
      { stage: "invoiced", kind: "INVOICE", prefix: "INV", label: "Invoice" },
      { stage: "paid", kind: "PAYMENT", prefix: "PAY", label: "Payment" },
    ];
    for (const step of CHAIN) {
      if (!docs[step.stage]) {
        docs[step.stage] = await makeChainDoc(step.kind, step.prefix, existing, step.label, settings);
        history.push({ stage: STAGE_LABEL[step.stage], at: new Date().toISOString(), by: body.by ?? "Owner" });
      }
    }
    // The invoice step also creates the real Sale (money document).
    const count = await db.sale.count();
    const sale = await db.sale.create({
      data: {
        receiptNo: `INV-${2849 + count}`, storeId: 1, staffName: "Sales Pipeline",
        subtotal: existing.amount, discount: 0, vat: 0, total: existing.amount,
        paymentMethod: "Credit Sale", status: "Completed", kraStatus: "Pending",
      },
    });
    await db.pipelineDeal.update({
      where: { id },
      data: { stage: "paid", docsJson: JSON.stringify(docs), history: JSON.stringify(history) },
    });
    await logAudit({
      actor: body.by ?? "Owner",
      action: "MATURE",
      entity: "PipelineDeal",
      entityId: id,
      label: existing.title || existing.customerName,
      details: JSON.stringify({ chain: Object.keys(docs), saleId: sale.id }),
    });
    const deal = await db.pipelineDeal.findUnique({ where: { id } });
    return NextResponse.json({ ok: true, docs, deal: deal ? toDto(deal) : null });
  }

  // -- ONE CLICK: mature to the next (or given) stage ----------------------
  if (body.action === "mature" && body.to) {
    const CHAIN: Record<string, { kind: string; prefix: string; label: string }> = {
      quotation: { kind: "QUOTATION", prefix: "QT", label: "Quotation" },
      proforma: { kind: "PROFORMA", prefix: "PF", label: "Proforma" },
      order: { kind: "ORDER", prefix: "SO", label: "Sales Order" },
      invoiced: { kind: "INVOICE", prefix: "INV", label: "Invoice" },
      paid: { kind: "PAYMENT", prefix: "PAY", label: "Payment" },
    };
    const target = CHAIN[body.to];
    if (!target) return NextResponse.json({ ok: false, error: `Unknown stage ${body.to}` }, { status: 400 });
    if (!docs[body.to]) {
      docs[body.to] = await makeChainDoc(target.kind, target.prefix, existing, target.label, settings);
      history.push({ stage: STAGE_LABEL[body.to] ?? body.to, at: new Date().toISOString(), by: body.by ?? "Owner" });
      if (body.to === "invoiced") {
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
    await db.pipelineDeal.update({
      where: { id },
      data: { stage: body.to, docsJson: JSON.stringify(docs), history: JSON.stringify(history) },
    });
    await logAudit({
      actor: body.by ?? "Owner",
      action: "MATURE",
      entity: "PipelineDeal",
      entityId: id,
      label: existing.title || existing.customerName,
      details: body.to,
    });
    const deal = await db.pipelineDeal.findUnique({ where: { id } });
    return NextResponse.json({ ok: true, docs, deal: deal ? toDto(deal) : null });
  }

  // -- Plain stage move / edit (legacy kanban drag) ------------------------
  if (body.stage && body.stage !== existing.stage) {
    history.push({ stage: STAGE_LABEL[body.stage] ?? body.stage, at: new Date().toISOString(), by: body.by ?? "Owner" });
    if (body.stage === "invoiced" && !docs.invoiced) {
      docs.invoiced = await makeChainDoc("INVOICE", "INV", existing, "Invoice", settings);
    }
  }

  const deal = await db.pipelineDeal.update({
    where: { id },
    data: {
      ...(body.stage ? { stage: body.stage } : {}),
      ...(body.amount !== undefined ? { amount: Number(body.amount) } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      docsJson: JSON.stringify(docs),
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

void fmtDate;
