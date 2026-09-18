"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Check, Plus, Trash2, TrendingUp, Box, ClipboardList, LayoutList,
} from "lucide-react";
import { api } from "@/lib/api";
import { DealDto, KES } from "@/types";
import { ScreenHeader, EmptyState, TableSkeleton } from "@/components/df/shared";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

/* -- stage config ------------------------------------------- */

const STAGES = [
  { id: "quotation", title: "Quotation", label: "Quotation Created", color: "#DFE1E6" },
  { id: "proforma", title: "Proforma", label: "Proforma Sent", color: "#0052CC" },
  { id: "order", title: "Sales Order", label: "Sales Order Confirmed", color: "#FFAB00" },
  { id: "invoiced", title: "Invoiced", label: "Invoiced", color: "#00C853" },
  { id: "paid", title: "Paid", label: "Paid", color: "#172B4D" },
] as const;

type StageId = (typeof STAGES)[number]["id"];

const stageTitle = (id: string) => STAGES.find((s) => s.id === id)?.title ?? id;

const ASSIGNEE_COLORS: Record<string, string> = {
  M: "#0052CC", // Mary Wanjiku
  J: "#00C853", // James Otieno
  G: "#FF5630", // Grace Akinyi
  O: "#172B4D", // Owner
};

/* -- date helpers ------------------------------------------- */

function ago(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

function fmtStamp(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day}, ${time}`;
}

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/* -- screen ------------------------------------------------- */

export default function PipelineScreen() {
  const [deals, setDeals] = useState<DealDto[] | null>(null);
  const [view, setView] = useState<"kanban" | "list">("kanban");

  /* drag state */
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

  /* detail drawer */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");

  /* new deal dialog */
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ customerName: "", customerPhone: "", title: "", amount: "", itemCount: "", assignee: "M" });

  const selected = useMemo(() => deals?.find((d) => d.id === selectedId) ?? null, [deals, selectedId]);

  const load = useCallback(async () => {
    try {
      setDeals(await api.get<DealDto[]>("/api/pipeline"));
    } catch (e) {
      toast({ title: "Could not load pipeline", description: err(e) });
      setDeals([]);
    }
  }, []);

  useEffect(() => {
    // async boundary: the loader touches state, so never call it synchronously here
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  /* keep notes draft in sync with the open deal - render-time resync pattern */
  const [notesForId, setNotesForId] = useState<string | null | undefined>(undefined);
  if (notesForId !== selected?.id) {
    setNotesForId(selected?.id);
    setNotesDraft(selected?.notes ?? "");
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of STAGES) c[s.id] = 0;
    for (const d of deals ?? []) if (c[d.stage] !== undefined) c[d.stage] += 1;
    return c;
  }, [deals]);

  const conversion = useMemo(() => {
    const total = deals?.length ?? 0;
    if (!total) return 0;
    return Math.round(((counts.paid ?? 0) / total) * 100);
  }, [deals, counts]);

  /* -- mutations -- */

  const patchStage = useCallback(
    async (id: string, stage: string, by?: { drag: boolean }) => {
      const deal = deals?.find((d) => d.id === id);
      if (!deal || deal.stage === stage) return;
      setMovingId(id);
      try {
        const updated = await api.patch<DealDto>(`/api/pipeline/${id}`, { stage });
        setDeals((prev) => (prev ? prev.map((d) => (d.id === id ? updated : d)) : prev));
        toast({
          title: by?.drag ? `Dropped into ${stageTitle(stage)}` : `Deal moved to ${stageTitle(stage)}`,
          description: stage === "invoiced" ? "Sales Invoice created automatically" : `${deal.customerName} • ${KES(updated.amount)}`,
        });
      } catch (e) {
        toast({ title: "Move failed", description: err(e) });
      } finally {
        setMovingId(null);
      }
    },
    [deals]
  );

  const saveNotes = useCallback(async () => {
    if (!selected || notesDraft === (selected.notes ?? "")) return;
    try {
      const updated = await api.patch<DealDto>(`/api/pipeline/${selected.id}`, { notes: notesDraft });
      setDeals((prev) => (prev ? prev.map((d) => (d.id === updated.id ? updated : d)) : prev));
      toast({ title: "Notes saved" });
    } catch (e) {
      toast({ title: "Could not save notes", description: err(e) });
    }
  }, [selected, notesDraft]);

  const deleteDeal = useCallback(
    async (id: string) => {
      const deal = deals?.find((d) => d.id === id);
      if (!deal) return;
      if (!window.confirm(`Delete deal "${deal.customerName} - ${deal.title}"? This cannot be undone.`)) return;
      try {
        await api.del(`/api/pipeline/${id}`);
        setDeals((prev) => (prev ? prev.filter((d) => d.id !== id) : prev));
        setSelectedId(null);
        toast({ title: "Deal deleted", description: `${deal.customerName} removed from pipeline.` });
      } catch (e) {
        toast({ title: "Delete failed", description: err(e) });
      }
    },
    [deals]
  );

  const createDeal = useCallback(async () => {
    if (!form.customerName.trim() || !form.amount) {
      toast({ title: "Customer name and amount are required" });
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.post<DealDto>("/api/pipeline", {
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim() || undefined,
        title: form.title.trim() || "New quotation",
        amount: Number(form.amount),
        itemCount: Number(form.itemCount || 1),
        assignee: form.assignee,
      });
      setDeals((prev) => [created, ...(prev ?? [])]);
      setCreating(false);
      setForm({ customerName: "", customerPhone: "", title: "", amount: "", itemCount: "", assignee: "M" });
      toast({ title: "Deal created", description: `${created.customerName} • ${KES(created.amount)} in Quotation.` });
    } catch (e) {
      toast({ title: "Could not create deal", description: err(e) });
    } finally {
      setSubmitting(false);
    }
  }, [form]);

  const nextStage = selected ? STAGES[STAGES.findIndex((s) => s.id === selected.stage) + 1] : undefined;

  /* -- render -- */

  return (
    <div className="space-y-4">
      <ScreenHeader
        title="Sales Pipeline"
        subtitle="Quotation → Proforma → Order → Invoice → Payment - one click to mature"
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E3F2FD] px-3 py-1.5 text-[12px] font-bold text-[#0052CC]">
              <TrendingUp size={13} /> Conversion {conversion}%
            </span>
            <Button
              onClick={() => setCreating(true)}
              className="h-9 rounded-xl bg-[#0052CC] px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-[#0041A8]"
            >
              <Plus size={15} /> New Deal
            </Button>
          </>
        }
      />

      {/* toolbar: stage chips + view switch */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {STAGES.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#DFE1E6] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#6B778C]"
            >
              <span className="h-2 w-2 rounded-full ring-1 ring-black/10" style={{ background: s.color }} />
              {s.title}
              <b className="text-[#172B4D]">{deals ? counts[s.id] : "-"}</b>
            </span>
          ))}
        </div>
        <div className="flex rounded-full border border-[#DFE1E6] bg-white p-1">
          {(
            [
              { id: "kanban", label: "Kanban", icon: ClipboardList },
              { id: "list", label: "List", icon: LayoutList },
            ] as const
          ).map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-semibold transition",
                view === v.id ? "bg-[#172B4D] text-white" : "text-[#6B778C] hover:text-[#172B4D]"
              )}
            >
              <v.icon size={13} /> {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* board / list */}
      {deals === null ? (
        <PipelineSkeleton view={view} />
      ) : deals.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={22} />}
          title="No deals in the pipeline yet"
          sub="Create a quotation and drag it across the board as the customer matures."
          action={
            <Button onClick={() => setCreating(true)} className="rounded-xl bg-[#0052CC] text-white hover:bg-[#0041A8]">
              <Plus size={15} /> New Deal
            </Button>
          }
        />
      ) : view === "kanban" ? (
        <div className="df-scroll overflow-x-auto pb-2">
          <div className="grid min-w-[1080px] grid-cols-5 gap-3">
            {STAGES.map((s) => {
              const colDeals = deals.filter((d) => d.stage === s.id);
              const isOver = dragOver === s.id;
              return (
                <div
                  key={s.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(s.id);
                  }}
                  onDragLeave={() => setDragOver((cur) => (cur === s.id ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain") || dragId;
                    setDragOver(null);
                    setDragId(null);
                    if (id) void patchStage(id, s.id, { drag: true });
                  }}
                  className={cn(
                    "min-h-[300px] rounded-2xl border bg-[#F4F5F7] p-2 transition",
                    isOver ? "border-[#0052CC] ring-2 ring-[#0052CC]/40" : "border-[#DFE1E6]"
                  )}
                >
                  <div className="flex items-center justify-between p-1.5 pb-2">
                    <span className="flex items-center gap-2 text-[13px] font-semibold text-[#172B4D]">
                      <span className="h-2 w-2 rounded-full ring-1 ring-black/10" style={{ background: s.color }} />
                      {s.title}
                    </span>
                    <span className="rounded-full border border-[#DFE1E6] bg-white px-2 py-0.5 text-[11px] font-bold text-[#6B778C]">
                      {colDeals.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {colDeals.map((d) => (
                      <DealCard
                        key={d.id}
                        deal={d}
                        dragging={dragId === d.id}
                        moving={movingId === d.id}
                        onDragStart={() => setDragId(d.id)}
                        onDragEnd={() => {
                          setDragId(null);
                          setDragOver(null);
                        }}
                        onOpen={() => setSelectedId(d.id)}
                      />
                    ))}
                    {colDeals.length === 0 && (
                      <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-[#DFE1E6] text-[11px] text-[#6B778C]">
                        Drop deals here
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <DealTable deals={deals} onOpen={setSelectedId} />
      )}

      {/* -- deal detail drawer -- */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[420px] df-scroll" side="right">
          {selected && (
            <>
              <SheetHeader className="gap-1 border-b border-[#DFE1E6] p-5 pr-12 text-left">
                <SheetTitle className="font-display text-[17px] font-bold text-[#172B4D]">
                  {selected.customerName}
                </SheetTitle>
                <SheetDescription className="text-[12px] text-[#6B778C]">
                  {selected.customerPhone ? `${selected.customerPhone} • ` : ""}
                  {selected.title || "No title"}
                </SheetDescription>
                <div className="flex items-center gap-2 pt-1">
                  <span className="font-display text-[20px] font-bold text-[#172B4D]">{KES(selected.amount)}</span>
                  <StageBadge stage={selected.stage} />
                </div>
              </SheetHeader>

              <div className="space-y-5 p-5">
                {/* timeline */}
                <div>
                  <h4 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">Timeline</h4>
                  <div className="relative space-y-4 border-l-2 border-[#DFE1E6] pl-5">
                    {[...selected.history].reverse().map((h, i) => (
                      <div key={`${h.stage}-${h.at}-${i}`} className="relative">
                        <span
                          className={cn(
                            "absolute -left-[27px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full",
                            i === 0 ? "bg-[#00C853] text-white" : "border border-[#DFE1E6] bg-white text-[#6B778C]"
                          )}
                        >
                          <Check size={10} strokeWidth={3} />
                        </span>
                        <p className="text-[13px] font-semibold text-[#172B4D]">{h.stage}</p>
                        <p className="text-[11px] text-[#6B778C]">
                          {fmtStamp(h.at)} • by {h.by}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* meta */}
                <div className="flex items-center gap-4 rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3 text-[12px]">
                  <span className="flex items-center gap-1.5 text-[#6B778C]">
                    <Box size={13} /> {selected.itemCount} items
                  </span>
                  <Separator orientation="vertical" className="h-4" />
                  <span className="flex items-center gap-1.5 text-[#6B778C]">
                    Created {ago(selected.createdAt)}
                  </span>
                  <span className="ml-auto">
                    <AssigneeChip id={selected.assignee} />
                  </span>
                </div>

                {/* notes */}
                <div>
                  <Label htmlFor="deal-notes" className="text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">
                    Notes
                  </Label>
                  <Textarea
                    id="deal-notes"
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    onBlur={saveNotes}
                    placeholder="Delivery terms, discounts, site contact…"
                    className="mt-2 min-h-[76px] rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px]"
                  />
                  <p className="mt-1 text-[10px] text-[#6B778C]">Saved automatically when you click away.</p>
                </div>

                {/* one-click maturing */}
                <div className="space-y-3">
                  {nextStage ? (
                    <Button
                      onClick={() => void patchStage(selected.id, nextStage.id)}
                      disabled={movingId === selected.id}
                      className="h-11 w-full rounded-xl bg-[#0052CC] text-[13px] font-semibold text-white shadow-sm hover:bg-[#0041A8]"
                    >
                      Advance to {nextStage.title} <ArrowRight size={15} />
                    </Button>
                  ) : (
                    <div className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#E8F5E9] text-[13px] font-semibold text-[#1B7A2E]">
                      <Check size={15} /> Fully paid - deal closed
                    </div>
                  )}
                  <div>
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Jump to stage</p>
                    <div className="flex flex-wrap gap-1.5">
                      {STAGES.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => void patchStage(selected.id, s.id)}
                          disabled={movingId === selected.id || s.id === selected.stage}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                            s.id === selected.stage
                              ? "border-[#172B4D] bg-[#172B4D] text-white"
                              : "border-[#DFE1E6] bg-white text-[#6B778C] hover:border-[#0052CC] hover:text-[#0052CC]"
                          )}
                        >
                          {s.title}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <Separator />

                <Button
                  variant="outline"
                  onClick={() => void deleteDeal(selected.id)}
                  className="h-9 w-full rounded-xl border-[#FFCDD2] text-[12px] font-semibold text-[#FF5630] hover:bg-[#FFEBEE] hover:text-[#FF5630]"
                >
                  <Trash2 size={14} /> Delete deal
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* -- new deal dialog -- */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="rounded-2xl sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="font-display text-[16px] font-bold text-[#172B4D]">New Deal</DialogTitle>
            <DialogDescription className="text-[12px] text-[#6B778C]">
              Starts in <b>Quotation</b> - drag it across the board as it matures.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="nd-customer" className="text-[12px] font-semibold text-[#172B4D]">Customer name *</Label>
              <Input
                id="nd-customer"
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                placeholder="e.g. Thika Builders Co"
                className="h-10 rounded-xl bg-[#FAFBFC]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="nd-phone" className="text-[12px] font-semibold text-[#172B4D]">Phone</Label>
                <Input
                  id="nd-phone"
                  value={form.customerPhone}
                  onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
                  placeholder="07xx xxx xxx"
                  className="h-10 rounded-xl bg-[#FAFBFC]"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="nd-amount" className="text-[12px] font-semibold text-[#172B4D]">Amount (KES) *</Label>
                <Input
                  id="nd-amount"
                  type="number"
                  min={0}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="45000"
                  className="h-10 rounded-xl bg-[#FAFBFC]"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="nd-title" className="text-[12px] font-semibold text-[#172B4D]">Deal title</Label>
                <Input
                  id="nd-title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Cement restock"
                  className="h-10 rounded-xl bg-[#FAFBFC]"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="nd-items" className="text-[12px] font-semibold text-[#172B4D]">Items</Label>
                <Input
                  id="nd-items"
                  type="number"
                  min={1}
                  value={form.itemCount}
                  onChange={(e) => setForm({ ...form, itemCount: e.target.value })}
                  placeholder="1"
                  className="h-10 rounded-xl bg-[#FAFBFC]"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[12px] font-semibold text-[#172B4D]">Assignee</Label>
              <div className="flex gap-2">
                {(["M", "J", "G"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setForm({ ...form, assignee: a })}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-2 rounded-xl border p-2 text-[12px] font-semibold transition",
                      form.assignee === a
                        ? "border-[#0052CC] bg-[#E9F2FF] text-[#0052CC]"
                        : "border-[#DFE1E6] bg-white text-[#6B778C] hover:border-[#B9C4D6]"
                    )}
                  >
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ background: ASSIGNEE_COLORS[a] }}
                    >
                      {a}
                    </span>
                    {a === "M" ? "Mary" : a === "J" ? "James" : "Grace"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreating(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button
              onClick={() => void createDeal()}
              disabled={submitting}
              className="rounded-xl bg-[#0052CC] text-white hover:bg-[#0041A8]"
            >
              {submitting ? "Creating…" : "Create deal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* -- pieces ------------------------------------------------- */

function DealCard({
  deal, dragging, moving, onDragStart, onDragEnd, onOpen,
}: {
  deal: DealDto;
  dragging: boolean;
  moving: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", deal.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={cn(
        "df-kanban-card w-full cursor-grab rounded-xl border border-[#DFE1E6] bg-white p-3 text-left shadow-sm active:cursor-grabbing",
        dragging && "df-dragging",
        moving && "pointer-events-none opacity-50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold text-[#172B4D]">{deal.customerName}</p>
        <span className="shrink-0 text-[10px] text-[#6B778C]">{ago(deal.createdAt)}</span>
      </div>
      <p className="mt-0.5 truncate text-[11px] text-[#6B778C]">{deal.title || "-"}</p>
      <p className="font-display mt-1.5 text-[14px] font-bold text-[#172B4D]">{KES(deal.amount)}</p>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-[#6B778C]">
        <span className="flex items-center gap-1">
          <Box size={11} /> {deal.itemCount} items
        </span>
        <span>•</span>
        <span>{ago(deal.createdAt)}</span>
        <span className="ml-auto">
          <AssigneeChip id={deal.assignee} />
        </span>
      </div>
    </div>
  );
}

function AssigneeChip({ id }: { id: string }) {
  return (
    <span
      title={`Assignee ${id}`}
      className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
      style={{ background: ASSIGNEE_COLORS[id] ?? "#172B4D" }}
    >
      {id}
    </span>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const s = STAGES.find((x) => x.id === stage);
  const dark = stage === "paid" || stage === "proforma";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        dark ? "text-white" : "text-[#172B4D]"
      )}
      style={{ background: s?.color ?? "#DFE1E6" }}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {stageTitle(stage)}
    </span>
  );
}

function DealTable({ deals, onOpen }: { deals: DealDto[]; onOpen: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#DFE1E6] bg-white shadow-sm">
      <Table className="text-[12px]">
        <TableHeader>
          <TableRow className="bg-[#FAFBFC] hover:bg-[#FAFBFC]">
            {["Customer", "Title", "Stage", "Amount", "Items", "Assignee", "Age", "Created"].map((h) => (
              <TableHead key={h} className="p-3 text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {deals.map((d) => (
            <TableRow
              key={d.id}
              onClick={() => onOpen(d.id)}
              className="cursor-pointer border-t border-[#F4F5F7] hover:bg-[#FAFBFC]"
            >
              <TableCell className="p-3 font-semibold text-[#172B4D]">{d.customerName}</TableCell>
              <TableCell className="p-3 text-[#6B778C]">{d.title || "-"}</TableCell>
              <TableCell className="p-3">
                <StageBadge stage={d.stage} />
              </TableCell>
              <TableCell className="font-display p-3 font-bold text-[#172B4D]">{KES(d.amount)}</TableCell>
              <TableCell className="p-3">{d.itemCount}</TableCell>
              <TableCell className="p-3">
                <AssigneeChip id={d.assignee} />
              </TableCell>
              <TableCell className="p-3 text-[#6B778C]">{ago(d.createdAt)}</TableCell>
              <TableCell className="p-3 text-[#6B778C]">
                {new Date(d.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PipelineSkeleton({ view }: { view: "kanban" | "list" }) {
  if (view === "list") {
    return (
      <div className="rounded-2xl border border-[#DFE1E6] bg-white p-4 shadow-sm">
        <TableSkeleton rows={6} cols={6} />
      </div>
    );
  }
  return (
    <div className="df-scroll overflow-x-auto pb-2">
      <div className="grid min-w-[1080px] grid-cols-5 gap-3">
        {STAGES.map((s) => (
          <div key={s.id} className="min-h-[300px] rounded-2xl border border-[#DFE1E6] bg-[#F4F5F7] p-2">
            <div className="flex items-center justify-between p-1.5 pb-2">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-[#172B4D]">
                <span className="h-2 w-2 rounded-full ring-1 ring-black/10" style={{ background: s.color }} />
                {s.title}
              </span>
            </div>
            <div className="space-y-2">
              <div className="h-[88px] animate-pulse rounded-xl border border-[#DFE1E6] bg-white" />
              <div className="h-[88px] animate-pulse rounded-xl border border-[#DFE1E6] bg-white/70" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
