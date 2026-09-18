import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const dateStr = (d: Date) => d.toISOString().slice(0, 10);

/** GET /api/staff/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD
 *  Attendance register grid for the roster board (defaults to the last 7 days).
 *  Returns the ordered day list plus one row per active employee with a
 *  date-keyed cell map: { status, checkIn, checkOut, overtimeHrs }.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const today = dateStr(new Date());
  const to = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("to") ?? "") ? searchParams.get("to")! : today;
  const from =
    /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("from") ?? "")
      ? searchParams.get("from")!
      : dateStr(new Date(new Date(`${to}T00:00:00Z`).getTime() - 6 * 864e5));

  const [employees, records] = await Promise.all([
    db.employee.findMany({
      where: { active: true },
      orderBy: { staffNo: "asc" },
      select: { id: true, name: true, staffNo: true },
    }),
    db.attendance.findMany({
      where: { date: { gte: from, lte: to } },
      select: { employeeId: true, date: true, status: true, checkIn: true, checkOut: true, overtimeHrs: true },
    }),
  ]);

  // ordered inclusive day list
  const days: string[] = [];
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= new Date(`${to}T00:00:00Z`).getTime(); t += 864e5) {
    days.push(dateStr(new Date(t)));
  }

  const cellMap = new Map<string, { status: string; checkIn: string | null; checkOut: string | null; overtimeHrs: number }>();
  for (const r of records) {
    cellMap.set(`${r.employeeId}|${r.date}`, {
      status: r.status,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      overtimeHrs: r.overtimeHrs,
    });
  }

  return NextResponse.json({
    from,
    to,
    today,
    days,
    rows: employees.map((e) => {
      const cells: Record<string, { status: string; checkIn: string | null; checkOut: string | null; overtimeHrs: number }> = {};
      for (const d of days) {
        const cell = cellMap.get(`${e.id}|${d}`);
        if (cell) cells[d] = cell;
      }
      return { employeeId: e.id, name: e.name, staffNo: e.staffNo, cells };
    }),
  });
}
