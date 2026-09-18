"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Landmark,
  Link2,
  ListTree,
  PackageMinus,
  Scale,
  TrendingUp,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { KES } from "@/types";
import { ScreenHeader, KpiCard, Panel, EmptyState, TableSkeleton } from "@/components/df/shared";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/* ══ contracts (mirror of /api/accounting payload) ══════════════════════════ */

interface AccountDTO {
  id: number;
  code: string;
  name: string;
  type: string;
  parent: string | null;
  isGroup: boolean;
  balance: number;
}

interface JLineDTO {
  id: number;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  memo: string;
}

interface JournalDTO {
  id: number;
  jvNo: string;
  date: string;
  memo: string;
  source: string;
  refNo: string;
  storeId: number | null;
  totalDebit: number;
  totalCredit: number;
  lines: JLineDTO[];
}

interface TBRow {
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
}

interface PnlLine {
  code: string;
  name: string;
  amount: number;
}

interface StmtLine {
  id: number;
  date: string;
  till: string;
  ref: string;
  description: string;
  amount: number;
  matched: boolean;
  matchRef: string;
}

interface AccPayload {
  month: string;
  today: string;
  coa: AccountDTO[];
  journals: JournalDTO[];
  dailySalesJournals: JournalDTO[];
  trialBalance: TBRow[];
  tbTotals: { debit: number; credit: number };
  tbAutoBalanced: boolean;
  tbAdjustment: number;
  pnl: {
    revenue: PnlLine[];
    cogs: PnlLine[];
    expenses: PnlLine[];
    netSales: number;
    totalCogs: number;
    grossProfit: number;
    grossMarginPct: number;
    totalExpenses: number;
    netProfit: number;
    prevMonthNetProfit: number;
    trendPct: number;
    prev: { netSales: number; totalCogs: number; grossProfit: number; grossMarginPct: number; totalExpenses: number; netProfit: number };
  };
  balanceSheet: {
    assets: PnlLine[];
    liabilities: PnlLine[];
    equity: PnlLine[];
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    bsAutoBalanced: boolean;
  };
  stockValuation: {
    total: number;
    skuCount: number;
    method: string;
    lines: { product: string; sku: string; qty: number; cost: number; value: number }[];
    movement: { in: number; out: number; cogs: number };
  };
  bankRecon: {
    statement: StmtLine[];
    summary: { matched: number; unmatched: number; matchedAmount: number; unmatchedAmount: number; matchPct: number; statementTotal: number };
  };
  stores: { id: number; name: string }[];
  ledgerCash: number;
}

/* ══ helpers ════════════════════════════════════════════════════════════════ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
};

const fmtMonth = (m: string) => {
  const [y, mm] = m.split("-");
  return `${MONTHS[Number(mm) - 1] ?? mm} ${y}`;
};

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

const SCROLL = "max-h-[560px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#DFE1E6] [&::-webkit-scrollbar-track]:bg-transparent";

/** Type → chip colours + group left-border colour. */
const TYPE_STYLE: Record<string, { chip: string; border: string }> = {
  Asset: { chip: "bg-[#E8F5E9] text-[#1B7A2E]", border: "#00C853" },
  Liability: { chip: "bg-[#FFF8E1] text-[#B8860B]", border: "#FFAB00" },
  Equity: { chip: "bg-[#F4F5F7] text-[#172B4D]", border: "#172B4D" },
  Revenue: { chip: "bg-[#E9F2FF] text-[#0052CC]", border: "#0052CC" },
  COGS: { chip: "bg-[#FFF3E0] text-[#B25E00]", border: "#FF8B00" },
  Expense: { chip: "bg-[#FFEBEE] text-[#FF5630]", border: "#FF5630" },
};

function TypeChip({ type }: { type: string }) {
  const s = TYPE_STYLE[type] ?? { chip: "bg-[#F4F5F7] text-[#6B778C]", border: "#DFE1E6" };
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", s.chip)}>{type}</span>;
}

/** Journal source badge - DayClose blue, Manual gray, Payroll purple, Inventory amber. */
function SourceBadge({ source }: { source: string }) {
  const map: Record<string, string> = {
    DayClose: "bg-[#E9F2FF] text-[#0052CC]",
    Manual: "bg-[#F4F5F7] text-[#6B778C]",
    Payroll: "bg-[#EAE6FF] text-[#6554C0]",
    Inventory: "bg-[#FFF8E1] text-[#B8860B]",
  };
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", map[source] ?? map.Manual)}>{source}</span>;
}

/** Cached debit-positive balance rendered with Dr/Cr suffix. */
function DrCr({ balance }: { balance: number }) {
  return (
    <span className="tabular-nums">
      {balance >= 0 ? (
        <>
          {KES(balance)} <span className="text-[10px] font-bold text-[#1B7A2E]">Dr</span>
        </>
      ) : (
        <>
          {KES(-balance)} <span className="text-[10px] font-bold text-[#FF5630]">Cr</span>
        </>
      )}
    </span>
  );
}

/** Right-aligned money cell; zero renders as an em dash. */
function Money({ v, className }: { v: number; className?: string }) {
  return (
    <span className={cn("tabular-nums", v === 0 && "text-[#C1C7D0]", className)}>{v === 0 ? "-" : KES(v)}</span>
  );
}

/* ══ Chart of Accounts tab ══════════════════════════════════════════════════ */

function CoaTab({ coa }: { coa: AccountDTO[] }) {
  const [closed, setClosed] = useState<Set<string>>(new Set()); // collapsed groups
  const groups = useMemo(() => coa.filter((a) => a.isGroup), [coa]);
  const childrenOf = useCallback((code: string) => coa.filter((a) => a.parent === code), [coa]);

  const toggle = (code: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <Panel padding={false}>
      <div className={cn("p-4 md:p-6", SCROLL)}>
        <div className="mb-3 flex items-center gap-2 text-[12px] text-[#6B778C]">
          <ListTree className="h-4 w-4" />
          {coa.filter((a) => !a.isGroup).length} posting accounts in {groups.length} groups - tap a group to fold
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[560px] space-y-1">
            {groups.map((g) => {
              const kids = childrenOf(g.code);
              const open = !closed.has(g.code);
              const s = TYPE_STYLE[g.type] ?? { border: "#DFE1E6" };
              return (
                <div key={g.code}>
                  <button
                    onClick={() => toggle(g.code)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 rounded-lg border-l-4 py-2 pl-2 pr-3 text-left transition-colors hover:bg-[#F4F5F7]"
                    style={{ borderColor: s.border }}
                  >
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-[#6B778C] transition-transform", !open && "-rotate-90")} />
                    <span className="font-mono text-[12px] font-semibold text-[#6B778C]">{g.code}</span>
                    <span className="text-[13px] font-bold uppercase tracking-wide text-[#172B4D]">{g.name}</span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-[11px] text-[#6B778C]">{kids.length} accounts</span>
                      <TypeChip type={g.type} />
                    </span>
                  </button>
                  {open && (
                    <div className="ml-5 border-l border-dashed border-[#DFE1E6] pl-3">
                      {kids.map((a) => (
                        <div key={a.code} className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-[#F4F5F7]/70">
                          <span className="w-10 font-mono text-[12px] text-[#6B778C]">{a.code}</span>
                          <span className="text-[13px] text-[#172B4D]">{a.name}</span>
                          <TypeChip type={a.type} />
                          <span className="ml-auto text-[12px] font-semibold text-[#172B4D]">
                            <DrCr balance={a.balance} />
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ══ Journal card (shared by GL + Daily Sales Journals) ═════════════════════ */

function JournalCard({ j, open, onToggle, storeName }: { j: JournalDTO; open: boolean; onToggle: (id: number) => void; storeName?: string }) {
  const diff = Math.round((j.totalDebit - j.totalCredit) * 100) / 100;
  const balanced = Math.abs(diff) < 0.01;
  return (
    <Collapsible open={open} onOpenChange={() => onToggle(j.id)}>
      <div className="overflow-hidden rounded-2xl border border-[#DFE1E6] bg-white shadow-sm transition-shadow hover:shadow-md">
        <CollapsibleTrigger asChild>
          <button className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-[#F4F5F7]/60">
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-[#6B778C] transition-transform", open && "rotate-180")} />
            <span className="font-mono text-[13px] font-bold text-[#172B4D]">{j.jvNo}</span>
            <SourceBadge source={j.source} />
            <span className="text-[12px] text-[#6B778C]">{fmtDate(j.date)}</span>
            {storeName && <span className="hidden text-[11px] text-[#6B778C] sm:inline">• {storeName}</span>}
            <span className="ml-auto flex items-center gap-2 text-[11px] tabular-nums text-[#6B778C]">
              Dr {KES(j.totalDebit, true)} / Cr {KES(j.totalCredit, true)}
              {!balanced && <span className="rounded-full bg-[#FFEBEE] px-2 py-0.5 font-bold text-[#FF5630]">Out {KES(Math.abs(diff))}</span>}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-[#DFE1E6] px-4 pb-4 pt-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-medium text-[#172B4D]">{j.memo}</p>
              {j.refNo && <Badge variant="outline" className="border-[#DFE1E6] font-mono text-[10px] text-[#6B778C]">{j.refNo}</Badge>}
            </div>
            <div className="overflow-x-auto rounded-xl border border-[#DFE1E6]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#F4F5F7]/70">
                    <TableHead className="h-8 text-[11px]">Account</TableHead>
                    <TableHead className="h-8 text-right text-[11px]">Debit</TableHead>
                    <TableHead className="h-8 text-right text-[11px]">Credit</TableHead>
                    <TableHead className="h-8 text-[11px]">Memo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {j.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="py-1.5 text-[12px]">
                        <span className="font-mono text-[11px] text-[#6B778C]">{l.accountCode}</span> - {l.accountName}
                      </TableCell>
                      <TableCell className="py-1.5 text-right text-[12px]">
                        <Money v={l.debit} className="font-medium text-[#172B4D]" />
                      </TableCell>
                      <TableCell className="py-1.5 text-right text-[12px]">
                        <Money v={l.credit} className="font-medium text-[#172B4D]" />
                      </TableCell>
                      <TableCell className="py-1.5 text-[11px] text-[#6B778C]">{l.memo || "-"}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-[#DFE1E6] bg-[#F4F5F7]/50">
                    <TableCell className="py-2 text-[12px] font-bold text-[#172B4D]">Totals</TableCell>
                    <TableCell className="py-2 text-right text-[12px] font-bold tabular-nums text-[#172B4D]">{KES(j.totalDebit)}</TableCell>
                    <TableCell className="py-2 text-right text-[12px] font-bold tabular-nums text-[#172B4D]">{KES(j.totalCredit)}</TableCell>
                    <TableCell className="py-2">
                      {balanced ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[10px] font-bold text-[#1B7A2E]">
                          <CheckCircle2 className="h-3 w-3" /> Balanced
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#FFEBEE] px-2 py-0.5 text-[10px] font-bold text-[#FF5630]">
                          <XCircle className="h-3 w-3" /> Diff {KES(Math.abs(diff))}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/* ══ General Ledger tab ═════════════════════════════════════════════════════ */

function GeneralLedgerTab({ journals, stores }: { journals: JournalDTO[]; stores: { id: number; name: string }[] }) {
  const [storeFilter, setStoreFilter] = useState("all");
  const [open, setOpen] = useState<Set<number>>(new Set());

  const filtered = useMemo(
    () => (storeFilter === "all" ? journals : journals.filter((j) => String(j.storeId) === storeFilter)),
    [journals, storeFilter]
  );
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const storeName = (id: number | null) => stores.find((s) => s.id === id)?.name;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={storeFilter} onValueChange={setStoreFilter}>
          <SelectTrigger className="w-[190px] bg-white" aria-label="Filter by store">
            <SelectValue placeholder="All stores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stores</SelectItem>
            {stores.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[12px] text-[#6B778C]">
          {filtered.length} entr{filtered.length === 1 ? "y" : "ies"} • latest 20 posted journals
        </span>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={<BookOpen className="h-5 w-5" />} title="No journal entries" sub="No journals match this store filter yet." />
      ) : (
        <div className={cn("space-y-2 pr-1", SCROLL)}>
          {filtered.map((j) => (
            <JournalCard key={j.id} j={j} open={open.has(j.id)} onToggle={toggle} storeName={storeName(j.storeId)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ══ Daily Sales Journals tab ═══════════════════════════════════════════════ */

function DailyJournalsTab({ entries, today, stores }: { entries: JournalDTO[]; today: string; stores: { id: number; name: string }[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set(entries.map((e) => e.id)));
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const totalDr = entries.reduce((t, j) => t + j.totalDebit, 0);
  const totalCr = entries.reduce((t, j) => t + j.totalCredit, 0);
  const hasToday = entries.some((j) => j.date === today);
  const storeName = (id: number | null) => stores.find((s) => s.id === id)?.name;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#E9F2FF] px-4 py-3 text-[13px] font-medium text-[#0052CC]">
        <Zap className="h-4 w-4 shrink-0" />
        <span>Auto-posted from Z reports - every Day Close writes a balanced sales journal.</span>
        <span className="ml-auto tabular-nums">
          Total Dr {KES(totalDr, true)} • Cr {KES(totalCr, true)}
        </span>
      </div>
      {!hasToday && (
        <Alert className="border-[#FFD591] bg-[#FFF8E1] text-[#172B4D]">
          <AlertTriangle className="h-4 w-4 !text-[#B8860B]" />
          <AlertTitle>Today not closed yet - no journal for today</AlertTitle>
          <AlertDescription className="text-[#6B778C]">
            Run the Day Close workflow to freeze today&apos;s Z report and auto-post its sales journal (Z report → JV).
          </AlertDescription>
        </Alert>
      )}
      {entries.length === 0 ? (
        <EmptyState icon={<Zap className="h-5 w-5" />} title="No Day Close journals yet" sub="Journals appear here automatically after each day is closed." />
      ) : (
        <div className={cn("space-y-2 pr-1", SCROLL)}>
          {entries.map((j) => (
            <JournalCard key={j.id} j={j} open={open.has(j.id)} onToggle={toggle} storeName={storeName(j.storeId)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ══ Stock Accounts tab ═════════════════════════════════════════════════════ */

function StockAccountsTab({ stock }: { stock: AccPayload["stockValuation"] }) {
  const kpis = [
    { icon: <Boxes className="h-4 w-4" />, label: "Inventory on hand (FIFO)", value: KES(stock.total), sub: `${stock.skuCount} SKUs counted`, bg: "#FFF8E1", fg: "#B8860B" },
    { icon: <PackageMinus className="h-4 w-4" />, label: "COGS this month (5100 Purchases)", value: KES(stock.movement.cogs), sub: "Posted from day-close journals", bg: "#FFF3E0", fg: "#B25E00" },
    { icon: <ArrowUpFromLine className="h-4 w-4" />, label: "Stock out this period (1200 credits)", value: KES(stock.movement.out), sub: "Matched by COGS postings", bg: "#FFEBEE", fg: "#FF5630" },
  ];
  const movement = [
    { icon: <ArrowDownToLine className="h-3.5 w-3.5 text-[#1B7A2E]" />, label: "Stock In - Inventory debits (1200)", amount: stock.movement.in, color: "text-[#1B7A2E]" },
    { icon: <ArrowUpFromLine className="h-3.5 w-3.5 text-[#FF5630]" />, label: "Stock Out - Inventory credits (1200)", amount: stock.movement.out, color: "text-[#FF5630]" },
    { icon: <PackageMinus className="h-3.5 w-3.5 text-[#B25E00]" />, label: "COGS - Purchases debits (5100)", amount: stock.movement.cogs, color: "text-[#B25E00]" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {kpis.map((k) => (
          <KpiCard key={k.label} icon={k.icon} label={k.label} value={k.value} sub={k.sub} iconBg={k.bg} iconColor={k.fg} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" padding={false}>
          <div className="flex flex-wrap items-center gap-2 px-4 pt-4 md:px-6 md:pt-6">
            <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Top products by value</h3>
            <Badge className="bg-[#E9F2FF] text-[#0052CC] hover:bg-[#E9F2FF]">Method: {stock.method}</Badge>
            <span className="ml-auto text-[11px] text-[#6B778C]">top 12 of {stock.skuCount}</span>
          </div>
          <div className={cn("mt-3 px-4 pb-4 md:px-6 md:pb-6", SCROLL)}>
            <div className="overflow-x-auto rounded-xl border border-[#DFE1E6]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#F4F5F7]/70">
                    <TableHead className="h-8 text-[11px]">Product</TableHead>
                    <TableHead className="h-8 text-[11px]">SKU</TableHead>
                    <TableHead className="h-8 text-right text-[11px]">Qty</TableHead>
                    <TableHead className="h-8 text-right text-[11px]">Unit cost</TableHead>
                    <TableHead className="h-8 text-right text-[11px]">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stock.lines.map((l) => (
                    <TableRow key={l.sku}>
                      <TableCell className="py-1.5 text-[12px] font-medium text-[#172B4D]">{l.product}</TableCell>
                      <TableCell className="py-1.5 font-mono text-[11px] text-[#6B778C]">{l.sku}</TableCell>
                      <TableCell className="py-1.5 text-right text-[12px] tabular-nums">{l.qty.toLocaleString("en-KE")}</TableCell>
                      <TableCell className="py-1.5 text-right text-[12px] tabular-nums text-[#6B778C]">{KES(l.cost)}</TableCell>
                      <TableCell className="py-1.5 text-right text-[12px] font-semibold tabular-nums text-[#172B4D]">{KES(l.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </Panel>
        <Panel>
          <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Stock movement</h3>
          <p className="mt-0.5 text-[11px] text-[#6B778C]">Derived from journal lines on 1200 / 5100</p>
          <div className="mt-3 space-y-2">
            {movement.map((m) => (
              <div key={m.label} className="flex items-center gap-2 rounded-xl border border-[#DFE1E6] bg-[#F4F5F7]/50 px-3 py-2.5">
                {m.icon}
                <div className="min-w-0">
                  <p className="truncate text-[11px] text-[#6B778C]">{m.label}</p>
                  <p className={cn("text-[14px] font-bold tabular-nums", m.color)}>{KES(m.amount)}</p>
                </div>
              </div>
            ))}
          </div>
          <Separator className="my-3" />
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-[#6B778C]">Net into inventory</span>
            <span className="font-bold tabular-nums text-[#172B4D]">{KES(stock.movement.in - stock.movement.out)}</span>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ══ Trial Balance tab ══════════════════════════════════════════════════════ */

function TrialBalanceTab({
  rows,
  totals,
  autoBalanced,
  adjustment,
  today,
}: {
  rows: TBRow[];
  totals: { debit: number; credit: number };
  autoBalanced: boolean;
  adjustment: number;
  today: string;
}) {
  const balanced = Math.abs(totals.debit - totals.credit) < 0.01;
  const diff = Math.round((totals.debit - totals.credit) * 100) / 100;
  return (
    <Panel padding={false}>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 md:px-6 md:pt-6">
        <Scale className="h-4 w-4 text-[#0052CC]" />
        <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Trial Balance</h3>
        <span className="text-[12px] text-[#6B778C]">As of {fmtDate(today)}</span>
        {balanced ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[#E8F5E9] px-2.5 py-1 text-[11px] font-bold text-[#1B7A2E]">
            <CheckCircle2 className="h-3.5 w-3.5" /> Balanced ✓
          </span>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[#FFEBEE] px-2.5 py-1 text-[11px] font-bold text-[#FF5630]">
            <XCircle className="h-3.5 w-3.5" /> Out by {KES(Math.abs(diff))}
          </span>
        )}
      </div>
      {autoBalanced && (
        <div className="mx-4 mt-3 rounded-xl border border-[#FFD591] bg-[#FFF8E1] px-3 py-2 text-[12px] text-[#8B6D00] md:mx-6">
          Auto-balanced - difference of {KES(Math.abs(adjustment))} posted to Retained Earnings (3200).
        </div>
      )}
      <div className={cn("mt-3 px-4 pb-4 md:px-6 md:pb-6", SCROLL)}>
        <div className="overflow-x-auto rounded-xl border border-[#DFE1E6]">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F4F5F7]/70">
                <TableHead className="h-8 text-[11px]">Code</TableHead>
                <TableHead className="h-8 text-[11px]">Account</TableHead>
                <TableHead className="h-8 text-[11px]">Type</TableHead>
                <TableHead className="h-8 text-right text-[11px]">Debit</TableHead>
                <TableHead className="h-8 text-right text-[11px]">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.code}>
                  <TableCell className="py-1.5 font-mono text-[12px] text-[#6B778C]">{r.code}</TableCell>
                  <TableCell className="py-1.5 text-[12px] font-medium text-[#172B4D]">{r.name}</TableCell>
                  <TableCell className="py-1.5">
                    <TypeChip type={r.type} />
                  </TableCell>
                  <TableCell className="py-1.5 text-right text-[12px]">
                    <Money v={r.debit} />
                  </TableCell>
                  <TableCell className="py-1.5 text-right text-[12px]">
                    <Money v={r.credit} />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-[#DFE1E6] bg-[#F4F5F7]">
                <TableCell colSpan={3} className="py-2.5 text-[12px] font-bold uppercase tracking-wide text-[#172B4D]">
                  Totals
                </TableCell>
                <TableCell className="py-2.5 text-right text-[13px] font-bold tabular-nums text-[#172B4D]">{KES(totals.debit)}</TableCell>
                <TableCell className="py-2.5 text-right text-[13px] font-bold tabular-nums text-[#172B4D]">{KES(totals.credit)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
    </Panel>
  );
}

/* ══ Profit & Loss tab ══════════════════════════════════════════════════════ */

/** One labelled money line of the P&L statement (module level). */
function PnlRow({ label, value, bold, indent, tone }: { label: string; value: number; bold?: boolean; indent?: boolean; tone?: "green" | "red" }) {
  return (
    <div className={cn("flex items-center justify-between py-1.5", bold && "border-t border-[#DFE1E6] pt-2.5 font-bold text-[#172B4D]")}>
      <span className={cn("text-[13px]", indent && "pl-4 text-[12px] text-[#6B778C]", bold && "pl-0")}>{label}</span>
      <span className={cn("tabular-nums", bold ? "text-[14px]" : "text-[13px] text-[#172B4D]", tone === "green" && "text-[#1B7A2E]", tone === "red" && "text-[#FF5630]")}>{KES(value)}</span>
    </div>
  );
}

function PnlTab({ pnl, month }: { pnl: AccPayload["pnl"]; month: string }) {
  const [sel, setSel] = useState(month);
  const isCurrent = sel === month;
  const prevMonth = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, [month]);
  const s82 = (l: PnlLine): PnlLine => ({ ...l, amount: Math.round(l.amount * 0.82) });
  const view = isCurrent
    ? { revenue: pnl.revenue, cogs: pnl.cogs, expenses: pnl.expenses, netSales: pnl.netSales, totalCogs: pnl.totalCogs, grossProfit: pnl.grossProfit, grossMarginPct: pnl.grossMarginPct, totalExpenses: pnl.totalExpenses, netProfit: pnl.netProfit }
    : { revenue: pnl.revenue.map(s82), cogs: pnl.cogs.map(s82), expenses: pnl.expenses.map(s82), netSales: pnl.prev.netSales, totalCogs: pnl.prev.totalCogs, grossProfit: pnl.prev.grossProfit, grossMarginPct: pnl.prev.grossMarginPct, totalExpenses: pnl.prev.totalExpenses, netProfit: pnl.prev.netProfit };
  const maxExpense = Math.max(...view.expenses.map((e) => e.amount), 1);
  const bars = view.expenses.filter((e) => e.amount > 0);
  const trend = pnl.trendPct;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={sel} onValueChange={setSel}>
          <SelectTrigger className="w-[170px] bg-white" aria-label="Statement month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={month}>{fmtMonth(month)}</SelectItem>
            <SelectItem value={prevMonth}>{fmtMonth(prevMonth)} (est.)</SelectItem>
          </SelectContent>
        </Select>
        {!isCurrent && <Badge className="bg-[#FFF8E1] text-[#B8860B] hover:bg-[#FFF8E1]">Estimated - 82% of Sep run-rate</Badge>}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Panel className="lg:col-span-3">
          <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Profit &amp; Loss - {fmtMonth(sel)}</h3>
          <p className="text-[11px] text-[#6B778C]">Accrual statement from posted journals (VAT-exclusive)</p>
          <div className="mt-4 space-y-0.5">
            <p className="pt-1 text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Revenue</p>
            {view.revenue.map((l) => (
              <PnlRow key={l.code} label={`${l.code} ${l.name}`} value={l.amount} indent />
            ))}
            <PnlRow label="Net Sales" value={view.netSales} bold />
            <p className="pt-2 text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Cost of Goods Sold</p>
            {view.cogs.map((l) => (
              <PnlRow key={l.code} label={`${l.code} ${l.name}`} value={l.amount} indent />
            ))}
            <PnlRow label="Total COGS" value={view.totalCogs} bold />
            <div className="mt-2 flex items-center justify-between border-t-2 border-[#172B4D] py-2.5">
              <span className="text-[14px] font-bold text-[#172B4D]">Gross Profit</span>
              <span className="flex items-center gap-2">
                <span className="rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[10px] font-bold text-[#1B7A2E]">{view.grossMarginPct}% margin</span>
                <span className="text-[15px] font-bold tabular-nums text-[#172B4D]">{KES(view.grossProfit)}</span>
              </span>
            </div>
            <p className="pt-2 text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Operating Expenses</p>
            {view.expenses.map((l) => (
              <PnlRow key={l.code} label={`${l.code} ${l.name}`} value={l.amount} indent />
            ))}
            <PnlRow label="Total Expenses" value={view.totalExpenses} bold />
            <div className="mt-2 flex items-center justify-between border-t-2 border-[#172B4D] py-3">
              <span className="font-display text-[15px] font-bold text-[#172B4D]">Net Profit</span>
              <span className={cn("text-[18px] font-bold tabular-nums", view.netProfit >= 0 ? "text-[#1B7A2E]" : "text-[#FF5630]")}>{KES(view.netProfit)}</span>
            </div>
            {isCurrent ? (
              <div className="flex items-center gap-2 rounded-xl bg-[#F4F5F7] px-3 py-2 text-[12px]">
                <span className="text-[#6B778C]">vs {fmtMonth(prevMonth)}:</span>
                <span className={cn("inline-flex items-center gap-1 font-bold", trend >= 0 ? "text-[#1B7A2E]" : "text-[#FF5630]")}>
                  {trend >= 0 ? "▲" : "▼"} {trend >= 0 ? "+" : ""}
                  {trend.toFixed(1)}%
                </span>
                <span className="text-[11px] text-[#6B778C]">(Aug estimated at 82% of Sep)</span>
              </div>
            ) : (
              <p className="rounded-xl bg-[#F4F5F7] px-3 py-2 text-[12px] text-[#6B778C]">Approximate prior month - used for trend comparison only.</p>
            )}
          </div>
        </Panel>
        <Panel className="lg:col-span-2">
          <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Expense breakdown</h3>
          <p className="text-[11px] text-[#6B778C]">{fmtMonth(sel)} • share of max expense line</p>
          <div className="mt-4 space-y-3">
            {bars.length === 0 && <p className="text-[12px] text-[#6B778C]">No expenses posted for this period.</p>}
            {bars.map((e) => (
              <div key={e.code}>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="text-[#172B4D]">
                    <span className="font-mono text-[11px] text-[#6B778C]">{e.code}</span> {e.name}
                  </span>
                  <span className="font-semibold tabular-nums text-[#172B4D]">{KES(e.amount, true)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#F4F5F7]">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max((e.amount / maxExpense) * 100, 4)}%`, background: "#FF5630" }}
                  />
                </div>
              </div>
            ))}
          </div>
          <Separator className="my-4" />
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-[#6B778C]">Total expenses</span>
            <span className="font-bold tabular-nums text-[#172B4D]">{KES(view.totalExpenses)}</span>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ══ Balance Sheet tab ══════════════════════════════════════════════════════ */

/** A titled block of balance-sheet lines with a total footer (module level). */
function BsSection({ title, rows, total }: { title: string; rows: PnlLine[]; total: number }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">{title}</p>
      <div className="mt-1 space-y-0.5">
        {rows.map((l) => (
          <div key={l.code} className="flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors hover:bg-[#F4F5F7]/70">
            <span className="text-[13px] text-[#172B4D]">
              <span className="mr-2 font-mono text-[11px] text-[#6B778C]">{l.code}</span>
              {l.name}
            </span>
            <span className="text-[13px] tabular-nums text-[#172B4D]">{l.amount === 0 ? <span className="text-[#C1C7D0]">-</span> : KES(l.amount)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-[#DFE1E6] pt-2">
        <span className="text-[12px] font-bold uppercase tracking-wide text-[#6B778C]">Total {title}</span>
        <span className="text-[14px] font-bold tabular-nums text-[#172B4D]">{KES(total)}</span>
      </div>
    </div>
  );
}

function BalanceSheetTab({ bs }: { bs: AccPayload["balanceSheet"] }) {
  const le = Math.round((bs.totalLiabilities + bs.totalEquity) * 100) / 100;
  const balanced = Math.abs(bs.totalAssets - le) < 0.01;
  const CURRENT_CODES = new Set(["1010", "1020", "1030", "1100", "1300", "1400"]);
  const currentAssets = bs.assets.filter((a) => CURRENT_CODES.has(a.code)).reduce((t, a) => t + a.amount, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {balanced ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F5E9] px-3 py-1.5 text-[12px] font-bold text-[#1B7A2E]">
            <CheckCircle2 className="h-4 w-4" /> Balanced ✓ {KES(bs.totalAssets)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#FFEBEE] px-3 py-1.5 text-[12px] font-bold text-[#FF5630]">
            <XCircle className="h-4 w-4" /> Out by {KES(Math.abs(bs.totalAssets - le))}
          </span>
        )}
        {bs.bsAutoBalanced && (
          <span className="rounded-full border border-[#FFD591] bg-[#FFF8E1] px-3 py-1.5 text-[11px] font-semibold text-[#8B6D00]">
            Net result carried into Retained Earnings (3200) to balance
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <div className="mb-3 flex items-center gap-2">
            <Boxes className="h-4 w-4 text-[#00C853]" />
            <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Assets</h3>
          </div>
          <BsSection title="Assets" rows={bs.assets} total={bs.totalAssets} />
          <div className="mt-3 rounded-xl bg-[#E8F5E9]/60 px-3 py-2 text-[12px]">
            <span className="font-semibold text-[#1B7A2E]">Current assets: {KES(currentAssets)}</span>
            <span className="text-[#6B778C]"> - cash, tills, bank, debtors &amp; VAT input</span>
          </div>
        </Panel>
        <div className="space-y-4">
          <Panel>
            <div className="mb-3 flex items-center gap-2">
              <Landmark className="h-4 w-4 text-[#FFAB00]" />
              <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Liabilities</h3>
            </div>
            <BsSection title="Liabilities" rows={bs.liabilities} total={bs.totalLiabilities} />
          </Panel>
          <Panel>
            <div className="mb-3 flex items-center gap-2">
              <Scale className="h-4 w-4 text-[#172B4D]" />
              <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Equity</h3>
            </div>
            <BsSection title="Equity" rows={bs.equity} total={bs.totalEquity} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ══ Bank Reconciliation tab ════════════════════════════════════════════════ */

function BankReconTab({ recon, ledgerCash }: { recon: AccPayload["bankRecon"]; ledgerCash: number }) {
  const [demo, setDemo] = useState<Record<number, boolean>>({});
  const rows = useMemo(
    () => recon.statement.map((s) => ({ ...s, effMatched: s.matched || !!demo[s.id], isDemo: !s.matched && !!demo[s.id] })),
    [recon.statement, demo]
  );
  const summary = useMemo(() => {
    const m = rows.filter((r) => r.effMatched);
    const u = rows.filter((r) => !r.effMatched);
    const amt = (list: typeof rows) => Math.round(list.reduce((t, r) => t + r.amount, 0) * 100) / 100;
    return {
      matched: m.length,
      unmatched: u.length,
      matchedAmount: amt(m),
      unmatchedAmount: amt(u),
      matchPct: rows.length ? Math.round((m.length / rows.length) * 1000) / 10 : 0,
      statementTotal: amt(rows),
    };
  }, [rows]);

  const matchLine = (r: (typeof rows)[number]) => {
    setDemo((d) => ({ ...d, [r.id]: true }));
    toast({ title: "Demo match", description: `${r.ref} marked matched to a journal - demo only, nothing is saved.` });
  };

  const diff = Math.round((ledgerCash - summary.statementTotal) * 100) / 100;
  const stats = [
    { label: "Match rate", value: `${summary.matchPct}%`, color: "text-[#0052CC]", bg: "#E9F2FF" },
    { label: "Matched", value: KES(summary.matchedAmount), color: "text-[#1B7A2E]", bg: "#E8F5E9" },
    { label: "Unmatched lines", value: String(summary.unmatched), color: "text-[#FF5630]", bg: "#FFEBEE" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-[#DFE1E6] bg-white p-4 shadow-sm" style={{ background: `linear-gradient(180deg, ${s.bg}33 0%, #ffffff 55%)` }}>
            <p className={cn("font-display text-lg font-bold tabular-nums", s.color)}>{s.value}</p>
            <p className="mt-0.5 text-[12px] text-[#6B778C]">{s.label}</p>
          </div>
        ))}
      </div>
      <Panel padding={false}>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-4 md:px-6 md:pt-6">
          <Landmark className="h-4 w-4 text-[#0052CC]" />
          <h3 className="font-display text-[15px] font-bold text-[#172B4D]">M-Pesa Till statement</h3>
          <span className="text-[11px] text-[#6B778C]">{recon.statement[0]?.till ?? "-"}</span>
          <span className="ml-auto text-[11px] text-[#6B778C]">newest first</span>
        </div>
        <div className={cn("mt-3 px-4 pb-4 md:px-6 md:pb-6", SCROLL)}>
          <div className="overflow-x-auto rounded-xl border border-[#DFE1E6]">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F4F5F7]/70">
                  <TableHead className="h-8 text-[11px]">Date</TableHead>
                  <TableHead className="h-8 text-[11px]">Ref</TableHead>
                  <TableHead className="h-8 text-[11px]">Description</TableHead>
                  <TableHead className="h-8 text-right text-[11px]">Amount</TableHead>
                  <TableHead className="h-8 text-[11px]">Status</TableHead>
                  <TableHead className="h-8 text-right text-[11px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="py-1.5 text-[12px] text-[#6B778C]">{fmtDate(r.date)}</TableCell>
                    <TableCell className="py-1.5 font-mono text-[11px] text-[#6B778C]">{r.ref}</TableCell>
                    <TableCell className="py-1.5 text-[12px] text-[#172B4D]">{r.description}</TableCell>
                    <TableCell className={cn("py-1.5 text-right text-[12px] font-semibold tabular-nums", r.amount >= 0 ? "text-[#1B7A2E]" : "text-[#FF5630]")}>
                      {r.amount >= 0 ? "+" : "−"}
                      {KES(Math.abs(r.amount))}
                    </TableCell>
                    <TableCell className="py-1.5">
                      {r.effMatched ? (
                        <span className="inline-flex flex-wrap items-center gap-1">
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[10px] font-bold text-[#1B7A2E]">
                            <CheckCircle2 className="h-3 w-3" /> Matched{r.isDemo ? " • demo" : ""}
                          </span>
                          {r.matchRef && <Badge className="bg-[#E9F2FF] font-mono text-[10px] text-[#0052CC] hover:bg-[#E9F2FF]">→ {r.matchRef}</Badge>}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#FFEBEE] px-2 py-0.5 text-[10px] font-bold text-[#FF5630]">
                          <XCircle className="h-3 w-3" /> Unmatched
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-1.5 text-right">
                      {!r.effMatched && (
                        <Button size="sm" variant="outline" className="h-7 border-[#C9CFDA] px-2 text-[11px] text-[#0052CC] hover:bg-[#E9F2FF] hover:text-[#0052CC]" onClick={() => matchLine(r)}>
                          <Link2 className="h-3 w-3" /> Match to journal
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </Panel>
      <Panel>
        <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Bank balance check</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[#DFE1E6] bg-[#F4F5F7]/50 px-3 py-2.5">
            <p className="text-[11px] text-[#6B778C]">Statement total</p>
            <p className="text-[14px] font-bold tabular-nums text-[#172B4D]">{KES(summary.statementTotal)}</p>
          </div>
          <div className="rounded-xl border border-[#DFE1E6] bg-[#F4F5F7]/50 px-3 py-2.5">
            <p className="text-[11px] text-[#6B778C]">Ledger cash - 1030 M-Pesa Till</p>
            <p className="text-[14px] font-bold tabular-nums text-[#172B4D]">{KES(ledgerCash)}</p>
          </div>
          <div className="rounded-xl border border-[#FFD591] bg-[#FFF8E1] px-3 py-2.5">
            <p className="text-[11px] text-[#8B6D00]">Difference</p>
            <p className="text-[14px] font-bold tabular-nums text-[#8B6D00]">{KES(Math.abs(diff))}</p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-[#6B778C]">
          Statement covers recent M-Pesa activity only; the ledger carries the full till history - opening float plus posted sales.
        </p>
      </Panel>
    </div>
  );
}

/* ══ main screen ════════════════════════════════════════════════════════════ */

export default function AccountingScreen() {
  const [data, setData] = useState<AccPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<AccPayload>("/api/accounting"));
    } catch (e) {
      toast({ title: "Could not load accounting", description: err(e) });
      setError(err(e));
    }
  }, []);

  useEffect(() => {
    // async boundary: the loader touches state, so never call it synchronously here
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  /* ── loading / error states ─────────────────────────────────────────────── */
  if (error && !data) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <ScreenHeader title="Accounting" subtitle="Double-entry ledger - journals, trial balance & statutory reports" />
        <EmptyState
          icon={<AlertTriangle className="h-5 w-5" />}
          title="Could not load accounting data"
          sub={error}
          action={
            <Button onClick={() => void load()} className="bg-[#0052CC] text-white hover:bg-[#0747A6]">
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const pnl = data?.pnl;
  const recon = data?.bankRecon.summary;
  const stock = data?.stockValuation;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <ScreenHeader title="Accounting" subtitle="Double-entry ledger - journals, trial balance & statutory reports" />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} label="Gross Profit" value={pnl ? KES(pnl.grossProfit) : ""} sub={pnl ? `${pnl.grossMarginPct}% margin` : undefined} iconBg="#E8F5E9" iconColor="#00C853" loading={!pnl} />
        <KpiCard
          icon={<Wallet className="h-4 w-4" />}
          label="Net Profit"
          value={pnl ? KES(pnl.netProfit) : ""}
          sub={pnl ? `vs Aug 2026: ${pnl.trendPct >= 0 ? "+" : ""}${pnl.trendPct.toFixed(1)}%` : undefined}
          iconBg="#E9F2FF"
          iconColor="#0052CC"
          loading={!pnl}
        />
        <KpiCard icon={<Boxes className="h-4 w-4" />} label="Stock Value (FIFO)" value={stock ? KES(stock.total) : ""} sub={stock ? `${stock.skuCount} SKUs on hand` : undefined} iconBg="#FFF8E1" iconColor="#B8860B" loading={!stock} />
        <KpiCard icon={<Landmark className="h-4 w-4" />} label="Bank Match Rate" value={recon ? `${recon.matchPct}%` : ""} sub={recon ? `${recon.matched} matched • ${recon.unmatched} to review` : undefined} iconBg="#F4F5F7" iconColor="#172B4D" loading={!recon} />
      </div>

      {!data ? (
        <Panel>
          <TableSkeleton rows={8} cols={5} />
        </Panel>
      ) : (
        <Tabs defaultValue="coa" className="gap-4">
          <TabsList className="h-auto w-full max-w-full justify-start gap-1 overflow-x-auto rounded-xl border border-[#DFE1E6] bg-white p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsTrigger value="coa" className="flex-none px-3 py-1.5 text-[12px]">Chart of Accounts</TabsTrigger>
            <TabsTrigger value="ledger" className="flex-none px-3 py-1.5 text-[12px]">General Ledger</TabsTrigger>
            <TabsTrigger value="daily" className="flex-none px-3 py-1.5 text-[12px]">Daily Sales Journals</TabsTrigger>
            <TabsTrigger value="stock" className="flex-none px-3 py-1.5 text-[12px]">Stock Accounts</TabsTrigger>
            <TabsTrigger value="tb" className="flex-none px-3 py-1.5 text-[12px]">Trial Balance</TabsTrigger>
            <TabsTrigger value="pnl" className="flex-none px-3 py-1.5 text-[12px]">Profit &amp; Loss</TabsTrigger>
            <TabsTrigger value="bs" className="flex-none px-3 py-1.5 text-[12px]">Balance Sheet</TabsTrigger>
            <TabsTrigger value="bank" className="flex-none px-3 py-1.5 text-[12px]">Bank Reconciliation</TabsTrigger>
          </TabsList>

          <TabsContent value="coa">
            <CoaTab coa={data.coa} />
          </TabsContent>
          <TabsContent value="ledger">
            <GeneralLedgerTab journals={data.journals} stores={data.stores} />
          </TabsContent>
          <TabsContent value="daily">
            <DailyJournalsTab entries={data.dailySalesJournals} today={data.today} stores={data.stores} />
          </TabsContent>
          <TabsContent value="stock">
            <StockAccountsTab stock={data.stockValuation} />
          </TabsContent>
          <TabsContent value="tb">
            <TrialBalanceTab rows={data.trialBalance} totals={data.tbTotals} autoBalanced={data.tbAutoBalanced} adjustment={data.tbAdjustment} today={data.today} />
          </TabsContent>
          <TabsContent value="pnl">
            <PnlTab pnl={data.pnl} month={data.month} />
          </TabsContent>
          <TabsContent value="bs">
            <BalanceSheetTab bs={data.balanceSheet} />
          </TabsContent>
          <TabsContent value="bank">
            <BankReconTab recon={data.bankRecon} ledgerCash={data.ledgerCash} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
