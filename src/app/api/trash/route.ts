import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/supermarket-server";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * Soft delete for EVERY module (Naivas/ERPNext style):
 *  - Archive entities (catalog + people + money masters) keep their row, get
 *    archivedAt stamped and disappear from every list. Restore clears it. No
 *    foreign keys are ever violated, so linked history stays intact.
 *  - Workflow docs (PO, stock take, supplier return) are moved to Trash as a
 *    JSON snapshot; restore recreates them.
 * Every move is audit logged with who + why.
 */

const ARCHIVE: Record<string, string> = {
  Product: "product",
  Customer: "customer",
  Supplier: "supplier",
  Expense: "expense",
  GiftCard: "giftCard",
  PromoCode: "promoCode",
  Staff: "staff",
  Employee: "employee",
};

const HARD: Record<string, string> = {
  PurchaseOrder: "purchaseOrder",
  StockTake: "stockTake",
  SupplierReturn: "supplierReturn",
};

type AnyDelegate = {
  findUnique: (a: { where: { id: number } }) => Promise<unknown>;
  update: (a: { where: { id: number }; data: Record<string, unknown> }) => Promise<unknown>;
  delete: (a: { where: { id: number } }) => Promise<unknown>;
  create: (a: { data: Record<string, unknown> }) => Promise<unknown>;
};

const delegate = (name: string): AnyDelegate =>
  (db as unknown as Record<string, AnyDelegate>)[name];

function labelOf(entity: string, row: Record<string, unknown>): string {
  return String(row.name ?? row.title ?? row.code ?? row.jvNo ?? row.zNo ?? row.receiptNo ?? row.poNo ?? `${entity} #${row.id}`);
}

/** GET /api/trash - trash bin (latest first). */
export async function GET() {
  const items = await db.trashItem.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return NextResponse.json({ items });
}

/** POST /api/trash - soft delete: { entity, id, reason, deletedBy } */
export async function POST(req: NextRequest) {
  try {
    const { entity, id, reason, deletedBy } = (await req.json()) as {
      entity: string; id: number; reason: string; deletedBy: string;
    };
    if (!id || (!ARCHIVE[entity] && !HARD[entity])) {
      return NextResponse.json({ ok: false, error: `Unsupported entity ${entity}` }, { status: 400 });
    }
    const row = (await delegate(ARCHIVE[entity] ?? HARD[entity]).findUnique({ where: { id } })) as Record<string, unknown> | null;
    if (!row) return NextResponse.json({ ok: false, error: "Record not found" }, { status: 404 });
    const label = labelOf(entity, row);
    const auditData = {
      actor: deletedBy || "manager", action: "DELETE", entity,
      entityId: String(id), label, details: reason || "Moved to trash",
    };

    if (ARCHIVE[entity]) {
      await delegate(ARCHIVE[entity]).update({ where: { id }, data: { archivedAt: new Date() } });
      await db.trashItem.create({
        data: {
          entity, entityId: id, label, snapshot: JSON.stringify(row),
          reason: reason || "No reason given", deletedBy: deletedBy || "manager",
        },
      });
      await db.auditLog.create({ data: auditData });
    } else {
      try {
        await delegate(HARD[entity]).delete({ where: { id } });
        await db.trashItem.create({
          data: {
            entity, entityId: id, label, snapshot: JSON.stringify(row),
            reason: reason || "No reason given", deletedBy: deletedBy || "manager",
          },
        });
        await db.auditLog.create({ data: auditData });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("Foreign key") || msg.includes("foreign key")) {
          return NextResponse.json(
            { ok: false, error: `${entity} has linked documents and cannot be removed. Archive it instead or clear the linked records.` },
            { status: 409 },
          );
        }
        throw e;
      }
    }
    return NextResponse.json({ ok: true, trashed: { entity, id, label, reason: reason || "Moved to trash" } });
  } catch (err) {
    console.error("trash POST", err);
    return NextResponse.json({ ok: false, error: "Move to trash failed" }, { status: 500 });
  }
}

/** PUT /api/trash - restore: { trashId, restoredBy } */
export async function PUT(req: NextRequest) {
  try {
    const { trashId, restoredBy } = (await req.json()) as { trashId: number; restoredBy: string };
    const item = await db.trashItem.findUnique({ where: { id: trashId } });
    if (!item) return NextResponse.json({ ok: false, error: "Trash item not found" }, { status: 404 });
    if (item.status === "Restored") {
      return NextResponse.json({ ok: false, error: "Already restored" }, { status: 400 });
    }

    if (ARCHIVE[item.entity]) {
      await delegate(ARCHIVE[item.entity]).update({
        where: { id: item.entityId },
        data: { archivedAt: null },
      });
    } else if (HARD[item.entity]) {
      const snapshot = JSON.parse(item.snapshot) as Record<string, unknown>;
      delete snapshot.id;
      await delegate(HARD[item.entity]).create({ data: snapshot });
    }

    await db.trashItem.update({
      where: { id: trashId },
      data: { status: "Restored", restoredAt: new Date() },
    });
    await logAudit({
      actor: restoredBy || "manager",
      action: "RESTORE",
      entity: item.entity,
      entityId: item.entityId,
      label: item.label,
      details: item.reason,
    });
    return NextResponse.json({ ok: true, restored: { entity: item.entity, label: item.label } });
  } catch (err) {
    console.error("trash PUT", err);
    return NextResponse.json({ ok: false, error: "Restore failed" }, { status: 500 });
  }
}
