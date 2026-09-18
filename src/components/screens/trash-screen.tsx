"use client";

/**
 * Trash + Audit governance screen (Naivas/ERPNext style).
 *  - Trash Bin: every soft-deleted record with who + why, one-click restore.
 *  - Audit Trail: append-only timeline of DELETE / CREATE / RESTORE / MATURE /
 *    DAY_CLOSE events (who did what, when).
 * TrashBinPanel and AuditTrailPanel are exported so Settings can embed them.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { History, RotateCcw, ScrollText, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/lib/store";
import { Panel, ScreenHeader, TableSkeleton, EmptyState } from "@/components/df/shared";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";

/* -- contracts ------------------------------------------------ */

export interface TrashItemDto {
  id: number;
  entity: string;
  entityId: number;
  label: string;
  reason: string;
  deletedBy: string;
  status: string;
  createdAt: string;
  restoredAt?: string | null;
}

export interface AuditLogDto {
  id: number;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  label: string;
  details: string;
  createdAt: string;
}

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

const relTime = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const fullTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

const ACTION_TONE: Record<string, string> = {
  DELETE: "bg-[#FFEBEE] text-[#C5221F] border-[#FFCDD2]",
  CREATE: "bg-[#E8F5E9] text-[#1B7A2E] border-[#C8E6C9]",
  RESTORE: "bg-[#E9F2FF] text-[#0052CC] border-[#B3D4FF]",
  MATURE: "bg-[#F3E8FF] text-[#7C3AED] border-[#E9D5FF]",
  DAY_CLOSE: "bg-[#FFF8E1] text-[#B8860B] border-[#FFE0B2]",
};

const actionTone = (action: string) => ACTION_TONE[action.toUpperCase()] ?? "bg-[#F4F5F7] text-[#6B778C] border-[#DFE1E6]";

const ENTITY_TONE = "bg-[#F4F5F7] text-[#172B4D] border-[#DFE1E6]";

/* -- Trash bin ------------------------------------------------ */

export function TrashBinPanel() {
  const user = useApp((s) => s.user);
  const [items, setItems] = useState<TrashItemDto[] | null>(null);
  const [filter, setFilter] = useState<string>("All");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmItem, setConfirmItem] = useState<TrashItemDto | null>(null);

  const load = useCallback(() => {
    api
      .get<{ items: TrashItemDto[] }>("/api/trash")
      .then((d) => setItems(d.items))
      .catch((e: unknown) => {
        setItems([]);
        toast({ title: "Could not load the trash bin", description: err(e), variant: "destructive" });
      });
  }, []);

  useEffect(load, [load]);

  const entities = useMemo(
    () => ["All", ...Array.from(new Set((items ?? []).map((i) => i.entity))).sort()],
    [items]
  );
  const visible = useMemo(
    () => (items ?? []).filter((i) => filter === "All" || i.entity === filter),
    [items, filter]
  );

  const restore = async (item: TrashItemDto) => {
    setBusyId(item.id);
    try {
      const res = await api.put<{ ok: boolean; restored: { entity: string; label: string } }>("/api/trash", {
        trashId: item.id,
        restoredBy: user?.name ?? "manager",
      });
      toast({ title: "Restored", description: `${res.restored.label} is back in ${res.restored.entity}.` });
      load();
    } catch (e) {
      toast({ title: "Restore failed", description: err(e), variant: "destructive" });
    } finally {
      setBusyId(null);
      setConfirmItem(null);
    }
  };

  return (
    <Panel>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Trash Bin</h3>
          <p className="text-[12px] text-[#6B778C]">Soft-deleted records - nothing is ever lost by accident.</p>
        </div>
        <Badge variant="outline" className="text-[11px]">
          {items ? `${visible.length} item${visible.length === 1 ? "" : "s"}` : "..."}
        </Badge>
      </div>

      {/* entity filter chips */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {entities.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setFilter(e)}
            aria-pressed={filter === e}
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] font-semibold transition",
              filter === e
                ? "border-[#172B4D] bg-[#172B4D] text-white"
                : "border-[#DFE1E6] bg-white text-[#6B778C] hover:border-[#C9CFDA] hover:text-[#172B4D]"
            )}
          >
            {e}
          </button>
        ))}
      </div>

      {items === null ? (
        <TableSkeleton rows={4} cols={4} />
      ) : visible.length === 0 ? (
        <EmptyState icon={<Trash2 size={20} />} title="Trash bin is empty" sub="Deleted products, customers, suppliers and workflow documents will appear here." />
      ) : (
        <div className="df-slim-scroll max-h-[460px] space-y-2 overflow-y-auto pr-1">
          {visible.map((it) => {
            const restored = it.status === "Restored";
            return (
              <div
                key={it.id}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-xl border border-[#DFE1E6] bg-white px-3.5 py-2.5 transition hover:border-[#C9CFDA]",
                  restored && "opacity-70"
                )}
              >
                <Badge variant="outline" className={cn("shrink-0 text-[10px] uppercase tracking-wide", ENTITY_TONE)}>
                  {it.entity}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-[#172B4D]">{it.label}</p>
                  <p className="truncate text-[11px] text-[#6B778C]" title={it.reason}>
                    {it.reason} - by {it.deletedBy || "manager"}, {fullTime(it.createdAt)}
                  </p>
                </div>
                {restored ? (
                  <Badge variant="outline" className="shrink-0 border-[#C8E6C9] bg-[#E8F5E9] text-[10px] text-[#1B7A2E]">
                    Restored
                  </Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === it.id}
                    onClick={() => setConfirmItem(it)}
                    className="h-8 shrink-0 gap-1.5 text-[12px]"
                  >
                    <RotateCcw size={13} /> Restore
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* restore confirmation */}
      <AlertDialog open={Boolean(confirmItem)} onOpenChange={(o) => !o && setConfirmItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore {confirmItem?.entity}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmItem?.label} will reappear everywhere it was listed. This action is recorded in the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmItem && restore(confirmItem)}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

/* -- Audit trail ---------------------------------------------- */

export function AuditTrailPanel() {
  const [logs, setLogs] = useState<AuditLogDto[] | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<{ logs: AuditLogDto[] }>("/api/audit?limit=150")
      .then((d) => alive && setLogs(d.logs))
      .catch((e: unknown) => {
        if (!alive) return;
        setLogs([]);
        toast({ title: "Could not load the audit trail", description: err(e), variant: "destructive" });
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Panel>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Audit Trail</h3>
          <p className="text-[12px] text-[#6B778C]">Append-only record of who did what, when - latest 150 events.</p>
        </div>
        <Badge variant="outline" className="text-[11px]">{logs ? `${logs.length} events` : "..."}</Badge>
      </div>

      {logs === null ? (
        <TableSkeleton rows={5} cols={3} />
      ) : logs.length === 0 ? (
        <EmptyState icon={<ScrollText size={20} />} title="No audit events yet" sub="Deletes, restores, maturities and day closes will land here." />
      ) : (
        <ol className="df-slim-scroll relative max-h-[520px] space-y-0 overflow-y-auto pl-5 pr-1">
          {logs.map((log, i) => (
            <li key={log.id} className="relative pb-4">
              {/* timeline spine + dot */}
              {i < logs.length - 1 && <span aria-hidden className="absolute left-[-11px] top-4 h-full w-px bg-[#DFE1E6]" />}
              <span
                aria-hidden
                className={cn(
                  "absolute left-[-15px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white shadow",
                  log.action === "DELETE" ? "bg-[#FF5630]" : log.action === "RESTORE" ? "bg-[#0052CC]" : log.action === "MATURE" ? "bg-[#7C3AED]" : log.action === "DAY_CLOSE" ? "bg-[#FFAB00]" : "bg-[#00C853]"
                )}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn("text-[10px] font-bold uppercase tracking-wide", actionTone(log.action))}>
                  {log.action}
                </Badge>
                <span className="text-[12.5px] font-semibold text-[#172B4D]">{log.actor}</span>
                <span className="text-[12px] text-[#6B778C]">
                  {log.entity}
                  {log.label ? ` - ${log.label}` : ""}
                </span>
                <span className="ml-auto text-[11px] text-[#6B778C]" title={fullTime(log.createdAt)}>
                  {relTime(log.createdAt)}
                </span>
              </div>
              {log.details ? (
                <p className="mt-0.5 line-clamp-2 break-words text-[11px] text-[#6B778C]">{log.details}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/* -- Screen --------------------------------------------------- */

export default function TrashScreen() {
  return (
    <div className="space-y-4">
      <ScreenHeader
        title="Trash + Audit"
        subtitle="Governance for every delete and restore - who, what, why, when."
      />
      <Tabs defaultValue="trash">
        <TabsList className="h-10 bg-[#F4F5F7] p-1">
          <TabsTrigger value="trash" className="gap-1.5 px-4 text-[13px]">
            <Trash2 size={14} /> Trash Bin
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5 px-4 text-[13px]">
            <History size={14} /> Audit Trail
          </TabsTrigger>
        </TabsList>
        <TabsContent value="trash" className="mt-4">
          <TrashBinPanel />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditTrailPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
