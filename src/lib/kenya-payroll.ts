/**
 * Kenya statutory payroll engine (2024/2025 rates).
 * PAYE brackets, NSSF Tier I/II, SHIF 2.75%, Housing Levy 1.5%, HELB.
 */

export interface PayrollInput {
  basic: number;
  houseAllowance: number;
  transport: number;
  overtime?: number;
  helb?: number; // fixed monthly HELB deduction (e.g. 5000 max / typical 1500-5000)
}

export interface PayrollResult {
  gross: number;
  nssfEmployee: number;
  nssfEmployer: number;
  shif: number;
  housingLevyEmployee: number;
  housingLevyEmployer: number;
  taxablePay: number;
  payeGross: number;
  personalRelief: number;
  insuranceRelief: number;
  housingRelief: number;
  paye: number;
  helb: number;
  totalDeductions: number;
  net: number;
}

// NSSF 2024 rates (user spec: Tier I 360 + Tier II 720; employer matches employee)
export const NSSF = {
  tier1Ceiling: 6000,
  tier2Ceiling: 18000,
  rate: 0.06,
};
export const SHIF_RATE = 0.0275; // 2.75% of gross (min KES 300)
export const SHIF_MIN = 300;
export const HOUSING_RATE = 0.015; // 1.5% employee + 1.5% employer
export const PERSONAL_RELIEF = 2400; // monthly
export const AHL_RELIEF_RATE = 0.15; // 15% of housing levy (max 9000)

/** PAYE 2024 monthly bands (KES) */
const PAYE_BANDS = [
  { upTo: 24000, rate: 0.1 },
  { upTo: 32333, rate: 0.25 },
  { upTo: 500000, rate: 0.3 },
  { upTo: 800000, rate: 0.325 },
  { upTo: Infinity, rate: 0.35 },
];

function bandTax(taxable: number): number {
  let tax = 0;
  let lower = 0;
  for (const band of PAYE_BANDS) {
    if (taxable <= lower) break;
    const amount = Math.min(taxable, band.upTo) - lower;
    tax += amount * band.rate;
    lower = band.upTo;
  }
  return tax;
}

export function nssfContribution(pensionable: number) {
  const tier1 = Math.min(pensionable, NSSF.tier1Ceiling) * NSSF.rate;
  const tier2 = Math.max(0, Math.min(pensionable, NSSF.tier2Ceiling) - NSSF.tier1Ceiling) * NSSF.rate;
  const employee = Math.round(tier1 + tier2);
  return { tier1: Math.round(tier1), tier2: Math.round(tier2), employee, employer: employee };
}

/** Full statutory calculation for one employee-month. */
export function calculatePayroll(input: PayrollInput): PayrollResult {
  const overtime = input.overtime ?? 0;
  const gross = input.basic + input.houseAllowance + input.transport + overtime;

  // NSSF on pensionable pay (basic + housing)
  const { employee: nssfEmployee, employer: nssfEmployer } = nssfContribution(input.basic + input.houseAllowance);

  // SHIF 2.75% of gross, min 300
  const shif = Math.max(SHIF_MIN, Math.round(gross * SHIF_RATE));

  // Housing levy 1.5% employee + employer
  const housingLevyEmployee = Math.round(gross * HOUSING_RATE);
  const housingLevyEmployer = housingLevyEmployee;

  // Taxable pay = gross - NSSF - SHIF - housing levy (post-2024 deductions)
  const taxablePay = Math.max(0, gross - nssfEmployee - shif - housingLevyEmployee);
  const payeGross = bandTax(taxablePay);

  const personalRelief = PERSONAL_RELIEF;
  const housingRelief = Math.round(Math.min(housingLevyEmployee * AHL_RELIEF_RATE, 9000));
  const insuranceRelief = 0;

  const paye = Math.max(0, Math.round(payeGross - personalRelief - housingRelief - insuranceRelief));
  const helb = input.helb ?? 0;

  const totalDeductions = nssfEmployee + shif + housingLevyEmployee + paye + helb;
  const net = gross - totalDeductions;

  return {
    gross: Math.round(gross),
    nssfEmployee, nssfEmployer, shif,
    housingLevyEmployee, housingLevyEmployer,
    taxablePay: Math.round(taxablePay),
    payeGross: Math.round(payeGross),
    personalRelief, insuranceRelief, housingRelief,
    paye, helb, totalDeductions: Math.round(totalDeductions),
    net: Math.round(net),
  };
}

/** CSV row generators for B2C payout files. */
export function mpesaB2cCsv(
  rows: { name: string; mpesaNumber: string | null; net: number; period: string; employeeId: number }[]
): string {
  const header = "EmployeeID,EmployeeName,PhoneNumber,Amount,CommandID,Remarks,Period";
  const lines = rows.map(
    (r) =>
      `${r.employeeId},"${r.name}",${r.mpesaNumber ?? ""},${r.net.toFixed(2)},SalaryPayment,Salary ${r.period},${r.period}`
  );
  return [header, ...lines].join("\n");
}

export function bankCsv(
  rows: { name: string; bankAccount: string | null; net: number; period: string; employeeId: number }[]
): string {
  const header = "EmployeeID,EmployeeName,BankAccount,Amount,Narrative,Period";
  const lines = rows.map(
    (r) => `${r.employeeId},"${r.name}",${r.bankAccount ?? ""},${r.net.toFixed(2)},Salary ${r.period},${r.period}`
  );
  return [header, ...lines].join("\n");
}
