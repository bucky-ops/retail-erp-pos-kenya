import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** "2026-09-18" - matches the date granularity used by the Attendance model. */
const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const todayStr = () => dateStr(new Date());
const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** GET /api/staff - full HRMS directory feed:
 *   • staff: every employee joined with store name + trailing-30-day attendance counts,
 *   • summary: total / onShift (Present|Late on the latest register day) / onLeave /
 *     payrollPending (Draft payslips for the current period) + their net KES value,
 *   • advances: all staff advances joined with employee (for the Advances tab).
 */
export async function GET() {
  const period = currentPeriod();
  const since30 = dateStr(new Date(Date.now() - 30 * 864e5));

  const [employees, atts, advances, todayPresent, draftSlips] = await Promise.all([
    db.employee.findMany({ where: { archivedAt: null }, orderBy: { staffNo: "asc" }, include: { store: { select: { name: true } } } }),
    db.attendance.findMany({
      where: { date: { gte: since30 } },
      select: { employeeId: true, status: true },
    }),
    db.staffAdvance.findMany({
      orderBy: { takenAt: "desc" },
      include: { employee: { select: { name: true, staffNo: true } } },
    }),
    db.attendance.findMany({
      where: { date: todayStr(), status: { in: ["Present", "Late"] } },
      select: { employeeId: true },
    }),
    db.payslip.findMany({ where: { period, status: "Draft" }, select: { net: true } }),
  ]);

  // onShift - if nobody clocked in today (e.g. weekend seed), fall back to the
  // most recent register day so the KPI never reads 0 on stale data.
  let onShiftIds = new Set(todayPresent.map((r) => r.employeeId));
  if (onShiftIds.size === 0) {
    const latest = await db.attendance.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
    if (latest) {
      const recs = await db.attendance.findMany({
        where: { date: latest.date, status: { in: ["Present", "Late"] } },
        select: { employeeId: true },
      });
      onShiftIds = new Set(recs.map((r) => r.employeeId));
    }
  }

  // trailing-30-day attendance breakdown per employee
  const attMap = new Map<number, { present: number; late: number; absent: number; leave: number; off: number }>();
  for (const a of atts) {
    const bucket = attMap.get(a.employeeId) ?? { present: 0, late: 0, absent: 0, leave: 0, off: 0 };
    if (a.status === "Present") bucket.present++;
    else if (a.status === "Late") bucket.late++;
    else if (a.status === "Absent") bucket.absent++;
    else if (a.status === "Leave") bucket.leave++;
    else bucket.off++;
    attMap.set(a.employeeId, bucket);
  }

  return NextResponse.json({
    staff: employees.map((e) => ({
      id: e.id,
      staffNo: e.staffNo,
      name: e.name,
      idNo: e.idNo,
      kraPin: e.kraPin,
      nssfNo: e.nssfNo,
      shifNo: e.shifNo,
      housingNo: e.housingNo,
      dept: e.dept,
      role: e.role,
      storeId: e.storeId,
      storeName: e.store?.name ?? null,
      basic: e.basic,
      houseAllowance: e.houseAllowance,
      transport: e.transport,
      helb: e.helb,
      bankAccount: e.bankAccount,
      mpesaNumber: e.mpesaNumber,
      emergencyName: e.emergencyName,
      emergencyPhone: e.emergencyPhone,
      leaveAnnual: e.leaveAnnual,
      leaveAnnualUsed: e.leaveAnnualUsed,
      leaveSick: e.leaveSick,
      leaveSickUsed: e.leaveSickUsed,
      attendancePct: e.attendancePct,
      status: e.status,
      active: e.active,
      joinedAt: e.joinedAt.toISOString(),
      att30: attMap.get(e.id) ?? { present: 0, late: 0, absent: 0, leave: 0, off: 0 },
    })),
    summary: {
      total: employees.length,
      onShift: onShiftIds.size,
      onLeave: employees.filter((e) => e.status === "On Leave").length,
      payrollPending: draftSlips.length,
      payrollPendingNet: draftSlips.reduce((a, p) => a + p.net, 0),
      period,
    },
    advances: advances.map((a) => ({
      id: a.id,
      ref: a.ref,
      employeeId: a.employeeId,
      employeeName: a.employee.name,
      staffNo: a.employee.staffNo,
      principal: a.principal,
      installment: a.installment,
      outstanding: a.outstanding,
      reason: a.reason,
      takenAt: a.takenAt.toISOString(),
    })),
  });
}

/** POST /api/staff - onboard an employee.
 *  Required: name, idNo, basic > 0. Auto-generates the next DF-xxx staff number
 *  and marks the newcomer Present on today's attendance register.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const idNo = String(body.idNo ?? "").trim();
  const basic = Number(body.basic);

  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "Employee name is required";
  if (!idNo) fieldErrors.idNo = "National ID number is required";
  if (!Number.isFinite(basic) || basic <= 0) fieldErrors.basic = "Basic salary must be greater than 0";
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ ok: false, error: "Validation failed", fieldErrors }, { status: 400 });
  }

  // next staff number: highest existing DF-xxx + 1
  const existing = await db.employee.findMany({ select: { staffNo: true } });
  const maxNo = existing.reduce((m, e) => {
    const match = /^DF-(\d+)$/.exec(e.staffNo);
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  const staffNo = `DF-${String(maxNo + 1).padStart(3, "0")}`;

  const num = (v: unknown, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const employee = await db.employee.create({
    data: {
      staffNo,
      name,
      idNo,
      kraPin: String(body.kraPin ?? "").trim(),
      nssfNo: String(body.nssfNo ?? "").trim(),
      shifNo: String(body.shifNo ?? "").trim(),
      housingNo: String(body.housingNo ?? "").trim(),
      dept: String(body.dept ?? "Sales").trim() || "Sales",
      role: String(body.role ?? "Staff").trim() || "Staff",
      storeId: body.storeId != null && body.storeId !== "" ? num(body.storeId) : null,
      basic,
      houseAllowance: num(body.houseAllowance),
      transport: num(body.transport),
      helb: num(body.helb),
      bankAccount: String(body.bankAccount ?? "").trim() || null,
      mpesaNumber: String(body.mpesaNumber ?? "").trim() || null,
      emergencyName: String(body.emergencyName ?? "").trim(),
      emergencyPhone: String(body.emergencyPhone ?? "").trim(),
    },
  });

  // auto-clock-in on today's register
  const now = new Date();
  await db.attendance.upsert({
    where: { employeeId_date: { employeeId: employee.id, date: todayStr() } },
    update: {},
    create: {
      employeeId: employee.id,
      date: todayStr(),
      status: "Present",
      checkIn: now.toTimeString().slice(0, 5),
    },
  });

  return NextResponse.json({ ok: true, employee: { id: employee.id, staffNo: employee.staffNo, name: employee.name } });
}
