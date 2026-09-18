import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calculatePayroll } from "@/lib/kenya-payroll";

export const dynamic = "force-dynamic";

const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** GET /api/payroll?period= - employees + computed payslips. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") ?? currentPeriod();

  const employees = await db.employee.findMany({ where: { active: true, archivedAt: null } });
  const payslips = await db.payslip.findMany({
    where: { period },
    include: { employee: true },
  });

  // Compute live statutory values for the UI calculator
  const rows = payslips.length
    ? payslips.map((ps) => {
        const calc = calculatePayroll({
          basic: ps.employee.basic,
          houseAllowance: ps.employee.houseAllowance,
          transport: ps.employee.transport,
          overtime: ps.overtime,
          helb: ps.employee.helb,
        });
        return {
          id: ps.id, employeeId: ps.employeeId,
          employeeName: ps.employee.name, idNo: ps.employee.idNo,
          dept: ps.employee.dept, role: ps.employee.role,
          period: ps.period,
          basic: ps.employee.basic, houseAllowance: ps.employee.houseAllowance,
          transport: ps.employee.transport, overtime: ps.overtime,
          gross: calc.gross, nssf: calc.nssfEmployee, shif: calc.shif,
          housingLevy: calc.housingLevyEmployee, paye: calc.paye,
          helb: calc.helb, net: calc.net, status: ps.status,
          mpesaNumber: ps.employee.mpesaNumber, bankAccount: ps.employee.bankAccount,
        };
      })
    : employees.map((e) => {
        const calc = calculatePayroll({
          basic: e.basic, houseAllowance: e.houseAllowance, transport: e.transport, helb: e.helb,
        });
        return {
          id: -1, employeeId: e.id, employeeName: e.name, idNo: e.idNo,
          dept: e.dept, role: e.role, period,
          basic: e.basic, houseAllowance: e.houseAllowance, transport: e.transport,
          overtime: 0, gross: calc.gross, nssf: calc.nssfEmployee, shif: calc.shif,
          housingLevy: calc.housingLevyEmployee, paye: calc.paye, helb: calc.helb,
          net: calc.net, status: "Draft",
          mpesaNumber: e.mpesaNumber, bankAccount: e.bankAccount,
        };
      });

  return NextResponse.json({
    period,
    rows,
    totals: {
      gross: rows.reduce((a, r) => a + r.gross, 0),
      paye: rows.reduce((a, r) => a + r.paye, 0),
      nssf: rows.reduce((a, r) => a + r.nssf, 0),
      shif: rows.reduce((a, r) => a + r.shif, 0),
      housingLevy: rows.reduce((a, r) => a + r.housingLevy, 0),
      net: rows.reduce((a, r) => a + r.net, 0),
      count: rows.length,
    },
    rates: { shifPct: 0.0275, housingPct: 0.015, personalRelief: 2400 },
  });
}

/** POST /api/payroll/run - commit payroll for a period (upsert payslips). */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const period = body.period ?? currentPeriod();
  const employees = await db.employee.findMany({ where: { active: true, archivedAt: null } });

  for (const e of employees) {
    const calc = calculatePayroll({
      basic: e.basic, houseAllowance: e.houseAllowance, transport: e.transport, helb: e.helb,
    });
    await db.payslip.upsert({
      where: { employeeId_period: { employeeId: e.id, period } },
      update: {
        gross: calc.gross, nssf: calc.nssfEmployee, shif: calc.shif,
        housingLevy: calc.housingLevyEmployee, paye: calc.paye, helb: calc.helb,
        net: calc.net,
      },
      create: {
        employeeId: e.id, period,
        basic: e.basic, houseAllowance: e.houseAllowance, transport: e.transport,
        gross: calc.gross, nssf: calc.nssfEmployee, shif: calc.shif,
        housingLevy: calc.housingLevyEmployee, paye: calc.paye, helb: calc.helb, net: calc.net,
      },
    });
  }
  return NextResponse.json({ ok: true, period, count: employees.length });
}

/** PATCH /api/payroll - mark period paid (auto journal simulated). */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const period = body.period ?? currentPeriod();
  await db.payslip.updateMany({ where: { period }, data: { status: "Paid" } });
  return NextResponse.json({ ok: true, period });
}
