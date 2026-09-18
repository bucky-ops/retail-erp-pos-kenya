import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUSES = ["Active", "On Leave", "Suspended", "Exited"];

/** GET /api/staff/[id] - full employee 360°:
 *   • employee joined with store,
 *   • payslips (newest period first),
 *   • last 30 attendance days (newest first),
 *   • salary advances (newest first).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const employeeId = Number(id);
  if (!Number.isFinite(employeeId)) {
    return NextResponse.json({ ok: false, error: "Bad employee id" }, { status: 400 });
  }

  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: { store: { select: { name: true } } },
  });
  if (!employee) return NextResponse.json({ ok: false, error: "Employee not found" }, { status: 404 });

  const [payslips, attendances, advances] = await Promise.all([
    db.payslip.findMany({
      where: { employeeId },
      orderBy: [{ period: "desc" }, { createdAt: "desc" }],
      take: 24,
    }),
    db.attendance.findMany({
      where: { employeeId },
      orderBy: { date: "desc" },
      take: 30,
    }),
    db.staffAdvance.findMany({ where: { employeeId }, orderBy: { takenAt: "desc" } }),
  ]);

  return NextResponse.json({
    employee: {
      id: employee.id,
      staffNo: employee.staffNo,
      name: employee.name,
      idNo: employee.idNo,
      kraPin: employee.kraPin,
      nssfNo: employee.nssfNo,
      shifNo: employee.shifNo,
      housingNo: employee.housingNo,
      dept: employee.dept,
      role: employee.role,
      storeId: employee.storeId,
      storeName: employee.store?.name ?? null,
      basic: employee.basic,
      houseAllowance: employee.houseAllowance,
      transport: employee.transport,
      helb: employee.helb,
      bankAccount: employee.bankAccount,
      mpesaNumber: employee.mpesaNumber,
      emergencyName: employee.emergencyName,
      emergencyPhone: employee.emergencyPhone,
      leaveAnnual: employee.leaveAnnual,
      leaveAnnualUsed: employee.leaveAnnualUsed,
      leaveSick: employee.leaveSick,
      leaveSickUsed: employee.leaveSickUsed,
      attendancePct: employee.attendancePct,
      status: employee.status,
      active: employee.active,
      joinedAt: employee.joinedAt.toISOString(),
    },
    payslips: payslips.map((p) => ({
      id: p.id,
      period: p.period,
      basic: p.basic,
      houseAllowance: p.houseAllowance,
      transport: p.transport,
      overtime: p.overtime,
      gross: p.gross,
      nssf: p.nssf,
      shif: p.shif,
      housingLevy: p.housingLevy,
      paye: p.paye,
      helb: p.helb,
      net: p.net,
      status: p.status,
    })),
    attendances: attendances.map((a) => ({
      id: a.id,
      date: a.date,
      status: a.status,
      checkIn: a.checkIn,
      checkOut: a.checkOut,
      overtimeHrs: a.overtimeHrs,
    })),
    advances: advances.map((a) => ({
      id: a.id,
      ref: a.ref,
      employeeId: a.employeeId,
      employeeName: employee.name,
      staffNo: employee.staffNo,
      principal: a.principal,
      installment: a.installment,
      outstanding: a.outstanding,
      reason: a.reason,
      takenAt: a.takenAt.toISOString(),
    })),
  });
}

/** PATCH /api/staff/[id] - update editable HR fields: statutory numbers, pay,
 *  salary channel, emergency contact, employment status and leave balances.
 *  Setting status to "Exited" also deactivates the employee (hidden from payroll).
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const employeeId = Number(id);
  if (!Number.isFinite(employeeId)) {
    return NextResponse.json({ ok: false, error: "Bad employee id" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const existing = await db.employee.findUnique({ where: { id: employeeId } });
  if (!existing) return NextResponse.json({ ok: false, error: "Employee not found" }, { status: 404 });

  const data: Record<string, string | number | boolean> = {};

  const strFields = [
    "name", "idNo", "kraPin", "nssfNo", "shifNo", "housingNo", "dept", "role",
    "bankAccount", "mpesaNumber", "emergencyName", "emergencyPhone",
  ] as const;
  for (const f of strFields) {
    if (body[f] !== undefined) data[f] = String(body[f]).trim();
  }

  const numFields = ["basic", "houseAllowance", "transport", "helb", "attendancePct"] as const;
  for (const f of numFields) {
    if (body[f] !== undefined) {
      const n = Number(body[f]);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ ok: false, error: `${f} must be a number` }, { status: 400 });
      }
      data[f] = n;
    }
  }

  const intFields = ["leaveAnnual", "leaveAnnualUsed", "leaveSick", "leaveSickUsed", "storeId"] as const;
  for (const f of intFields) {
    if (body[f] !== undefined && body[f] !== null && body[f] !== "") {
      const n = Number(body[f]);
      if (!Number.isInteger(n)) {
        return NextResponse.json({ ok: false, error: `${f} must be a whole number` }, { status: 400 });
      }
      data[f] = n;
    }
  }

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!STATUSES.includes(status)) {
      return NextResponse.json(
        { ok: false, error: `Status must be one of: ${STATUSES.join(", ")}` },
        { status: 400 }
      );
    }
    data.status = status;
    data.active = status !== "Exited";
  }

  if (data.basic !== undefined && Number(data.basic) <= 0) {
    return NextResponse.json({ ok: false, error: "Basic salary must be greater than 0" }, { status: 400 });
  }

  const employee = await db.employee.update({ where: { id: employeeId }, data });

  return NextResponse.json({
    ok: true,
    employee: { id: employee.id, staffNo: employee.staffNo, name: employee.name, status: employee.status },
  });
}
