"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight, Check, Files, Loader2, Plus, Printer, Sparkles, Trash2, TrendingUp, Box, ClipboardList, LayoutList, Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { ChainDoc, DealDto, KES } from "@/types";
import { customerPointsLine, fmtDate, kes, type ReceiptDocData } from "@/lib/receipt";
import { ReceiptDocument } from "@/components/df/receipt-document";
import { printReceiptDocs } from "@/services/receiptService";
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

/* -- maturity chain (mirrors PATCH /api/pipeline/[id]) ------ */

const CHAIN_STEPS = [
  { id: "quotation", label: "Quotation", short: "QT" },
  { id: "proforma", label: "Proforma", short: "PF" },
  { id: "order", label: "Sales Order", short: "SO" },
  { id: "invoiced", label: "Invoice", short: "INV" },
  { id: "paid", label: "Payment", short: "PAY" },
] as const;

type ChainStepId = (typeof CHAIN_STEPS)[number]["id"];

const MATURE_LABEL: Record<ChainStepId, string> = {
  quotation: "Quotation",
  proforma: "Mature to Proforma",
  order: "Mature to Order",
  invoiced: "Mature to Invoice",
  paid: "Create Payment",
};

const MATURE_SHORT: Record<ChainStepId, string> = {
  quotation: "Quotation",
  proforma: "Proforma",
  order: "Order",
  invoiced: "Invoice",
  paid: "Payment",
};

/** Next logical maturity step for a stage (null when fully paid). */
function nextMature(stage: string): ChainStepId | null {
  const i = CHAIN_STEPS.findIndex((s) => s.id === stage);
  if (i < 0 || i >= CHAIN_STEPS.length - 1) return null;
  return CHAIN_STEPS[i + 1].id;
}

/** ReceiptDocData for one chain document (A4 print with digital QR). */
function chainDocData(deal: DealDto, doc: ChainDoc): ReceiptDocData {
  const qty = Math.max(1, deal.itemCount || 1);
  return {
    kind: doc.kind,
    docNo: doc.no,
    receiptCode: doc.digitalCode,
    date: fmtDate(doc.at),
    servedBy: deal.assignee === "M" ? "Mary Wanjiku" : deal.assignee === "J" ? "James Otieno" : deal.assignee === "G" ? "Grace Akinyi" : "Owner",
    customerName: deal.customerName,
    customerLine: customerPointsLine(deal.customerName, null),
    lines: [
      {
        no: 1,
        name: deal.title || "Goods as quoted",
        qty,
        unit: "pc",
        unitPrice: Math.round((deal.amount / qty) * 100) / 100,
        discount: 0,
        total: deal.amount,
      },
    ],
    totals:
      doc.kind === "PAYMENT"
        ? [{ label: "Received in full for the above invoice", value: kes(deal.amount), bold: true }]
        : doc.kind === "INVOICE"
          ? [{ label: "Payment due on receipt", value: "" }]
          : [],
    grandTotal: kes(deal.amount),
    paymentLines: doc.kind === "PAYMENT" ? [{ method: "Cash", amount: kes(deal.amount) }] : undefined,
    footerMessage:
      doc.kind === "QUOTATION"
        ? "Quotation valid for 14 days - prices subject to confirmation"
        : doc.kind === "PAYMENT"
          ? "Received with thanks - keep this receipt"
          : undefined,
  };
}

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

/* -- print host: receipts portal to <body>; hidden on screen, exclusive in print -- */

const RECEIPT_HOST_CSS = `
#df-receipt-host { display: none; }
@media print {
  #df-receipt-host { display: block !important; }
  body > *:not(#df-receipt-host) { display: none !important; }
  #df-receipt-host .df-receipt { position: static !important; left: auto; top: auto; }
}
`;

function ReceiptPrintHost({ docs, mode }: { docs: ReceiptDocData[]; mode: "thermal" | "a4" }) {
  if (docs.length === 0) return null;
  // portals only exist client-side; docs start empty so SSR renders null and hydration stays in sync
  if (typeof document === "undefined") return null;
  return createPortal(
    <div id="df-receipt-host" aria-hidden>
      <style>{RECEIPT_HOST_CSS}</style>
      {docs.map((d, i) => (
        <div
          key={`${i}-${d.docNo}`}
          style={{ pageBreakAfter: i < docs.length - 1 ? "always" : "auto" }}
        >
          <ReceiptDocument data={d} mode={mode} />
        </div>
      ))}
    </div>,
    document.body
  );
}

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

  /* -- maturity chain: one click + master button -- */
  const [matureBusy, setMatureBusy] = useState(false);
  const [chain, setChain] = useState<{
    open: boolean;
    busy: boolean;
    deal: DealDto | null;
    steps: { id: ChainStepId; label: string; docNo: string | null; code: string | null; status: "pending" | "active" | "done" }[];
  }>({ open: false, busy: false, deal: null, steps: [] });
  const chainTimer = useRef<number | null>(null);

  const closeChain = useCallback(() => {
    if (chainTimer.current) {
      window.clearInterval(chainTimer.current);
      chainTimer.current = null;
    }
    setChain({ open: false, busy: false, deal: null, steps: [] });
  }, []);

  useEffect(() => () => {
    if (chainTimer.current) window.clearInterval(chainTimer.current);
  }, []);

  /** ONE CLICK: PATCH /api/pipeline/[id] { action: "mature", to } */
  const matureOne = useCallback(async (deal: DealDto, to: ChainStepId) => {
    setMatureBusy(true);
    try {
      const res = await api.patch<{ ok: boolean; docs: Record<string, ChainDoc>; deal: DealDto }>(
        `/api/pipeline/${deal.id}`,
        { action: "mature", to, by: "Owner" }
      );
      setDeals((prev) => (prev ? prev.map((d) => (d.id === deal.id ? (res.deal ?? d) : d)) : prev));
      toast({
        title: `${MATURE_SHORT[to]} issued`,
        description: `${deal.customerName} • doc ${res.docs?.[to]?.no ?? "-"} • ${KES(deal.amount)}`,
      });
    } catch (e) {
      toast({ title: "Could not mature deal", description: err(e), variant: "destructive" });
    } finally {
      setMatureBusy(false);
    }
  }, []);

  /** MASTER BUTTON: PATCH { action: "matureAll" } with an animated stepper dialog. */
  const matureAll = useCallback(
    (deal: DealDto) => {
      setChain({
        open: true,
        busy: true,
        deal,
        steps: CHAIN_STEPS.map((s) => ({ id: s.id, label: s.label, docNo: null, code: null, status: "pending" as const })),
      });
      // simulate per-step progress on a 400ms timer while awaiting the response
      if (chainTimer.current) window.clearInterval(chainTimer.current);
      let tick = 0;
      chainTimer.current = window.setInterval(() => {
        tick += 1;
        if (tick > CHAIN_STEPS.length - 1) {
          if (chainTimer.current) window.clearInterval(chainTimer.current);
          chainTimer.current = null;
          return;
        }
        setChain((c) => ({
          ...c,
          steps: c.steps.map((st, i) =>
            i < tick ? { ...st, status: "done" as const } : i === tick ? { ...st, status: "active" as const } : st
          ),
        }));
      }, 400);
      void (async () => {
        try {
          const res = await api.patch<{ ok: boolean; docs: Record<string, ChainDoc>; deal: DealDto }>(
            `/api/pipeline/${deal.id}`,
            { action: "matureAll", by: "Owner" }
          );
          if (chainTimer.current) {
            window.clearInterval(chainTimer.current);
            chainTimer.current = null;
          }
          const docs = res.docs ?? {};
          setChain((c) => ({
            ...c,
            busy: false,
            deal: res.deal ?? c.deal,
            steps: CHAIN_STEPS.map((s) => ({
              id: s.id,
              label: s.label,
              status: "done" as const,
              docNo: docs[s.id]?.no ?? null,
              code: docs[s.id]?.digitalCode ?? null,
            })),
          }));
          setDeals((prev) => (prev ? prev.map((d) => (d.id === deal.id ? (res.deal ?? d) : d)) : prev));
          toast({
            title: "Matured end to end",
            description: `Quotation to Payment complete - ${Object.keys(docs).length} documents issued (incl. sales invoice).`,
          });
        } catch (e) {
          if (chainTimer.current) {
            window.clearInterval(chainTimer.current);
            chainTimer.current = null;
          }
          setChain({ open: false, busy: false, deal: null, steps: [] });
          toast({ title: "Could not mature deal", description: err(e), variant: "destructive" });
        }
      })();
    },
    []
  );

  /* -- printing: single doc or the combined (stapled) set -- */
  const [printDocs, setPrintDocs] = useState<ReceiptDocData[]>([]);
  const [printMode, setPrintMode] = useState<"thermal" | "a4">("a4");

  const printDealDocs = useCallback((deal: DealDto, docs: ChainDoc[]) => {
    if (docs.length === 0) return;
    setPrintMode("a4");
    setPrintDocs(docs.map((d) => chainDocData(deal, d)));
    // Naivas grade: standalone combined print (own window, page breaks between docs)
    void printReceiptDocs(docs.map((d) => chainDocData(deal, d)), "a4");
  }, []);

  const dealChainDocs = useCallback(
    (deal: DealDto): { stage: ChainStepId; doc: ChainDoc }[] =>
      CHAIN_STEPS.map((s) => {
        const doc = deal.docs?.[s.id];
        return doc ? { stage: s.id, doc } : null;
      }).filter((x): x is { stage: ChainStepId; doc: ChainDoc } => x !== null),
    []
  );

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
                        matureBusy={matureBusy}
                        onMature={(deal, to) => void matureOne(deal, to)}
                        onMatureAll={matureAll}
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
        <DealTable
          deals={deals}
          onOpen={setSelectedId}
          matureBusy={matureBusy}
          onMature={(deal, to) => void matureOne(deal, to)}
          onMatureAll={matureAll}
          onPrintCombined={printDealDocs}
        />
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

                {/* maturity chain actions */}
                <div className="space-y-3">
                  {nextStage ? (
                    <Button
                      onClick={() => void matureOne(selected, nextStage.id)}
                      disabled={matureBusy || movingId === selected.id}
                      className="h-11 w-full rounded-xl bg-[#0052CC] text-[13px] font-semibold text-white shadow-sm hover:bg-[#0041A8]"
                    >
                      {MATURE_LABEL[nextStage.id]} <ArrowRight size={15} />
                    </Button>
                  ) : (
                    <div className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#E8F5E9] text-[13px] font-semibold text-[#1B7A2E]">
                      <Check size={15} /> Fully paid - deal closed
                    </div>
                  )}
                  {selected.stage !== "paid" && (
                    <Button
                      onClick={() => matureAll(selected)}
                      disabled={matureBusy}
                      className="h-11 w-full rounded-xl bg-gradient-to-r from-[#B8860B] to-[#D04A1E] text-[13px] font-bold text-white shadow-sm hover:opacity-90"
                    >
                      <Sparkles size={15} /> Mature All At Once
                    </Button>
                  )}
                  <div>
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Jump to stage (issues the doc)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {STAGES.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => void matureOne(selected, s.id)}
                          disabled={matureBusy || s.id === selected.stage}
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

                {/* chain documents - printable individually + combined */}
                <div>
                  <h4 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">Documents</h4>
                  {dealChainDocs(selected).length === 0 ? (
                    <p className="rounded-xl border border-dashed border-[#DFE1E6] px-3 py-2.5 text-[11px] text-[#6B778C]">
                      No documents yet - mature the deal to generate the QT / PF / SO / INV / PAY chain.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {dealChainDocs(selected).map(({ stage, doc }) => (
                        <div key={doc.no} className="flex items-center gap-2 rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-3 py-2">
                          <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#0052CC] ring-1 ring-[#DFE1E6]">
                            {CHAIN_STEPS.find((s) => s.id === stage)?.short ?? doc.kind}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-[11px] font-bold text-[#172B4D]">{doc.no}</p>
                            <a
                              href={`/receipt/${doc.digitalCode}`}
                              target="_blank"
                              rel="noreferrer"
                              className="block truncate text-[10px] text-[#0052CC] hover:underline"
                            >
                              {doc.digitalCode}
                            </a>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 shrink-0 rounded-full px-2.5 text-[10px] font-semibold"
                            onClick={() => printDealDocs(selected, [doc])}
                          >
                            <Printer size={12} /> Print
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-full rounded-xl text-[11px] font-semibold"
                        onClick={() => printDealDocs(selected, dealChainDocs(selected).map((x) => x.doc))}
                      >
                        <Files size={13} /> Print Combined (stapled set with QRs)
                      </Button>
                    </div>
                  )}
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

      {/* -- Mature All stepper dialog -- */}
      <Dialog open={chain.open} onOpenChange={(o) => !o && closeChain()}>
        <DialogContent className="rounded-2xl sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="font-display text-[16px] font-bold text-[#172B4D]">Mature All At Once</DialogTitle>
            <DialogDescription className="text-[12px] text-[#6B778C]">
              {chain.deal ? `${chain.deal.customerName} • ${KES(chain.deal.amount)}` : ""} - generating the full document chain.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5 py-1">
            {chain.steps.map((s, i) => (
              <div key={s.id} className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300",
                    s.status === "done"
                      ? "border-[#00C853] bg-[#00C853] text-white"
                      : s.status === "active"
                        ? "border-[#0052CC] text-[#0052CC]"
                        : "border-[#DFE1E6] text-[#C1C7D0]"
                  )}
                >
                  {s.status === "done" ? (
                    <Check size={14} strokeWidth={3} />
                  ) : s.status === "active" ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <span className="text-[11px] font-bold">{i + 1}</span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-[13px] font-semibold transition-colors duration-300", s.status === "pending" ? "text-[#C1C7D0]" : "text-[#172B4D]")}>
                    {s.label}
                  </p>
                  <p className="truncate font-mono text-[10px] text-[#6B778C]">
                    {s.status === "done"
                      ? s.docNo ?? `${CHAIN_STEPS[i].short}-…`
                      : s.status === "active"
                        ? "Generating…"
                        : "Queued"}
                  </p>
                </div>
                {s.status === "done" && s.code && (
                  <a
                    href={`/receipt/${s.code}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-full bg-[#E9F2FF] px-2 py-0.5 text-[9px] font-bold text-[#0052CC] hover:underline"
                  >
                    Digital
                  </a>
                )}
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeChain} className="rounded-xl">
              Close
            </Button>
            <Button
              disabled={chain.busy || !chain.deal}
              onClick={() => {
                if (!chain.deal) return;
                const docs = dealChainDocs(chain.deal).map((x) => x.doc);
                if (docs.length > 0) printDealDocs(chain.deal, docs);
              }}
              className="rounded-xl bg-[#0052CC] text-white hover:bg-[#0041A8]"
            >
              {chain.busy ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} Print Combined
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* hidden receipt print host (portaled to body, revealed by printReceiptArea) */}
      <ReceiptPrintHost docs={printDocs} mode={printMode} />
    </div>
  );
}

/* -- pieces ------------------------------------------------- */

function DealCard({
  deal, dragging, moving, matureBusy, onMature, onMatureAll, onDragStart, onDragEnd, onOpen,
}: {
  deal: DealDto;
  dragging: boolean;
  moving: boolean;
  matureBusy: boolean;
  onMature: (deal: DealDto, to: ChainStepId) => void;
  onMatureAll: (deal: DealDto) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  const next = nextMature(deal.stage);
  const docCount = Object.keys(deal.docs ?? {}).length;
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
      {(next || docCount > 0) && (
        <div
          className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-dashed border-[#F4F5F7] pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          {next && (
            <button
              onClick={() => onMature(deal, next)}
              disabled={matureBusy}
              title={MATURE_LABEL[next]}
              className="inline-flex items-center gap-1 rounded-full border border-[#B9C4D6] bg-white px-2 py-1 text-[10px] font-bold text-[#0052CC] transition hover:border-[#0052CC] hover:bg-[#E9F2FF] disabled:opacity-50"
            >
              <Zap size={10} /> {MATURE_SHORT[next]}
            </button>
          )}
          {deal.stage === "quotation" && (
            <button
              onClick={() => onMatureAll(deal)}
              disabled={matureBusy}
              title="Mature the full chain: Quotation → Proforma → Order → Invoice → Payment"
              className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#B8860B] to-[#D04A1E] px-2 py-1 text-[10px] font-bold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              <Sparkles size={10} /> Mature All
            </button>
          )}
          {docCount > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[9px] font-bold text-[#1B7A2E]">
              <Files size={9} /> {docCount} docs
            </span>
          )}
        </div>
      )}
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

function DealTable({
  deals, onOpen, matureBusy, onMature, onMatureAll, onPrintCombined,
}: {
  deals: DealDto[];
  onOpen: (id: string) => void;
  matureBusy: boolean;
  onMature: (deal: DealDto, to: ChainStepId) => void;
  onMatureAll: (deal: DealDto) => void;
  onPrintCombined: (deal: DealDto, docs: ChainDoc[]) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#DFE1E6] bg-white shadow-sm">
      <Table className="text-[12px]">
        <TableHeader>
          <TableRow className="bg-[#FAFBFC] hover:bg-[#FAFBFC]">
            {["Customer", "Title", "Stage", "Amount", "Docs", "Assignee", "Age", "Created", ""].map((h) => (
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
              <TableCell className="p-3">
                {Object.keys(d.docs ?? {}).length > 0 ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const docs = CHAIN_STEPS.map((s) => d.docs?.[s.id]).filter((x): x is ChainDoc => !!x);
                      onPrintCombined(d, docs);
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[10px] font-bold text-[#1B7A2E] transition hover:bg-[#D7EEDB]"
                    title="Print the combined document set"
                  >
                    <Files size={9} /> {Object.keys(d.docs ?? {}).length}
                  </button>
                ) : (
                  <span className="text-[#C1C7D0]">-</span>
                )}
              </TableCell>
              <TableCell className="p-3">
                <AssigneeChip id={d.assignee} />
              </TableCell>
              <TableCell className="p-3 text-[#6B778C]">{ago(d.createdAt)}</TableCell>
              <TableCell className="p-3 text-[#6B778C]">
                {new Date(d.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
              </TableCell>
              <TableCell className="p-3 text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-full px-2"
                      disabled={matureBusy}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Maturity actions for ${d.customerName}`}
                    >
                      <Zap size={12} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuLabel className="text-[11px] text-[#6B778C]">{d.customerName}</DropdownMenuLabel>
                    {nextMature(d.stage) && (
                      <DropdownMenuItem onClick={() => onMature(d, nextMature(d.stage)!)}>
                        <Zap className="h-4 w-4 text-[#0052CC]" /> {MATURE_LABEL[nextMature(d.stage)!]}
                      </DropdownMenuItem>
                    )}
                    {d.stage !== "paid" && (
                      <DropdownMenuItem onClick={() => onMatureAll(d)}>
                        <Sparkles className="h-4 w-4 text-[#B8860B]" /> Mature All At Once
                      </DropdownMenuItem>
                    )}
                    {Object.keys(d.docs ?? {}).length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            const docs = CHAIN_STEPS.map((s) => d.docs?.[s.id]).filter((x): x is ChainDoc => !!x);
                            onPrintCombined(d, docs);
                          }}
                        >
                          <Printer className="h-4 w-4 text-[#172B4D]" /> Print combined set
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
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
