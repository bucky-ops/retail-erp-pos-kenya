"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banknote, CalendarCheck2, ChevronDown, Download, FileDown, GraduationCap, HeartPulse, Home, Info,
  Landmark, Loader2, Mail, Play, Plus, Send, ShieldCheck, Smartphone, TrendingDown, Users, Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { KES, PayslipDto } from "@/types";
import { ScreenHeader, KpiCard, Panel, EmptyState, TableSkeleton } from "@/components/df/shared";
import { QrImage } from "@/components/df/qr";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/* -- contracts & helpers ------------------------------------ */

interface PayrollResponse {
  period: string;
  rows: PayslipDto[];
  totals: { gross: number; paye: number; nssf: number; shif: number; housingLevy: number; net: number; count: number };
  rates: { shifPct: number; housingPct: number; personalRelief: number };
}

interface AttDay {
  status: string;
  checkIn: string | null;
  checkOut: string | null;
}

interface AttRow {
  employeeId: number;
  staffNo: string;
  name: string;
  dept: string;
  role: string;
  status: string;
  perDay: (AttDay | null)[];
  counters: { present: number; late: number; absent: number; leave: number; off: number };
  rate: number;
  leave: { annual: number; annualUsed: number; sick: number; sickUsed: number };
}

interface AttPayload {
  days: string[];
  rows: AttRow[];
  summary: {
    employees: number;
    attendanceRate: number;
    totals: { present: number; late: number; absent: number; leave: number; off: number; unmarked: number };
    onLeaveToday: number;
  };
}

interface AdvRow {
  id: number;
  ref: string;
  employeeId: number;
  employeeName: string;
  staffNo: string;
  dept: string;
  principal: number;
  installment: number;
  outstanding: number;
  reason: string;
  status: string;
  takenAt: string;
  clearedAt: string | null;
}

interface AdvPayload {
  rows: AdvRow[];
  summary: { count: number; pending: number; outstanding: number; repaidValue: number };
}

interface StaffOption {
  id: number;
  name: string;
  staffNo: string;
  dept: string;
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

/** Attendance status chip colors (7-day register). */
const ATT_STYLES: Record<string, string> = {
  Present: "bg-[#E8F5E9] text-[#1B7A2E]",
  Late: "bg-[#FFF8E1] text-[#B8860B]",
  Absent: "bg-[#FFEBEE] text-[#C62828]",
  Leave: "bg-[#E9F2FF] text-[#0052CC]",
  OFF: "bg-[#F4F5F7] text-[#6B778C]",
};

const ATT_SHORT: Record<string, string> = { Present: "P", Late: "L", Absent: "A", Leave: "V", OFF: "-" };

/** Register cell for one employee-day. */
function DayChip({ rec }: { rec: AttDay | null }) {
  if (!rec) return <span className="inline-flex h-6 w-7 items-center justify-center rounded-md bg-[#FAFBFC] text-[10px] text-[#C1C7D0]">.</span>;
  const tip = `${rec.status}${rec.checkIn ? ` • in ${rec.checkIn}` : ""}${rec.checkOut ? ` • out ${rec.checkOut}` : ""}`;
  return (
    <span
      title={tip}
      className={cn(
        "inline-flex h-6 w-7 cursor-help items-center justify-center rounded-md text-[10px] font-bold",
        ATT_STYLES[rec.status] ?? "bg-[#F4F5F7] text-[#6B778C]"
      )}
    >
      {ATT_SHORT[rec.status] ?? "?"}
    </span>
  );
}

/* -- Attendance tab (HRMS register) ------------------------ */

function AttendanceTab() {
  const [data, setData] = useState<AttPayload | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<AttPayload>("/api/payroll/attendance")
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        toast({ title: "Could not load attendance", description: err(e) });
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const s = data?.summary;
  const days = data?.days ?? [];

  const dayHead = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return {
      dow: d.toLocaleDateString("en-KE", { weekday: "short" }),
      dom: String(d.getDate()).padStart(2, "0"),
    };
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 @6xl:grid-cols-4">
        <KpiCard
          icon={<CalendarCheck2 size={16} />}
          label="Attendance rate (7 days)"
          value={s ? `${s.attendanceRate}%` : ""}
          sub={s ? `${s.employees} employees on the register` : undefined}
          loading={!data}
        />
        <KpiCard
          icon={<Users size={16} />}
          label="Present + late marks"
          value={s ? String(s.totals.present + s.totals.late) : ""}
          sub={s ? `${s.totals.late} late arrivals` : undefined}
          iconBg="#E8F5E9"
          iconColor="#1B7A2E"
          loading={!data}
        />
        <KpiCard
          icon={<HeartPulse size={16} />}
          label="On leave"
          value={s ? String(s.onLeaveToday) : ""}
          sub={s ? `${s.totals.leave} leave days in the window` : undefined}
          iconBg="#E9F2FF"
          iconColor="#0052CC"
          loading={!data}
        />
        <KpiCard
          icon={<TrendingDown size={16} />}
          label="Absences (7 days)"
          value={s ? String(s.totals.absent) : ""}
          sub={s ? `${s.totals.unmarked} unmarked slots` : undefined}
          iconBg="#FFEBEE"
          iconColor="#C62828"
          loading={!data}
        />
      </div>

      <Panel padding={false} className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#DFE1E6] px-4 py-3">
          <div>
            <h3 className="font-display text-[14px] font-bold text-[#172B4D]">Attendance register - last 7 days</h3>
            <p className="text-[11px] text-[#6B778C]">P present • L late • A absent • V leave • - off • hover a chip for clock in/out</p>
          </div>
        </div>
        {!data ? (
          <div className="p-4">
            {loaded ? (
              <EmptyState icon={<CalendarCheck2 size={22} />} title="No register data" sub="Clock-ins from the POS will appear here." />
            ) : (
              <TableSkeleton rows={6} cols={9} />
            )}
          </div>
        ) : (
          <div className="df-scroll max-h-96 overflow-auto">
            <Table className="text-[12px]">
              <TableHeader>
                <TableRow className="bg-[#FAFBFC]">
                  <TableHead className="sticky left-0 z-10 bg-[#FAFBFC] text-[11px] uppercase tracking-widest text-[#6B778C]">Employee</TableHead>
                  {days.map((d) => {
                    const h = dayHead(d);
                    return (
                      <TableHead key={d} className="text-center text-[10px] uppercase tracking-widest text-[#6B778C]">
                        {h.dow}
                        <span className="block font-mono text-[10px] normal-case text-[#C1C7D0]">{h.dom}</span>
                      </TableHead>
                    );
                  })}
                  <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.employeeId} className="whitespace-nowrap text-[12px]">
                    <TableCell className="sticky left-0 z-10 bg-white">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#DFE1E6] text-[11px] font-bold text-[#172B4D]">
                          {initials(r.name)}
                        </span>
                        <div>
                          <p className="font-semibold text-[#172B4D]">{r.name}</p>
                          <p className="font-mono text-[10px] text-[#6B778C]">{r.staffNo} • {r.dept}</p>
                        </div>
                      </div>
                    </TableCell>
                    {r.perDay.map((rec, i) => (
                      <TableCell key={`${r.employeeId}-${days[i]}`} className="text-center">
                        <div className="flex justify-center">
                          <DayChip rec={rec} />
                        </div>
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-bold",
                          r.rate >= 90 ? "bg-[#E8F5E9] text-[#1B7A2E]" : r.rate >= 75 ? "bg-[#FFF8E1] text-[#B8860B]" : "bg-[#FFEBEE] text-[#C62828]"
                        )}
                      >
                        {r.rate}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      {/* leave balances */}
      {data && (
        <Panel>
          <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Leave balances</h3>
          <p className="text-[11px] text-[#6B778C]">Entitlement vs days taken - annual and sick, per employee</p>
          <div className="mt-3 grid grid-cols-1 gap-3 @3xl:grid-cols-2 @6xl:grid-cols-3">
            {data.rows.map((r) => {
              const annPct = Math.min(100, Math.round((r.leave.annualUsed / Math.max(1, r.leave.annual)) * 100));
              const sickPct = Math.min(100, Math.round((r.leave.sickUsed / Math.max(1, r.leave.sick)) * 100));
              return (
                <div key={r.employeeId} className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-[#172B4D]">{r.name}</span>
                    <span className="font-mono text-[10px] text-[#6B778C]">{r.staffNo}</span>
                  </div>
                  <div className="mt-2 space-y-1.5 text-[11px]">
                    <div>
                      <div className="flex justify-between text-[#6B778C]">
                        <span>Annual</span>
                        <span className="tabular-nums">{r.leave.annualUsed} / {r.leave.annual} days</span>
                      </div>
                      <div className="mt-0.5 h-1.5 rounded-full bg-[#DFE1E6]">
                        <div className="h-1.5 rounded-full bg-[#0052CC]" style={{ width: `${annPct}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-[#6B778C]">
                        <span>Sick</span>
                        <span className="tabular-nums">{r.leave.sickUsed} / {r.leave.sick} days</span>
                      </div>
                      <div className="mt-0.5 h-1.5 rounded-full bg-[#DFE1E6]">
                        <div className="h-1.5 rounded-full bg-[#1B7A2E]" style={{ width: `${sickPct}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}

/* -- Advances tab (salary advances) ------------------------ */

function AdvancesTab() {
  const [data, setData] = useState<AdvPayload | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [empId, setEmpId] = useState("");
  const [amount, setAmount] = useState("");
  const [installment, setInstallment] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api.get<AdvPayload>("/api/payroll/advances"));
    } catch (e) {
      toast({ title: "Could not load advances", description: err(e) });
      setData({ rows: [], summary: { count: 0, pending: 0, outstanding: 0, repaidValue: 0 } });
    }
  }, []);

  useEffect(() => {
    let alive = true;
    // async boundary so the loader's setState never fires synchronously in the effect
    const t = setTimeout(() => void load(), 0);
    api
      .get<{ staff: StaffOption[] }>("/api/staff")
      .then((d) => {
        if (alive) setStaff(d.staff);
      })
      .catch(() => {});
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [load]);

  const submit = async () => {
    if (!empId || !Number(amount)) {
      toast({ title: "Pick an employee and an amount" });
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; advance: { ref: string; principal: number } }>("/api/payroll/advances", {
        employeeId: Number(empId),
        amount: Number(amount),
        installment: Number(installment) || undefined,
        reason,
      });
      toast({
        title: `Advance ${res.advance.ref} recorded`,
        description: `KES ${res.advance.principal.toLocaleString()} to ${staff.find((s) => String(s.id) === empId)?.name ?? "employee"} - recovered per payslip.`,
      });
      setDlgOpen(false);
      setEmpId("");
      setAmount("");
      setInstallment("");
      setReason("");
      await load();
    } catch (e) {
      toast({ title: "Could not request advance", description: err(e) });
    } finally {
      setBusy(false);
    }
  };

  const markRepaid = async (r: AdvRow) => {
    setBusy(true);
    try {
      await api.patch("/api/payroll/advances", { id: r.id, action: "repaid" });
      toast({ title: `${r.ref} cleared`, description: `${r.employeeName} - advance fully repaid.` });
      await load();
    } catch (e) {
      toast({ title: "Could not mark repaid", description: err(e) });
    } finally {
      setBusy(false);
    }
  };

  const s = data?.summary;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 @6xl:grid-cols-4">
        <KpiCard
          icon={<Banknote size={16} />}
          label="Outstanding advances"
          value={s ? KES(s.outstanding) : ""}
          sub={s ? `${s.pending} still being recovered` : undefined}
          iconBg="#FFF8E1"
          iconColor="#B8860B"
          loading={!data}
        />
        <KpiCard
          icon={<Wallet size={16} />}
          label="Total advanced"
          value={s ? KES(s.repaidValue + (s?.outstanding ?? 0)) : ""}
          sub={s ? `${s.count} advances on record` : undefined}
          loading={!data}
        />
        <KpiCard
          icon={<ShieldCheck size={16} />}
          label="Repaid to date"
          value={s ? KES(s.repaidValue) : ""}
          sub="cleared from payslips"
          iconBg="#E8F5E9"
          iconColor="#1B7A2E"
          loading={!data}
        />
        <KpiCard
          icon={<Users size={16} />}
          label="Pending requests"
          value={s ? String(s.pending) : ""}
          sub="deducted per payslip installment"
          iconBg="#F4F5F7"
          iconColor="#172B4D"
          loading={!data}
        />
      </div>

      <Panel padding={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DFE1E6] px-4 py-3">
          <div>
            <h3 className="font-display text-[14px] font-bold text-[#172B4D]">Staff advances</h3>
            <p className="text-[11px] text-[#6B778C]">Salary advances with per-payslip recovery installments</p>
          </div>
          <Button
            onClick={() => setDlgOpen(true)}
            className="h-9 rounded-xl bg-[#0052CC] px-4 text-[13px] font-semibold text-white hover:bg-[#0041A8]"
          >
            <Plus size={15} /> Request Advance
          </Button>
        </div>
        {!data ? (
          <div className="p-4"><TableSkeleton rows={4} cols={7} /></div>
        ) : data.rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Banknote size={22} />}
              title="No advances on record"
              sub="Request an advance for a staff member and recover it from their payslip."
            />
          </div>
        ) : (
          <div className="df-scroll max-h-96 overflow-auto">
            <Table className="text-[12px]">
              <TableHeader>
                <TableRow className="bg-[#FAFBFC]">
                  <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Ref</TableHead>
                  <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Employee</TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">Principal</TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">Installment</TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">Outstanding</TableHead>
                  <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Reason</TableHead>
                  <TableHead className="text-[11px] uppercase tracking-widest text-[#6B778C]">Taken</TableHead>
                  <TableHead className="text-center text-[11px] uppercase tracking-widest text-[#6B778C]">Status</TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-widest text-[#6B778C]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.id} className="whitespace-nowrap text-[12px]">
                    <TableCell className="font-mono font-bold text-[#172B4D]">{r.ref}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#DFE1E6] text-[11px] font-bold text-[#172B4D]">
                          {initials(r.employeeName)}
                        </span>
                        <div>
                          <p className="font-semibold text-[#172B4D]">{r.employeeName}</p>
                          <p className="font-mono text-[10px] text-[#6B778C]">{r.staffNo} • {r.dept}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-[#172B4D]">{r.principal.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-[#6B778C]">{r.installment.toLocaleString()}</TableCell>
                    <TableCell className={cn("text-right font-bold tabular-nums", r.outstanding > 0 ? "text-[#B8860B]" : "text-[#1B7A2E]")}>
                      {r.outstanding.toLocaleString()}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-[#6B778C]" title={r.reason}>{r.reason || "-"}</TableCell>
                    <TableCell className="text-[#6B778C]">
                      {new Date(r.takenAt).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold",
                          r.status === "REPAID" ? "bg-[#E8F5E9] text-[#1B7A2E]" : "bg-[#FFF8E1] text-[#8B6D00]"
                        )}
                      >
                        {r.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.status === "PENDING" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void markRepaid(r)}
                          className="h-7 rounded-full px-3 text-[11px] font-semibold"
                        >
                          Mark repaid
                        </Button>
                      ) : (
                        <span className="text-[10px] text-[#C1C7D0]">cleared</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      {/* request advance dialog */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="rounded-2xl sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="font-display text-[16px] font-bold text-[#172B4D]">Request Staff Advance</DialogTitle>
            <DialogDescription className="text-[12px] text-[#6B778C]">
              The amount is recorded instantly and recovered from upcoming payslips.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label className="text-[12px] font-semibold text-[#172B4D]">Employee</Label>
              <Select value={empId} onValueChange={setEmpId}>
                <SelectTrigger className="h-10 rounded-xl bg-[#FAFBFC]">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {staff.map((st) => (
                    <SelectItem key={st.id} value={String(st.id)}>
                      {st.name} - {st.staffNo} ({st.dept})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="adv-amount" className="text-[12px] font-semibold text-[#172B4D]">Amount (KES)</Label>
                <Input
                  id="adv-amount"
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="10000"
                  className="h-10 rounded-xl bg-[#FAFBFC]"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="adv-inst" className="text-[12px] font-semibold text-[#172B4D]">Installment</Label>
                <Input
                  id="adv-inst"
                  type="number"
                  min={0}
                  value={installment}
                  onChange={(e) => setInstallment(e.target.value)}
                  placeholder="auto / 3 months"
                  className="h-10 rounded-xl bg-[#FAFBFC]"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="adv-reason" className="text-[12px] font-semibold text-[#172B4D]">Reason</Label>
              <Textarea
                id="adv-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="School fees, medical, family emergency..."
                className="min-h-[60px] rounded-xl bg-[#FAFBFC] text-[12px]"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDlgOpen(false)} className="rounded-xl">Cancel</Button>
            <Button
              onClick={() => void submit()}
              disabled={busy || !empId || !Number(amount)}
              className="rounded-xl bg-[#0052CC] text-white hover:bg-[#0041A8]"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Record advance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* -- screen ------------------------------------------------- */

export default function PayrollScreen() {
  const periods = useMemo(() => recentPeriods(), []);
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
    // async boundary: never call the loader synchronously inside the effect
    const t = setTimeout(() => void load(period), 0);
    return () => clearTimeout(t);
  }, [period, load]);

  /* only trust data that belongs to the selected period (no stale flash) */
  const visible = data && data.period === period ? data : null;
  const rows = visible?.rows ?? [];
  const t = visible?.totals;
  const committed = rows.length > 0 && rows.every((r) => r.id > 0);

  /* -- actions ---------------------------------------------- */

  const runPayroll = async () => {
    setBusy("run");
    try {
      const res = await api.post<{ ok: boolean; count: number }>("/api/payroll/run", { period });
      toast({
        title: `Payroll computed for ${res.count} employees`,
        description: `PAYE ${KES(t?.paye ?? 0)} • SHIF ${KES(t?.shif ?? 0)} • NSSF ${KES(t?.nssf ?? 0)} - all statutory deducted`,
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
      toast({ title: "Nothing to mark paid", description: `Run payroll for ${periodLabel(period)} first - current rows are a live preview only.` });
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
        title="Payroll - Kenya Compliant"
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

      <Tabs defaultValue="payroll" className="gap-4">
        <TabsList className="h-auto w-full max-w-full justify-start gap-1 overflow-x-auto rounded-xl border border-[#DFE1E6] bg-white p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="payroll" className="flex-none px-4 py-1.5 text-[12px]">Payroll</TabsTrigger>
          <TabsTrigger value="attendance" className="flex-none px-4 py-1.5 text-[12px]">Attendance</TabsTrigger>
          <TabsTrigger value="advances" className="flex-none px-4 py-1.5 text-[12px]">Advances</TabsTrigger>
        </TabsList>

        {/* ══ Payroll tab (original content) ══ */}
        <TabsContent value="payroll" className="space-y-4">
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
            <KpiCard icon={<Wallet className="h-4 w-4" />} label="Gross payroll" value={KES(t?.gross ?? 0)} loading={!visible} sub={`${t?.count ?? 0} employees`} />
            <KpiCard
              icon={<TrendingDown className="h-4 w-4" />}
              label="Total deductions"
              value={KES(deductions)}
              loading={!visible}
              sub="PAYE + NSSF + SHIF + Housing + HELB"
              iconBg="#FFEBEE"
              iconColor="#FF5630"
            />
            <KpiCard icon={<Banknote className="h-4 w-4" />} label="Net pay (take home)" value={KES(t?.net ?? 0)} loading={!visible} sub="paid via M-Pesa B2C / bank" iconBg="#E8F5E9" iconColor="#1B7A2E" />
            <KpiCard icon={<Users className="h-4 w-4" />} label="Employees" value={String(t?.count ?? 0)} loading={!visible} sub={periodLabel(period)} iconBg="#F4F5F7" iconColor="#172B4D" />
          </div>

          {/* main table */}
          <Panel padding={false} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#DFE1E6] px-4 py-3">
              <h3 className="font-display text-[14px] font-bold text-[#172B4D]">
                Payslips - {periodLabel(period)}
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
            {!visible ? (
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
              <div className="df-scroll max-h-96 overflow-auto">
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
                        <TableCell className="text-right tabular-nums text-[#6B778C]">{r.helb > 0 ? r.helb.toLocaleString() : "-"}</TableCell>
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
                      HELB is a fixed monthly amount per employee (KES 500 - 5,000).
                    </p>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </Panel>
        </TabsContent>

        {/* ══ Attendance tab ══ */}
        <TabsContent value="attendance">
          <AttendanceTab />
        </TabsContent>

        {/* ══ Advances tab ══ */}
        <TabsContent value="advances">
          <AdvancesTab />
        </TabsContent>
      </Tabs>

      {/* ══════════ Payslip drawer ══════════ */}
      <Sheet open={!!slip} onOpenChange={(o) => !o && setSlip(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[460px]">
          {slip && (
            <>
              <SheetHeader className="border-b border-[#DFE1E6] px-5 py-4">
                <SheetTitle className="font-display text-[16px]">Payslip - {periodLabel(slip.period)}</SheetTitle>
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
                      {slip.mpesaNumber ? `M-Pesa ${slip.mpesaNumber}` : slip.bankAccount ? `Bank ${slip.bankAccount}` : "-"}
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
