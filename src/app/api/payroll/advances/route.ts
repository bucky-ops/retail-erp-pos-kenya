import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET   /api/payroll/advances - all staff advances with derived status
 *                               (PENDING while outstanding > 0, REPAID once cleared).
 * POST  /api/payroll/advances - request a new advance
 *                               { employeeId, amount, installment?, reason? }
 * PATCH /api/payroll/advances - { id, action: "repaid" } -> clear the balance.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET() {
  const advances = await db.staffAdvance.findMany({
    orderBy: [{ takenAt: "desc" }, { id: "desc" }],
    include: { employee: { select: { name: true, staffNo: true, dept: true } } },
  });

  const rows = advances.map((a) => ({
    id: a.id,
    ref: a.ref,
    employeeId: a.employeeId,
    employeeName: a.employee.name,
    staffNo: a.employee.staffNo,
    dept: a.employee.dept,
    principal: r2(a.principal),
    installment: r2(a.installment),
    outstanding: r2(a.outstanding),
    reason: a.reason,
    status: a.outstanding <= 0.009 || a.clearedAt ? "REPAID" : "PENDING",
    takenAt: a.takenAt.toISOString(),
    clearedAt: a.clearedAt ? a.clearedAt.toISOString() : null,
  }));

  const summary = {
    count: rows.length,
    pending: rows.filter((r) => r.status === "PENDING").length,
    outstanding: r2(rows.reduce((s, r) => s + r.outstanding, 0)),
    repaidValue: r2(rows.filter((r) => r.status === "REPAID").reduce((s, r) => s + r.principal, 0)),
  };

  return NextResponse.json({ rows, summary });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      employeeId?: number;
      amount?: number;
      installment?: number;
      reason?: string;
    };

    const employeeId = Number(body.employeeId);
    const amount = r2(Number(body.amount));
    const installment = r2(Number(body.installment ?? 0));

    if (!employeeId) return NextResponse.json({ ok: false, error: "Select an employee" }, { status: 400 });
    if (!Number.isFinite(amount) || amount <= 0)
      return NextResponse.json({ ok: false, error: "Advance amount must be greater than 0" }, { status: 400 });
    if (installment < 0 || !Number.isFinite(installment))
      return NextResponse.json({ ok: false, error: "Installment must be 0 or more" }, { status: 400 });

    const employee = await db.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return NextResponse.json({ ok: false, error: "Employee not found" }, { status: 404 });

    // next ADV ref
    const existing = await db.staffAdvance.findMany({ select: { ref: true } });
    const maxNo = existing.reduce((m, a) => {
      const match = /^ADV-(\d+)$/.exec(a.ref);
      return match ? Math.max(m, Number(match[1])) : m;
    }, 0);

    const advance = await db.staffAdvance.create({
      data: {
        employeeId,
        ref: `ADV-${String(maxNo + 1).padStart(3, "0")}`,
        principal: amount,
        installment: installment || Math.ceil(amount / 3 / 100) * 100, // default: recover over ~3 months
        outstanding: amount,
        reason: (body.reason ?? "").slice(0, 200),
      },
    });

    return NextResponse.json({
      ok: true,
      advance: { id: advance.id, ref: advance.ref, principal: advance.principal },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not create advance" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as { id?: number; action?: string };
    const id = Number(body.id);
    if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    if (body.action !== "repaid")
      return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });

    const advance = await db.staffAdvance.update({
      where: { id },
      data: { outstanding: 0, clearedAt: new Date() },
    });
    return NextResponse.json({ ok: true, ref: advance.ref, status: "REPAID" });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not update advance" },
      { status: 500 }
    );
  }
}
