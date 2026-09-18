"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft, ChevronRight, Gift, HandCoins, Plus, Search, Sparkles, Tags, Users, Send,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { CustomerDto, DebtPlanDto, GiftCardDto, KES, SettingsDto, SmsLogDto, Tier } from "@/types";
import { ScreenHeader, KpiCard, Panel, EmptyState, TableSkeleton } from "@/components/df/shared";
import { TierBadge, KraBadge, OverdueBadge } from "@/components/df/badges";
import { QrImage } from "@/components/df/qr";
import { DukaMark } from "@/components/df/logo";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

/* ── types ────────────────────────────────────────────────── */

interface CustomerSale {
  id: number;
  receiptNo: string;
  total: number;
  paymentMethod: string;
  kraStatus: string;
  createdAt: string;
}

interface GiftCardWithQr extends GiftCardDto {
  qr: string;
}

interface CustomerDetail {
  customer: CustomerDto;
  sales: CustomerSale[];
  debtPlans: DebtPlanDto[];
  giftCards: GiftCardDto[];
  smsLogs: SmsLogDto[];
  spendByMonth: { month: string; spend: number }[];
  stats: { visits: number; avgBasket: number; lifetimeValue: number };
}

const TIERS: Tier[] = ["Gold", "Silver", "Bronze"];

const TIER_AVATAR: Record<string, { bg: string; fg: string }> = {
  Gold: { bg: "#FFF8E1", fg: "#B8860B" },
  Silver: { bg: "#ECEFF1", fg: "#546E7A" },
  Bronze: { bg: "#EFEBE9", fg: "#8D6E63" },
};

const GRADIENTS = ["blue-green", "navy", "gold", "blue", "green", "navy-gold"] as const;

const GC_CLASS: Record<(typeof GRADIENTS)[number], string> = {
  "blue-green": "df-gc-blue-green",
  navy: "df-gc-navy",
  gold: "df-gc-gold",
  blue: "df-gc-blue",
  green: "df-gc-green",
  "navy-gold": "df-gc-navy-gold",
};

const GRADIENT_HEX: Record<(typeof GRADIENTS)[number], string> = {
  "blue-green": "linear-gradient(135deg,#0052cc,#00c853)",
  navy: "linear-gradient(135deg,#172b4d,#0052cc)",
  gold: "linear-gradient(135deg,#b8860b,#ffd700)",
  blue: "linear-gradient(135deg,#0052cc,#2684ff)",
  green: "linear-gradient(135deg,#00875a,#00c853)",
  "navy-gold": "linear-gradient(135deg,#172b4d,#b8860b)",
};

interface TierRule {
  name: string;
  min: string;
  discount: number;
  perk: string;
  color: string;
}

const DEFAULT_TIER_RULES: TierRule[] = [
  { name: "Bronze", min: "0", discount: 0, perk: "Welcome", color: "#8D6E63" },
  { name: "Silver", min: "500", discount: 5, perk: "Free Delivery", color: "#78909C" },
  { name: "Gold", min: "2000", discount: 10, perk: "Priority + Birthday", color: "#FFD700" },
];

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/* ── helpers ──────────────────────────────────────────────── */

const initials = (name: string) =>
  name.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const fmtExpiry = (iso: string | null) => {
  if (!iso) return "No expiry";
  const d = new Date(iso);
  return `Exp ${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
};

const isExpired = (iso: string | null) => !!iso && new Date(iso).getTime() < Date.now();

/* ── screen ───────────────────────────────────────────────── */

export default function CustomersScreen() {
  const [all, setAll] = useState<CustomerDto[] | null>(null);
  const [q, setQ] = useState("");
  const [tierFilter, setTierFilter] = useState<"All" | Tier>("All");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState("customers");

  /* new customer */
  const [adding, setAdding] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [newC, setNewC] = useState({ name: "", phone: "", creditLimit: "" });

  const loadCustomers = useCallback(async () => {
    try {
      setAll(await api.get<CustomerDto[]>("/api/customers"));
    } catch (e) {
      toast({ title: "Could not load customers", description: err(e) });
      setAll([]);
    }
  }, []);

  useEffect(() => {
    // async boundary: the loader touches state, so never call it synchronously here
    const t = setTimeout(() => void loadCustomers(), 0);
    return () => clearTimeout(t);
  }, [loadCustomers]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (all ?? []).filter(
      (c) =>
        (tierFilter === "All" || c.tier === tierFilter) &&
        (!needle || c.name.toLowerCase().includes(needle) || c.phone.includes(needle))
    );
  }, [all, q, tierFilter]);

  const kpis = useMemo(
    () => ({
      total: all?.length ?? 0,
      gold: (all ?? []).filter((c) => c.tier === "Gold").length,
      debt: (all ?? []).filter((c) => c.debtBalance > 0).length,
    }),
    [all]
  );

  const addCustomer = useCallback(async () => {
    if (!newC.name.trim() || !newC.phone.trim()) {
      toast({ title: "Name and phone are required" });
      return;
    }
    setAddBusy(true);
    try {
      await api.post<CustomerDto>("/api/customers", {
        name: newC.name.trim(),
        phone: newC.phone.trim(),
        creditLimit: Number(newC.creditLimit || 0),
      });
      toast({ title: "Customer added", description: `${newC.name.trim()} joined at Bronze tier.` });
      setAdding(false);
      setNewC({ name: "", phone: "", creditLimit: "" });
      await loadCustomers();
    } catch (e) {
      toast({ title: "Could not add customer", description: err(e) });
    } finally {
      setAddBusy(false);
    }
  }, [newC, loadCustomers]);

  return (
    <div className="space-y-4">
      <ScreenHeader
        title="Customers & Loyalty"
        subtitle="2,450+ customers • Tiers • Gift cards"
        actions={
          <Button
            onClick={() => setAdding(true)}
            className="h-9 rounded-xl bg-[#0052CC] px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-[#0041A8]"
          >
            <Plus size={15} /> New Customer
          </Button>
        }
      />

      {selectedId !== null ? (
        <CustomerDetail customerId={selectedId} onBack={() => setSelectedId(null)} onChanged={loadCustomers} />
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
            <KpiCard icon={<Users size={17} />} label="Total customers" value={all ? String(kpis.total) : "-"} loading={!all} />
            <KpiCard
              icon={<Sparkles size={17} />}
              label="Gold tier"
              value={all ? String(kpis.gold) : "-"}
              loading={!all}
              iconBg="#FFF8E1"
              iconColor="#B8860B"
            />
            <KpiCard
              icon={<HandCoins size={17} />}
              label="Customers with debt"
              value={all ? String(kpis.debt) : "-"}
              loading={!all}
              iconBg="#FFEBEE"
              iconColor="#FF5630"
            />
          </div>

          <Tabs value={tab} onValueChange={setTab} className="gap-4">
            <TabsList className="h-auto w-fit rounded-2xl border border-[#DFE1E6] bg-white p-2">
              {[
                { id: "customers", label: "Customers" },
                { id: "loyalty", label: "Loyalty Program" },
                { id: "giftcards", label: "Gift Cards" },
                { id: "price", label: "Price Groups" },
              ].map((t) => (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className="rounded-xl px-4 py-2 text-[13px] font-semibold data-[state=active]:bg-[#172B4D] data-[state=active]:text-white"
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* ── Customers tab ── */}
            <TabsContent value="customers" className="mt-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-1.5">
                  {(["All", ...TIERS] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTierFilter(t)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-[11px] font-semibold transition",
                        tierFilter === t
                          ? "border-[#0052CC] bg-white text-[#0052CC] shadow-sm"
                          : "border-[#DFE1E6] bg-[#FAFBFC] text-[#6B778C] hover:text-[#172B4D]"
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B778C]" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search name or phone…"
                    className="h-9 w-56 rounded-xl border-[#DFE1E6] bg-white pl-8 text-[12px]"
                  />
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-[#DFE1E6] bg-white shadow-sm">
                {!all ? (
                  <div className="p-4"><TableSkeleton rows={6} cols={6} /></div>
                ) : filtered.length === 0 ? (
                  <div className="p-6">
                    <EmptyState icon={<Users size={22} />} title="No customers match" sub="Try another name, phone or tier filter." />
                  </div>
                ) : (
                  <Table className="text-[12px]">
                    <TableHeader>
                      <TableRow className="bg-[#FAFBFC] hover:bg-[#FAFBFC]">
                        {["Customer", "Tier", "Lifetime spend", "Points", "Debt", "Gift balance", "Last visit", ""].map((h, i) => (
                          <TableHead key={i} className="p-3 text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((c) => (
                        <TableRow
                          key={c.id}
                          onClick={() => setSelectedId(c.id)}
                          className="cursor-pointer border-t border-[#F4F5F7] hover:bg-[#FAFBFC]"
                        >
                          <TableCell className="p-3">
                            <div className="flex items-center gap-2.5">
                              <span
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                                style={{ background: TIER_AVATAR[c.tier]?.bg, color: TIER_AVATAR[c.tier]?.fg }}
                              >
                                {initials(c.name)}
                              </span>
                              <span>
                                <span className="block font-semibold text-[#172B4D]">{c.name}</span>
                                <span className="block text-[11px] text-[#0052CC]">{c.phone}</span>
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="p-3"><TierBadge tier={c.tier} /></TableCell>
                          <TableCell className="font-display p-3 font-semibold text-[#172B4D]">{KES(c.totalSpent)}</TableCell>
                          <TableCell className="p-3">
                            <span className="inline-flex items-center gap-1 font-semibold">
                              <Sparkles size={12} className="text-[#B8860B]" /> {c.loyaltyPoints.toLocaleString()}
                            </span>
                          </TableCell>
                          <TableCell className={cn("p-3 font-bold", c.debtBalance > 0 ? "text-[#FF5630]" : "text-[#6B778C]")}>
                            {c.debtBalance > 0 ? KES(c.debtBalance) : "-"}
                          </TableCell>
                          <TableCell className="p-3">{c.giftCardBalance > 0 ? KES(c.giftCardBalance) : "-"}</TableCell>
                          <TableCell className="p-3 text-[#6B778C]">{c.lastVisit ?? "-"}</TableCell>
                          <TableCell className="p-3 text-right"><ChevronRight size={15} className="inline text-[#6B778C]" /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </TabsContent>

            {/* ── Loyalty Program tab ── */}
            <TabsContent value="loyalty" className="mt-0">
              <LoyaltyProgram />
            </TabsContent>

            {/* ── Gift Cards tab ── */}
            <TabsContent value="giftcards" className="mt-0">
              <GiftCardsTab customers={all ?? []} />
            </TabsContent>

            {/* ── Price Groups tab ── */}
            <TabsContent value="price" className="mt-0">
              <EmptyState
                icon={<Tags size={22} />}
                title="Price groups - wholesale/retail tiers"
                sub="Assign group pricing per customer group. Coming in v2.5"
                action={
                  <Button
                    variant="ghost"
                    onClick={() => toast({ title: "You're on the list 🛎️", description: "We'll ping you when Price Groups ships in v2.5." })}
                    className="rounded-xl text-[13px] font-semibold text-[#0052CC] hover:bg-[#E9F2FF] hover:text-[#0052CC]"
                  >
                    <Send size={14} /> Notify me
                  </Button>
                }
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* ── new customer dialog ── */}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="rounded-2xl sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="font-display text-[16px] font-bold text-[#172B4D]">New Customer</DialogTitle>
            <DialogDescription className="text-[12px] text-[#6B778C]">
              Walk-in sign-up - starts at <b>Bronze</b> with 0 points.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="nc-name" className="text-[12px] font-semibold text-[#172B4D]">Full name *</Label>
              <Input id="nc-name" value={newC.name} onChange={(e) => setNewC({ ...newC, name: e.target.value })} placeholder="e.g. Wanjiku Mwangi" className="h-10 rounded-xl bg-[#FAFBFC]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="nc-phone" className="text-[12px] font-semibold text-[#172B4D]">Phone *</Label>
                <Input id="nc-phone" value={newC.phone} onChange={(e) => setNewC({ ...newC, phone: e.target.value })} placeholder="07xx xxx xxx" className="h-10 rounded-xl bg-[#FAFBFC]" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="nc-limit" className="text-[12px] font-semibold text-[#172B4D]">Credit limit (KES)</Label>
                <Input id="nc-limit" type="number" min={0} value={newC.creditLimit} onChange={(e) => setNewC({ ...newC, creditLimit: e.target.value })} placeholder="0" className="h-10 rounded-xl bg-[#FAFBFC]" />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAdding(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={() => void addCustomer()} disabled={addBusy} className="rounded-xl bg-[#0052CC] text-white hover:bg-[#0041A8]">
              {addBusy ? "Adding…" : "Add customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── customer detail view ─────────────────────────────────── */

function CustomerDetail({
  customerId,
  onBack,
  onChanged,
}: {
  customerId: number;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [smsOpen, setSmsOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<CustomerDetail>(`/api/customers/${customerId}`)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setNotesDraft(d.customer.notes ?? "");
      })
      .catch((e: unknown) => toast({ title: "Could not load customer", description: err(e) }));
    return () => {
      alive = false;
    };
  }, [customerId]);

  const saveNotes = useCallback(async () => {
    if (!detail || notesDraft === (detail.customer.notes ?? "")) return;
    try {
      await api.patch<CustomerDto>(`/api/customers/${detail.customer.id}`, { notes: notesDraft });
      setDetail({ ...detail, customer: { ...detail.customer, notes: notesDraft } });
      toast({ title: "Notes saved" });
      onChanged();
    } catch (e) {
      toast({ title: "Could not save notes", description: err(e) });
    }
  }, [detail, notesDraft, onChanged]);

  if (!detail) {
    return (
      <div className="space-y-3">
        <button onClick={onBack} className="flex items-center gap-2 text-[13px] font-semibold text-[#0052CC] hover:underline">
          <ChevronLeft size={16} /> Back to Customers
        </button>
        <div className="rounded-2xl border border-[#DFE1E6] bg-white p-4 shadow-sm"><TableSkeleton rows={6} cols={5} /></div>
      </div>
    );
  }

  const c = detail.customer;
  const ava = TIER_AVATAR[c.tier] ?? TIER_AVATAR.Bronze;
  const stats = [
    { label: "Lifetime value", value: KES(detail.stats.lifetimeValue) },
    { label: "Avg basket", value: KES(detail.stats.avgBasket) },
    { label: "Visits", value: String(detail.stats.visits) },
    { label: "Points", value: c.loyaltyPoints.toLocaleString() },
    { label: "Debt", value: KES(c.debtBalance), danger: c.debtBalance > 0 },
    { label: "Gift balance", value: KES(c.giftCardBalance) },
  ];

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-2 text-[13px] font-semibold text-[#0052CC] hover:underline">
        <ChevronLeft size={16} /> Back to Customers
      </button>

      {/* header card */}
      <div className="rounded-2xl border border-[#DFE1E6] bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-wrap items-start gap-5">
          <span
            className="flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-bold"
            style={{ background: ava.bg, color: ava.fg }}
          >
            {initials(c.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-[20px] font-bold text-[#172B4D]">{c.name}</h2>
              <TierBadge tier={c.tier} />
            </div>
            <p className="mt-1 text-[13px] text-[#6B778C]">
              {c.phone} • Credit limit {KES(c.creditLimit)} • Last visit {c.lastVisit ?? "-"}
            </p>
          </div>
          <div className="w-full max-w-sm">
            <Label htmlFor="cust-notes" className="text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">Notes</Label>
            <Textarea
              id="cust-notes"
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={saveNotes}
              placeholder="Preferences, credit history, site address…"
              className="mt-1.5 min-h-[64px] rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[12px]"
            />
            <p className="mt-1 text-[10px] text-[#6B778C]">Saved automatically when you click away.</p>
          </div>
        </div>
      </div>

      {/* 6 stat tiles */}
      <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @6xl:grid-cols-6">
        {stats.map((s) => (
          <div
            key={s.label}
            className={cn(
              "rounded-xl border p-3",
              s.danger ? "border-[#FFCDD2] bg-[#FFEBEE]" : "border-[#DFE1E6] bg-[#FAFBFC]"
            )}
          >
            <p className={cn("text-[11px] uppercase tracking-wide", s.danger ? "text-[#C62828]" : "text-[#6B778C]")}>{s.label}</p>
            <p className={cn("font-display mt-1 text-[15px] font-bold", s.danger ? "text-[#C62828]" : "text-[#172B4D]")}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 @6xl:grid-cols-3">
        {/* left: chart + purchases */}
        <div className="space-y-4 @6xl:col-span-2">
          <Panel className="p-4 md:p-5">
            <h4 className="font-display text-[14px] font-bold text-[#172B4D]">Spend • Last 6 Months</h4>
            <div className="mt-3 h-[190px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={detail.spendByMonth} margin={{ top: 4, right: 4, bottom: 0, left: -14 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#DFE1E6" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6B778C" }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#6B778C" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                  />
                  <Tooltip
                    formatter={(value: number | string) => KES(Number(value))}
                    contentStyle={{ borderRadius: 12, border: "1px solid #DFE1E6", fontSize: 12 }}
                    cursor={{ fill: "rgba(0,82,204,0.06)" }}
                  />
                  <Bar dataKey="spend" fill="#0052CC" radius={[6, 6, 0, 0]} maxBarSize={38} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel padding={false} className="overflow-hidden">
            <div className="border-b border-[#DFE1E6] p-4 pb-3">
              <h4 className="font-display text-[14px] font-bold text-[#172B4D]">Recent Purchases</h4>
            </div>
            {detail.sales.length === 0 ? (
              <div className="p-6"><EmptyState icon={<Gift size={20} />} title="No purchases yet" sub="Sales will appear here after the first checkout." /></div>
            ) : (
              <Table className="text-[12px]">
                <TableHeader>
                  <TableRow className="bg-[#FAFBFC] hover:bg-[#FAFBFC]">
                    {["Receipt", "Date", "Total", "Payment", "KRA"].map((h) => (
                      <TableHead key={h} className="p-3 text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.sales.slice(0, 10).map((s) => (
                    <TableRow key={s.id} className="border-t border-[#F4F5F7] hover:bg-[#FAFBFC]">
                      <TableCell className="p-3 font-mono font-semibold text-[#172B4D]">{s.receiptNo}</TableCell>
                      <TableCell className="p-3 text-[#6B778C]">{fmtDay(s.createdAt)}</TableCell>
                      <TableCell className="font-display p-3 font-bold text-[#172B4D]">{KES(s.total)}</TableCell>
                      <TableCell className="p-3">{s.paymentMethod}</TableCell>
                      <TableCell className="p-3"><KraBadge status={s.kraStatus} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </div>

        {/* right: debt plans, gift cards, sms */}
        <div className="space-y-4">
          <Panel className="p-4 md:p-5">
            <h4 className="font-display text-[14px] font-bold text-[#172B4D]">Debt Plans</h4>
            <div className="mt-3 space-y-2">
              {detail.debtPlans.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#DFE1E6] p-4 text-center text-[12px] text-[#6B778C]">No credit plans - clean slate 🎉</p>
              ) : (
                detail.debtPlans.map((p) => (
                  <div key={p.id} className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-semibold text-[#172B4D]">{p.invoiceNo ?? `PLAN-${p.id}`}</span>
                      <OverdueBadge days={p.overdueDays} />
                    </div>
                    <p className="mt-1.5 text-[12px] text-[#172B4D]">
                      <b>{KES(p.totalDebt)}</b> • {KES(p.installmentAmount)} / {p.installmentType.toLowerCase()}
                    </p>
                    <p className="text-[11px] text-[#6B778C]">
                      Next due {fmtDay(p.nextDueDate)} • {p.status}
                      {p.autoReminderSms ? " • Auto-SMS on" : ""}
                    </p>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel className="p-4 md:p-5">
            <h4 className="font-display text-[14px] font-bold text-[#172B4D]">Gift Cards</h4>
            <div className="mt-3 space-y-2">
              {detail.giftCards.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#DFE1E6] p-4 text-center text-[12px] text-[#6B778C]">No gift cards issued to this customer.</p>
              ) : (
                detail.giftCards.map((g) => (
                  <div key={g.id} className="flex items-center gap-3 rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
                    <div className="rounded-lg bg-white p-1 shadow-sm">
                      <QrImage text={`DUKAFLOW-GIFT:${g.code}:${g.balance}`} size={56} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] font-semibold text-[#172B4D]">{g.code} • {fmtExpiry(g.expiry)}</p>
                      <p className="font-display text-[15px] font-bold text-[#172B4D]">{KES(g.balance)}</p>
                      <span className="mt-0.5 inline-block rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-[#6B778C]">{g.status}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel className="p-4 md:p-5">
            <button onClick={() => setSmsOpen((v) => !v)} className="flex w-full items-center justify-between">
              <h4 className="font-display text-[14px] font-bold text-[#172B4D]">SMS History ({detail.smsLogs.length})</h4>
              <ChevronRight size={15} className={cn("text-[#6B778C] transition", smsOpen && "rotate-90")} />
            </button>
            {smsOpen && (
              <div className="mt-3 space-y-2">
                {detail.smsLogs.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[#DFE1E6] p-4 text-center text-[12px] text-[#6B778C]">No messages sent yet.</p>
                ) : (
                  detail.smsLogs.map((m) => (
                    <div key={m.id} className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded-full bg-[#E9F2FF] px-2 py-0.5 text-[10px] font-bold text-[#0052CC]">{m.type}</span>
                        <span className="text-[10px] text-[#6B778C]">{fmtDay(m.createdAt)}</span>
                      </div>
                      <p className="mt-1.5 text-[12px] text-[#172B4D]">{m.message}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ── loyalty program tab ──────────────────────────────────── */

function LoyaltyProgram() {
  const [loaded, setLoaded] = useState(false);
  const [earnPerKes, setEarnPerKes] = useState("100");
  const [pointValue, setPointValue] = useState("1");
  const [expiryMonths, setExpiryMonths] = useState("12");
  const [expiryOn, setExpiryOn] = useState(true);
  const [tierUpgrade, setTierUpgrade] = useState(true);
  const [tiers, setTiers] = useState<TierRule[]>(DEFAULT_TIER_RULES);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<SettingsDto>("/api/settings")
      .then((s) => {
        if (!s) return;
        setEarnPerKes(String(s.loyaltyEarnPerKes ?? 100));
        setPointValue(String(s.loyaltyPointValue ?? 1));
        setExpiryMonths(String(s.loyaltyExpiryMonths ?? 12));
        // restore persisted tier rules (JSON in Settings.tierRules)
        try {
          const rules = JSON.parse(s.tierRules || "{}") as {
            bronze?: { minPoints: number; discount: number };
            silver?: { minPoints: number; discount: number };
            gold?: { minPoints: number; discount: number };
          };
          setTiers((cur) =>
            cur.map((t) => {
              const key = t.name.toLowerCase() as "bronze" | "silver" | "gold";
              const r = rules[key];
              return r ? { ...t, min: String(r.minPoints), discount: r.discount } : t;
            })
          );
        } catch {
          /* keep defaults */
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const saveRules = useCallback(async () => {
    setSaving(true);
    try {
      await api.put<{ ok: boolean }>("/api/settings", {
        loyaltyEarnPerKes: Number(earnPerKes) || 100,
        loyaltyPointValue: Number(pointValue) || 1,
        loyaltyExpiryMonths: Number(expiryMonths) || 12,
      });
      toast({ title: "Loyalty rules saved", description: "New checkouts earn points with these rules." });
    } catch (e) {
      toast({ title: "Could not save rules", description: err(e) });
    } finally {
      setSaving(false);
    }
  }, [earnPerKes, pointValue, expiryMonths]);

  const saveTiers = useCallback(async () => {
    try {
      const payload = {
        tierRules: JSON.stringify({
          bronze: {
            minPoints: Number(tiers[0]?.min) || 0,
            discount: tiers[0]?.discount ?? 0,
          },
          silver: {
            minPoints: Number(tiers[1]?.min) || 500,
            discount: tiers[1]?.discount ?? 5,
          },
          gold: {
            minPoints: Number(tiers[2]?.min) || 2000,
            discount: tiers[2]?.discount ?? 10,
          },
          expiryMonths: Number(expiryMonths) || 12,
          expiryEnabled: expiryOn,
        }),
      };
      await api.put<{ ok: boolean }>("/api/settings", payload);
      toast({ title: "Tiers saved", description: "Bronze/Silver/Gold thresholds persist for all stores and POS terminals." });
    } catch (e) {
      toast({ title: "Could not save tiers", description: err(e) });
    }
  }, [tiers, expiryMonths, expiryOn]);

  const ruleInput = "h-9 w-[84px] rounded-full border-[#DFE1E6] bg-white px-3 text-center text-[13px] font-bold";

  return (
    <div className="grid grid-cols-1 gap-4 @6xl:grid-cols-12">
      {/* rules builder */}
      <Panel className="@6xl:col-span-7">
        <h4 className="font-display text-[14px] font-bold text-[#172B4D]">Program Rules - visual rule builder</h4>
        {!loaded ? (
          <div className="mt-3 space-y-2">
            <div className="h-16 animate-pulse rounded-xl bg-[#F4F5F7]" />
            <div className="h-16 animate-pulse rounded-xl bg-[#F4F5F7]" />
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-4 text-[13px] text-[#172B4D]">
              <span>Give</span>
              <span className="rounded-full border border-[#DFE1E6] bg-white px-3 py-1 text-[12px] font-bold">1</span>
              <span>point for every</span>
              <Input value={earnPerKes} onChange={(e) => setEarnPerKes(e.target.value)} type="number" min={1} className={ruleInput} aria-label="KES spent per point" />
              <span>KES spent</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-4 text-[13px] text-[#172B4D]">
              <span>1 point =</span>
              <Input value={pointValue} onChange={(e) => setPointValue(e.target.value)} type="number" min={0} step="0.5" className={ruleInput} aria-label="KES per redeemed point" />
              <span>KES when redeemed</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-4 text-[13px] text-[#172B4D]">
              <span className="flex flex-wrap items-center gap-2">
                <span>Points expire after</span>
                <Input
                  value={expiryMonths}
                  onChange={(e) => setExpiryMonths(e.target.value)}
                  type="number"
                  min={1}
                  disabled={!expiryOn}
                  className={cn(ruleInput, !expiryOn && "opacity-50")}
                  aria-label="Points expiry months"
                />
                <span>months</span>
              </span>
              <span className="flex items-center gap-2 text-[12px] font-semibold text-[#6B778C]">
                Enable expiry
                <Switch checked={expiryOn} onCheckedChange={setExpiryOn} />
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-4 text-[13px] text-[#172B4D]">
              <span>
                Tier auto-upgrade
                <span className="ml-2 text-[11px] text-[#6B778C]">Move customers up when they cross the min-points line</span>
              </span>
              <Switch checked={tierUpgrade} onCheckedChange={setTierUpgrade} />
            </div>
            <Button
              onClick={() => void saveRules()}
              disabled={saving}
              className="h-10 rounded-xl bg-[#0052CC] px-5 text-[13px] font-semibold text-white hover:bg-[#0041A8]"
            >
              {saving ? "Saving…" : "Save rules"}
            </Button>
          </div>
        )}
      </Panel>

      {/* tiers */}
      <Panel className="@6xl:col-span-5">
        <div className="flex items-center justify-between">
          <h4 className="font-display text-[14px] font-bold text-[#172B4D]">Tiers</h4>
          <Button variant="outline" onClick={saveTiers} className="h-8 rounded-xl text-[12px] font-semibold">
            Save tiers
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {tiers.map((t, i) => (
            <div key={t.name} className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3">
              <div className="flex items-center gap-2">
                <span className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ background: t.color }} />
                <span className="text-[13px] font-bold text-[#172B4D]">{t.name}</span>
                <Badge className="ml-auto rounded-full bg-white text-[10px] font-bold text-[#6B778C]" variant="outline">
                  {t.discount}% off
                </Badge>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-[#6B778C]">
                <span>Min points</span>
                <Input
                  value={t.min}
                  onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))}
                  type="number"
                  min={0}
                  className="h-8 w-20 rounded-lg border-[#DFE1E6] bg-white text-center text-[12px] font-semibold"
                  aria-label={`${t.name} min points`}
                />
                <span className="ml-1">Perk</span>
                <Input
                  value={t.perk}
                  onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, perk: e.target.value } : x)))}
                  className="h-8 flex-1 rounded-lg border-[#DFE1E6] bg-white text-[12px]"
                  aria-label={`${t.name} perk`}
                />
              </div>
            </div>
          ))}
        </div>

        {/* gold preview */}
        <div className="mt-4 rounded-xl border border-[#FFE082] bg-[#FFF8E1] p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#8B6D00]">Preview - Gold member</p>
          <div className="flex items-center gap-3 rounded-xl border border-[#DFE1E6] bg-white p-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFF8E1] text-[13px] font-bold text-[#B8860B]">JM</span>
            <div>
              <p className="text-[13px] font-semibold text-[#172B4D]">Jane Muthoni</p>
              <div className="mt-0.5 flex items-center gap-2">
                <TierBadge tier="Gold" />
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#6B778C]">
                  <Sparkles size={11} className="text-[#B8860B]" /> 2,140 pts
                </span>
              </div>
            </div>
            <span className="ml-auto rounded-full bg-[#FFF8E1] px-2.5 py-1 text-[10px] font-bold text-[#8B6D00]">10% off</span>
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* ── gift cards tab ───────────────────────────────────────── */

function GiftCardsTab({ customers }: { customers: CustomerDto[] }) {
  const [cards, setCards] = useState<GiftCardWithQr[] | null>(null);

  /* issue dialog */
  const [issuing, setIssuing] = useState(false);
  const [issueBusy, setIssueBusy] = useState(false);
  const [issue, setIssue] = useState({ initialBalance: "", customerId: "", months: "12", gradient: "blue-green" });

  /* redeem / topup dialog */
  const [action, setAction] = useState<{ card: GiftCardWithQr; kind: "redeem" | "topup" } | null>(null);
  const [amount, setAmount] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCards(await api.get<GiftCardWithQr[]>("/api/gift-cards"));
    } catch (e) {
      toast({ title: "Could not load gift cards", description: err(e) });
      setCards([]);
    }
  }, []);

  useEffect(() => {
    // async boundary: the loader touches state, so never call it synchronously here
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const issueCard = useCallback(async () => {
    if (!Number(issue.initialBalance)) {
      toast({ title: "Enter an initial balance" });
      return;
    }
    setIssueBusy(true);
    try {
      const res = await api.post<{ ok: boolean; card: { code: string } }>("/api/gift-cards", {
        initialBalance: Number(issue.initialBalance),
        customerId: issue.customerId ? Number(issue.customerId) : undefined,
        months: Number(issue.months) || 12,
        gradient: issue.gradient,
      });
      toast({ title: `Gift card ${res.card.code} issued`, description: `Loaded with ${KES(Number(issue.initialBalance))}.` });
      setIssuing(false);
      setIssue({ initialBalance: "", customerId: "", months: "12", gradient: "blue-green" });
      await load();
    } catch (e) {
      toast({ title: "Could not issue card", description: err(e) });
    } finally {
      setIssueBusy(false);
    }
  }, [issue, load]);

  const submitAction = useCallback(async () => {
    if (!action) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast({ title: "Enter a positive amount" });
      return;
    }
    setActionBusy(true);
    try {
      const res = await api.patch<{ ok: boolean; card: { balance: number } }>(`/api/gift-cards/${action.card.id}`, {
        action: action.kind,
        amount: amt,
      });
      toast({
        title: action.kind === "redeem" ? `Redeemed ${KES(amt)} from ${action.card.code}` : `Topped up ${action.card.code} with ${KES(amt)}`,
        description: `New balance ${KES(res.card.balance)}.`,
      });
      setAction(null);
      setAmount("");
      await load();
    } catch (e) {
      toast({ title: action.kind === "redeem" ? "Redeem failed" : "Top-up failed", description: err(e) });
    } finally {
      setActionBusy(false);
    }
  }, [action, amount, load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-[#6B778C]">
          {cards ? `${cards.length} cards • ${KES(cards.reduce((a, c) => a + c.balance, 0))} outstanding value` : "Loading cards…"}
        </p>
        <Button
          onClick={() => setIssuing(true)}
          className="h-9 rounded-xl bg-[#0052CC] px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-[#0041A8]"
        >
          <Plus size={15} /> Issue Gift Card
        </Button>
      </div>

      {cards === null ? (
        <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @6xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[220px] animate-pulse rounded-2xl bg-[#F4F5F7]" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <EmptyState
          icon={<Gift size={22} />}
          title="No gift cards yet"
          sub="Issue a prepaid card - customers redeem it at POS like cash."
          action={
            <Button onClick={() => setIssuing(true)} className="rounded-xl bg-[#0052CC] text-white hover:bg-[#0041A8]">
              <Plus size={15} /> Issue Gift Card
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @6xl:grid-cols-3">
          {cards.map((card) => {
            const expired = isExpired(card.expiry);
            const dead = card.balance <= 0 || expired || card.status === "Empty";
            return (
              <div key={card.id} className="overflow-hidden rounded-2xl border border-[#DFE1E6] shadow-sm">
                <div className={cn("relative p-5 text-white", GC_CLASS[card.gradient as (typeof GRADIENTS)[number]] ?? "df-gc-blue-green")}>
                  <div className="flex items-start justify-between">
                    <div className="h-5 w-9">
                      <DukaMark white />
                    </div>
                    <Gift size={18} className="opacity-90" />
                  </div>
                  <p className="font-display mt-5 text-[26px] font-bold leading-none">{KES(card.balance)}</p>
                  <p className="mt-1.5 font-mono text-[11px] opacity-80">
                    {card.code} • {fmtExpiry(card.expiry)}
                  </p>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <div className="space-y-1.5">
                      <span className="inline-block rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold">
                        {card.balance <= 0 ? "Empty" : expired ? "Expired" : card.status}
                      </span>
                      {card.customerName && <p className="text-[11px] opacity-90">{card.customerName}</p>}
                    </div>
                    <div className="rounded-lg bg-white p-1">
                      <QrImage text={`DUKAFLOW-GIFT:${card.code}:${card.balance}`} size={56} alt={`QR for ${card.code}`} />
                    </div>
                  </div>
                  {dead && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#172B4D]/55">
                      <span className="-rotate-6 rounded-md border-2 border-white/80 px-4 py-1 text-[14px] font-bold uppercase tracking-widest text-white">
                        {card.balance <= 0 ? "Empty" : "Expired"}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 bg-white p-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={card.balance <= 0 || actionBusy}
                    onClick={() => {
                      setAction({ card, kind: "redeem" });
                      setAmount("");
                    }}
                    className="h-8 flex-1 rounded-lg text-[12px] font-semibold"
                  >
                    Redeem
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={actionBusy}
                    onClick={() => {
                      setAction({ card, kind: "topup" });
                      setAmount("");
                    }}
                    className="h-8 flex-1 rounded-lg text-[12px] font-semibold"
                  >
                    Top up
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* issue dialog */}
      <Dialog open={issuing} onOpenChange={setIssuing}>
        <DialogContent className="rounded-2xl sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="font-display text-[16px] font-bold text-[#172B4D]">Issue Gift Card</DialogTitle>
            <DialogDescription className="text-[12px] text-[#6B778C]">
              Prepaid card redeemable at any DukaFlow till.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="gc-amount" className="text-[12px] font-semibold text-[#172B4D]">Initial balance (KES) *</Label>
                <Input id="gc-amount" type="number" min={0} value={issue.initialBalance} onChange={(e) => setIssue({ ...issue, initialBalance: e.target.value })} placeholder="5000" className="h-10 rounded-xl bg-[#FAFBFC]" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="gc-months" className="text-[12px] font-semibold text-[#172B4D]">Expiry (months)</Label>
                <Input id="gc-months" type="number" min={1} value={issue.months} onChange={(e) => setIssue({ ...issue, months: e.target.value })} className="h-10 rounded-xl bg-[#FAFBFC]" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[12px] font-semibold text-[#172B4D]">Customer (optional)</Label>
              <Select value={issue.customerId || "none"} onValueChange={(v) => setIssue({ ...issue, customerId: v === "none" ? "" : v })}>
                <SelectTrigger className="h-10 rounded-xl bg-[#FAFBFC]"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="none">Unassigned (open card)</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name} - {c.phone}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[12px] font-semibold text-[#172B4D]">Card design</Label>
              <div className="flex flex-wrap gap-2">
                {GRADIENTS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    aria-label={`Gradient ${g}`}
                    onClick={() => setIssue({ ...issue, gradient: g })}
                    style={{ background: GRADIENT_HEX[g] }}
                    className={cn(
                      GC_CLASS[g],
                      "h-10 w-16 rounded-lg ring-offset-2 transition",
                      issue.gradient === g ? "ring-2 ring-[#172B4D]" : "hover:scale-105"
                    )}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIssuing(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={() => void issueCard()} disabled={issueBusy} className="rounded-xl bg-[#0052CC] text-white hover:bg-[#0041A8]">
              {issueBusy ? "Issuing…" : "Issue card"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* redeem / topup dialog */}
      <Dialog open={!!action} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent className="rounded-2xl sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle className="font-display text-[16px] font-bold text-[#172B4D]">
              {action?.kind === "redeem" ? "Redeem from card" : "Top up card"}
            </DialogTitle>
            <DialogDescription className="font-mono text-[12px] text-[#6B778C]">
              {action?.card.code} • Balance {action ? KES(action.card.balance) : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="gc-action-amount" className="text-[12px] font-semibold text-[#172B4D]">Amount (KES)</Label>
            <Input
              id="gc-action-amount"
              type="number"
              min={1}
              max={action?.kind === "redeem" ? action.card.balance : undefined}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={action?.kind === "redeem" ? `Max ${action.card.balance}` : "1000"}
              className="h-10 rounded-xl bg-[#FAFBFC]"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAction(null)} className="rounded-xl">Cancel</Button>
            <Button
              onClick={() => void submitAction()}
              disabled={actionBusy}
              className={cn(
                "rounded-xl text-white",
                action?.kind === "redeem" ? "bg-[#FF5630] hover:bg-[#E2480F]" : "bg-[#00C853] hover:bg-[#00A845]"
              )}
            >
              {actionBusy ? "Processing…" : action?.kind === "redeem" ? "Redeem" : "Top up"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
