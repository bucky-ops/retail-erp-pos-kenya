import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { mpesaB2cCsv, bankCsv } from "@/lib/kenya-payroll";

export const dynamic = "force-dynamic";

/** GET /api/payroll/export?period=&type=b2c|bank - CSV payout files. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") ?? "current";
  const type = searchParams.get("type") ?? "b2c";

  const payslips = await db.payslip.findMany({ where: { period }, include: { employee: true } });

  const rows = payslips.map((p) => ({
    employeeId: p.employeeId,
    name: p.employee.name,
    mpesaNumber: p.employee.mpesaNumber,
    bankAccount: p.employee.bankAccount,
    net: p.net,
    period,
  }));

  const csv = type === "bank" ? bankCsv(rows) : mpesaB2cCsv(rows);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="payroll-${period}-${type}.csv"`,
    },
  });
}
