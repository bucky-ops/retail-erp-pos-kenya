import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/payroll/attendance - 7-day attendance register for the HRMS tab.
 *
 * Returns the last 7 calendar days (UTC day keys, matching how the register is
 * written) with one row per active employee: per-day status chips, counters,
 * a per-employee attendance rate and statutory leave balances.
 *
 * Rate: Present + Late over marked working days (Present + Late + Absent).
 * Leave and OFF days are not counted against the employee.
 */

const pad2 = (n: number) => String(n).padStart(2, "0");

/** UTC day key used across the attendance register ("2026-09-18"). */
const dayKey = (d: Date) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

export async function GET() {
  // Last 7 calendar days, oldest first.
  const now = new Date();
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) days.push(dayKey(new Date(now.getTime() - i * 864e5)));

  const [employees, records] = await Promise.all([
    db.employee.findMany({
      where: { active: true },
      orderBy: { staffNo: "asc" },
      select: {
        id: true,
        staffNo: true,
        name: true,
        dept: true,
        role: true,
        status: true,
        leaveAnnual: true,
        leaveAnnualUsed: true,
        leaveSick: true,
        leaveSickUsed: true,
      },
    }),
    db.attendance.findMany({
      where: { date: { in: days } },
      select: { employeeId: true, date: true, status: true, checkIn: true, checkOut: true },
    }),
  ]);

  // Group records by employee then day for O(1) lookup.
  const byEmp = new Map<number, Map<string, { status: string; checkIn: string | null; checkOut: string | null }>>();
  for (const r of records) {
    let m = byEmp.get(r.employeeId);
    if (!m) {
      m = new Map();
      byEmp.set(r.employeeId, m);
    }
    m.set(r.date, { status: r.status, checkIn: r.checkIn, checkOut: r.checkOut });
  }

  const totals = { present: 0, late: 0, absent: 0, leave: 0, off: 0, unmarked: 0 };
  let onLeaveToday = 0;
  const todayKey = days[days.length - 1];

  const rows = employees.map((e) => {
    const recs = byEmp.get(e.id);
    const perDay = days.map((d) => {
      const rec = recs?.get(d);
      return rec ? { status: rec.status, checkIn: rec.checkIn, checkOut: rec.checkOut } : null;
    });

    const counters = { present: 0, late: 0, absent: 0, leave: 0, off: 0 };
    for (const rec of perDay) {
      if (!rec) continue;
      if (rec.status === "Present") counters.present += 1;
      else if (rec.status === "Late") counters.late += 1;
      else if (rec.status === "Absent") counters.absent += 1;
      else if (rec.status === "Leave") counters.leave += 1;
      else if (rec.status === "OFF") counters.off += 1;
    }

    const worked = counters.present + counters.late + counters.absent;
    const attended = counters.present + counters.late;
    const rate = worked > 0 ? Math.round((attended / worked) * 100) : 100;

    if (recs?.get(todayKey)?.status === "Leave") onLeaveToday += 1;

    totals.present += counters.present;
    totals.late += counters.late;
    totals.absent += counters.absent;
    totals.leave += counters.leave;
    totals.off += counters.off;
    totals.unmarked += 7 - (counters.present + counters.late + counters.absent + counters.leave + counters.off);

    return {
      employeeId: e.id,
      staffNo: e.staffNo,
      name: e.name,
      dept: e.dept,
      role: e.role,
      status: e.status,
      perDay,
      counters,
      rate,
      leave: {
        annual: e.leaveAnnual,
        annualUsed: e.leaveAnnualUsed,
        sick: e.leaveSick,
        sickUsed: e.leaveSickUsed,
      },
    };
  });

  const markedWorking = totals.present + totals.late + totals.absent;
  const attendanceRate =
    markedWorking > 0 ? Math.round(((totals.present + totals.late) / markedWorking) * 100) : 100;

  return NextResponse.json({
    days,
    rows,
    summary: {
      employees: employees.length,
      attendanceRate,
      totals,
      onLeaveToday,
    },
  });
}
