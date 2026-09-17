"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banknote, ChevronDown, Download, FileDown, GraduationCap, HeartPulse, Home, Info,
  Landmark, Loader2, Mail, Play, Send, ShieldCheck, Smartphone, TrendingDown, Users, Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { KES, PayslipDto } from "@/types";
import { ScreenHeader, KpiCard, Panel, EmptyState, TableSkeleton } from "@/components/df/shared";
import { QrImage } from "@/components/df/qr";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/* ── contracts & helpers ──────────────────────────────────── */

interface PayrollResponse {
  period: string;
  rows: PayslipDto[];
  totals: { gross: number; paye: number; nssf: number; shif: number; housingLevy: number; net: number; count: number };
  rates: { shifPct: number; housingPct: number; personalRelief: number };
}

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const initials = (name: string) =>
  name.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const periodLabel = (p: string) => {
  const [y, m] = p.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
};

/** Last 6 periods ending with the current month, newest first. */
function recentPeriods(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < 6; i++) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const RATE_CHIPS = [
  { icon: ShieldCheck, label: "NSSF Tier I+II", detail: "KES 360 + 720", bg: "#E9F2FF", fg: "#0052CC" },
  { icon: HeartPulse, label: "SHIF 2.75%", detail: "min KES 300", bg: "#FFEBEE", fg: "#C62828" },
  { icon: Home, label: "Housing Levy 1.5%", detail: "employee + employer", bg: "#E8F5E9", fg: "#1B7A2E" },
  { icon: Landmark, label: "PAYE bands 10%→35%", detail: "relief KES 2,400", bg: "#FFF8E1", fg: "#8B6D00" },
  { icon: GraduationCap, label: "HELB", detail: "per employee", bg: "#F4F5F7", fg: "#172B4D" },
];

/* ── screen ───────────────────────────────────────────────── */

export default function PayrollScreen() {
  const periods = useMemo(recentPeriods, []);
  const [period, setPeriod] = useState<string>(periods[0]);
  const [data, setData] = useState<PayrollResponse | null>(null);
  const [busy, setBusy] = useState<"run" | "paid" | null>(null);
  const [slip, setSlip] = useState<PayslipDto | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const load = useCallback(async (p: string) => {
    try {
      setData(await api.get<PayrollResponse>(`/api/payroll?period=${encodeURIComponent(p)}`));
    } catch (e) {
      toast({ title: "Could not load payroll", description: err(e) });
      setData({ period: p, rows: [], totals: { gross: 0, paye: 0, nssf: 0, shif: 0, housingLevy: 0, net: 0, count: 0 }, rates: { shifPct: 0.0275, housingPct: 0.015, personalRelief: 2400 } });
    }
  }, []);

  useEffect(() => {
    setData(null);
    void load(period);
  }, [period, load]);

  const rows = data?.rows ?? [];
  const t = data?.totals;
  const committed = rows.length > 0 && rows.every((r) => r.id > 0);

  /* ── actions ────────────────────────────────────────────── */

  const runPayroll = async () => {
    setBusy("run");
    try {
      const res = await api.post<{ ok: boolean; count: number }>("/api/payroll/run", { period });
      toast({
        title: `Payroll computed for ${res.count} employees`,
        description: `PAYE ${KES(t?.paye ?? 0)} • SHIF ${KES(t?.shif ?? 0)} • NSSF ${KES(t?.nssf ?? 0)} — all statutory deducted`,
      });
      await load(period);
    } catch (e) {
      toast({ title: "Payroll run failed", description: err(e) });
    } finally {
      setBusy(null);
    }
  };

  const markPaid = async () => {
    if (!committed) {
      toast({ title: "Nothing to mark paid", description: `Run payroll for ${periodLabel(period)} first — current rows are a live preview only.` });
      return;
    }
    setBusy("paid");
    try {
      await api.patch("/api/payroll", { period });
      toast({ title: `Journal JE-PAYROLL-${period} posted`, description: "Payslips emailed to all staff" });
      await load(period);
    } catch (e) {
      toast({ title: "Could not mark period paid", description: err(e) });
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = (type: "b2c" | "bank") => {
    window.open(`/api/payroll/export?period=${encodeURIComponent(period)}&type=${type}`, "_blank");
    toast({
      title: type === "b2c" ? "M-Pesa B2C CSV exported" : "Bank transfer CSV exported",
      description: `payroll-${period}-${type}.csv • ${rows.length} rows`,
    });
  };

  const allPaid = committed && rows.every((r) => r.status === "Paid");
  const deductions = (t?.gross ?? 0) - (t?.net ?? 0);

  return (
    <div className="space-y-4">
      <ScreenHeader
        title="Payroll — Kenya Compliant"
        subtitle="PAYE 2024 • NSSF • SHIF 2.75% • Housing Levy 1.5% • HELB"
        actions={
          <>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-9 w-[140px] rounded-xl text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p} value={p}>{periodLabel(p)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => void runPayroll()} disabled={busy !== null} className="h-9 rounded-xl bg-[#0052CC] px-4 text-[13px] font-semibold hover:bg-[#0041A8]">
              {busy === "run" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run Payroll
            </Button>
            <Button onClick={() => void markPaid()} disabled={busy !== null || allPaid} variant="outline" className="h-9 rounded-xl text-[13px] font-semibold">
              {busy === "paid" && <Loader2 className="h-4 w-4 animate-spin" />} Mark as Paid
            </Button>
            <Button onClick={() => exportCsv("b2c")} variant="outline" className="h-9 rounded-xl text-[13px] font-semibold">
              <Download className="h-4 w-4 text-[#00C853]" /> M-Pesa B2C CSV
            </Button>
            <Button onClick={() => exportCsv("bank")} variant="outline" className="h-9 rounded-xl text-[13px] font-semibold">
              <Download className="h-4 w-4 text-[#0052CC]" /> Bank CSV
            </Button>
          </>
        }
      />

      {/* statutory rates strip */}
      <div className="flex flex-wrap gap-2">
        {RATE_CHIPS.map((c) => (
          <span
            key={c.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#DFE1E6] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#172B4D]"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: c.bg, color: c.fg }}>
              <c.icon className="h-3 w-3" />
            </span>
            {c.label}
            <span className="text-[#6B778C]">• {c.detail}</span>
          </span>
        ))}
      </div>

      {/* totals KPI row */}
      <div className="grid grid-cols-2 gap-3 @6xl:grid-cols-4">
        <KpiCard icon={<Wallet className="h-4 w-4" />} label="Gross payroll" value={KES(t?.gross ?? 0)} loading={!data} sub={`${t?.count ?? 0} employees`} />
        <KpiCard
          icon={<TrendingDown className="h-4 w-4" />}
          label="Total deductions"
          value={KES(deductions)}
          loading={!data}
          sub="PAYE + NSSF + SHIF + Housing + HELB"
          iconBg="#FFEBEE"
          iconColor="#FF5630"
        />
        <KpiCard icon={<Banknote className="h-4 w-4" />} label="Net pay (take home)" value={KES(t?.net ?? 0)} loading={!data} sub="paid via M-Pesa B2C / bank" iconBg="#E8F5E9" iconColor="#1B7A2E" />
        <KpiCard icon={<Users className="h-4 w-4" />} label="Employees" value={String(t?.count ?? 0)} loading={!data} sub={periodLabel(period)} iconBg="#F4F5F7" iconColor="#172B4D" />
      </div>

      {/* main table */}
      <Panel padding={false} className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#DFE1E6] px-4 py-3">
          <h3 className="font-display text-[14px] font-bold text-[#172B4D]">
            Payslips — {periodLabel(period)}
          </h3>
          <Badge
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-bold",
              allPaid ? "bg-[#E8F5E9] text-[#1B7A2E]" : "bg-[#FFF8E1] text-[#8B6D00]"
            )}
          >
            {allPaid ? "Paid" : "Draft"}
          </Badge>
        </div>
        {!data ? (
          <div className="p-4"><TableSkeleton rows={5} cols={8} /></div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title="No employees on payroll"
              sub="Add staff with basic pay, allowances and statutory details to run payroll."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#FAFBFC]">
                  <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Employee</TableHead>
                  <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Dept</TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">Basic</TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">Allowances</TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">Gross</TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">NSSF</TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">SHIF</TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">Housing</TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">PAYE</TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">HELB</TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">Net Pay</TableHead>
                  <TableHead className="text-center text-[11px] uppercase tracking-widest text-[#6B778C]">Status</TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">Payslip</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.employeeId}-${r.period}`} className="whitespace-nowrap text-[12px]">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#DFE1E6] text-[11px] font-bold text-[#172B4D]">
                          {initials(r.employeeName)}
                        </span>
                        <div>
                          <p className="font-semibold text-[#172B4D]">{r.employeeName}</p>
                          <p className="font-mono text-[10px] text-[#6B778C]">ID {r.idNo}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="rounded-full bg-[#F4F5F7] px-2 py-0.5 text-[10px] font-semibold text-[#172B4D]">{r.dept}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-[#172B4D]">{r.basic.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-[#6B778C]">
                      {(r.houseAllowance + r.transport).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-[#172B4D]">{r.gross.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-[#6B778C]">{r.nssf.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-[#6B778C]">{r.shif.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-[#6B778C]">{r.housingLevy.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-[#6B778C]">{r.paye.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-[#6B778C]">{r.helb > 0 ? r.helb.toLocaleString() : "—"}</TableCell>
                    <TableCell className="font-display text-right text-[13px] font-bold text-[#1B7A2E]">{r.net.toLocaleString()}</TableCell>
                    <TableCell className="text-center">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold",
                          r.status === "Paid" ? "bg-[#E8F5E9] text-[#1B7A2E]" : "bg-[#FFF8E1] text-[#8B6D00]"
                        )}
                      >
                        {r.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setSlip(r)} className="h-7 rounded-full px-3 text-[11px] font-semibold">
                        Payslip
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      {/* how deductions work */}
      <Panel>
        <Collapsible open={infoOpen} onOpenChange={setInfoOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex w-full items-center justify-between text-left">
              <span className="flex items-center gap-2">
                <Info className="h-4 w-4 text-[#0052CC]" />
                <span className="font-display text-[15px] font-bold text-[#172B4D]">How deductions are calculated</span>
              </span>
              <ChevronDown className={cn("h-4 w-4 text-[#6B778C] transition-transform", infoOpen && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-4 grid grid-cols-1 gap-3 text-[12px] leading-relaxed @2xl:grid-cols-2">
              <div className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3.5">
                <p className="mb-1 font-bold text-[#172B4D]">1. Taxable pay</p>
                <p className="font-mono text-[11px] text-[#0052CC]">taxable = gross − NSSF − SHIF − Housing Levy</p>
                <p className="mt-1 text-[#6B778C]">All three statutory pension/insurance deductions are applied before computing PAYE.</p>
              </div>
              <div className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3.5">
                <p className="mb-1 font-bold text-[#172B4D]">2. PAYE bands (monthly)</p>
                <ul className="space-y-0.5 text-[#6B778C]">
                  <li>• 10% on first KES 24,000</li>
                  <li>• 25% on next KES 8,333 (24,000 → 32,333)</li>
                  <li>• 30% up to KES 500,000</li>
                  <li>• 32.5% up to KES 800,000</li>
                  <li>• 35% above KES 800,000</li>
                  <li>• Relief: personal 2,400 + 15% of housing levy (AHL relief)</li>
                </ul>
              </div>
              <div className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3.5">
                <p className="mb-1 font-bold text-[#172B4D]">3. NSSF (pension)</p>
                <p className="text-[#6B778C]">
                  Tier I: 6% of first KES 6,000 = <span className="font-bold text-[#172B4D]">KES 360</span>. Tier II: 6% of next
                  KES 12,000 = <span className="font-bold text-[#172B4D]">KES 720</span>. Employer matches employee (pensionable = basic + house allowance).
                </p>
              </div>
              <div className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3.5">
                <p className="mb-1 font-bold text-[#172B4D]">4. SHIF & Housing Levy & HELB</p>
                <p className="text-[#6B778C]">
                  SHIF: 2.75% of gross (min KES 300). Housing Levy: 1.5% employee + 1.5% employer match (15% PAYE relief).
                  HELB is a fixed monthly amount per employee (KES 500 – 5,000).
                </p>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Panel>

      {/* ══════════ Payslip drawer ══════════ */}
      <Sheet open={!!slip} onOpenChange={(o) => !o && setSlip(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[460px]">
          {slip && (
            <>
              <SheetHeader className="border-b border-[#DFE1E6] px-5 py-4">
                <SheetTitle className="font-display text-[16px]">Payslip — {periodLabel(slip.period)}</SheetTitle>
                <SheetDescription className="text-[12px]">{slip.employeeName} • {slip.role}</SheetDescription>
              </SheetHeader>

              <div className="p-5">
                {/* payslip document */}
                <div className="overflow-hidden rounded-2xl border border-[#DFE1E6] shadow-sm">
                  <div className="bg-[#172B4D] p-4 text-white">
                    <p className="font-display text-[15px] font-bold">DukaFlow Ltd</p>
                    <p className="text-[10px] text-white/70">PIN P051234567A • Thika Road, Nairobi</p>
                    <p className="mt-2 inline-block rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest">
                      Payslip • {periodLabel(slip.period)}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-[12px]">
                    <span className="text-[#6B778C]">Employee</span><span className="text-right font-semibold text-[#172B4D]">{slip.employeeName}</span>
                    <span className="text-[#6B778C]">ID No</span><span className="text-right font-mono text-[#172B4D]">{slip.idNo}</span>
                    <span className="text-[#6B778C]">Dept / Role</span><span className="text-right text-[#172B4D]">{slip.dept} • {slip.role}</span>
                    <span className="text-[#6B778C]">Pay method</span>
                    <span className="text-right text-[#172B4D]">
                      {slip.mpesaNumber ? `M-Pesa ${slip.mpesaNumber}` : slip.bankAccount ? `Bank ${slip.bankAccount}` : "—"}
                    </span>
                  </div>

                  {/* earnings */}
                  <div className="border-t border-[#DFE1E6] bg-[#FAFBFC] px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1B7A2E]">Earnings</p>
                    <div className="mt-1.5 space-y-1 text-[12px]">
                      <div className="flex justify-between"><span className="text-[#6B778C]">Basic salary</span><span className="tabular-nums text-[#172B4D]">{KES(slip.basic)}</span></div>
                      <div className="flex justify-between"><span className="text-[#6B778C]">House allowance</span><span className="tabular-nums text-[#172B4D]">{KES(slip.houseAllowance)}</span></div>
                      <div className="flex justify-between"><span className="text-[#6B778C]">Transport</span><span className="tabular-nums text-[#172B4D]">{KES(slip.transport)}</span></div>
                      {slip.overtime > 0 && (
                        <div className="flex justify-between"><span className="text-[#6B778C]">Overtime</span><span className="tabular-nums text-[#172B4D]">{KES(slip.overtime)}</span></div>
                      )}
                      <div className="flex justify-between border-t border-dashed border-[#DFE1E6] pt-1 font-bold">
                        <span className="text-[#172B4D]">GROSS</span><span className="tabular-nums text-[#172B4D]">{KES(slip.gross)}</span>
                      </div>
                    </div>
                  </div>

                  {/* deductions */}
                  <div className="border-t border-[#DFE1E6] px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#FF5630]">Deductions</p>
                    <div className="mt-1.5 space-y-1 text-[12px]">
                      <div className="flex justify-between"><span className="text-[#6B778C]">PAYE</span><span className="tabular-nums text-[#FF5630]">−{KES(slip.paye)}</span></div>
                      <div className="flex justify-between"><span className="text-[#6B778C]">NSSF (Tier I+II)</span><span className="tabular-nums text-[#FF5630]">−{KES(slip.nssf)}</span></div>
                      <div className="flex justify-between"><span className="text-[#6B778C]">SHIF 2.75%</span><span className="tabular-nums text-[#FF5630]">−{KES(slip.shif)}</span></div>
                      <div className="flex justify-between"><span className="text-[#6B778C]">Housing Levy 1.5%</span><span className="tabular-nums text-[#FF5630]">−{KES(slip.housingLevy)}</span></div>
                      {slip.helb > 0 && (
                        <div className="flex justify-between"><span className="text-[#6B778C]">HELB</span><span className="tabular-nums text-[#FF5630]">−{KES(slip.helb)}</span></div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-[#00C853] px-4 py-3 text-white">
                    <span className="font-display text-[13px] font-bold uppercase tracking-wide">Net Pay</span>
                    <span className="font-display text-xl font-extrabold">{KES(slip.net)}</span>
                  </div>

                  <div className="flex flex-col items-center border-t border-[#DFE1E6] p-4">
                    <QrImage text={`DUKAFLOW-PAYSLIP:${slip.employeeId}:${slip.period}:${slip.net}`} size={90} />
                    <p className="mt-1.5 font-mono text-[10px] text-[#6B778C]">Payslip verified • DukaFlow Payroll</p>
                  </div>
                </div>

                <Separator className="my-4" />

                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant="outline"
                    className="h-9 rounded-xl text-[12px] font-semibold"
                    onClick={() => toast({ title: "Payslip emailed", description: `PDF sent to ${slip.employeeName}` })}
                  >
                    <Mail className="h-3.5 w-3.5 text-[#0052CC]" /> Email
                  </Button>
                  <Button
                    variant="outline"
                    className="h-9 rounded-xl text-[12px] font-semibold"
                    onClick={() => toast({ title: "SMS sent", description: `Payslip summary delivered to ${slip.mpesaNumber ?? slip.employeeName}` })}
                  >
                    <Send className="h-3.5 w-3.5 text-[#00C853]" /> SMS
                  </Button>
                  <Button
                    variant="outline"
                    className="h-9 rounded-xl text-[12px] font-semibold"
                    onClick={() => toast({ title: "Payslip PDF ready", description: `payslip-${slip.employeeName.split(" ")[0].toLowerCase()}-${slip.period}.pdf saved` })}
                  >
                    <FileDown className="h-3.5 w-3.5 text-[#172B4D]" /> PDF
                  </Button>
                </div>
                <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[10px] text-[#6B778C]">
                  <Smartphone className="h-3 w-3" /> Statutory deductions computed with Kenya 2024 rates • NSSF / SHIF / AHL compliant
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
