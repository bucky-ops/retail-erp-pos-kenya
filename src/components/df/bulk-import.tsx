"use client";

/**
 * Bulk Stock Import - spreadsheet paste → validated diff preview → apply.
 *
 * Accepts CSV / tab-separated rows of `code,qty` (barcode or SKU, header and
 * comment lines skipped) and runs them through the two-phase
 * /api/inventory/bulk-import endpoint: a dry-run renders every line as a
 * green/red/neutral diff chip against live stock, and only a clean preview
 * unlocks Apply. Used for opening stock, delivery notes and supplier sheets.
 */

import { useCallback, useState } from "react";
import {
  Check,
  ClipboardPaste,
  FileUp,
  Loader2,
  ShieldCheck,
  Sparkle,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface StoreLite {
  id: number;
  name: string;
}

interface PreviewRow {
  code: string;
  qty: number;
  ok: boolean;
  error?: string;
  productName?: string;
  emoji?: string;
  unit?: string;
  currentQty?: number;
  newQty?: number;
  delta?: number;
}

interface ApplyResult {
  applied: number;
  ups: number;
  downs: number;
  skippedErrors: number;
  rows: { name: string; emoji: string; delta: number; newQty: number }[];
}

const SAMPLE = `# barcode or sku,qty - lines starting with # are ignored
6200001000000,40
CMT-001,25
PNT-012,12`;

/** Parses raw pasted text → rows; skips blanks, comments and header lines. */
export function parseBulkText(text: string): { code: string; qty: number }[] {
  const rows: { code: string; qty: number }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/[,;\t]/).map((s) => s.trim());
    if (parts.length < 2) continue;
    const [code, qtyRaw] = parts;
    if (/^code|barcode|sku$/i.test(code)) continue; // header row
    const qty = Number(qtyRaw.replace(/[^\d.-]/g, ""));
    rows.push({ code, qty: Number.isFinite(qty) ? qty : NaN });
  }
  return rows;
}

export function BulkImportDialog({
  open,
  onOpenChange,
  stores,
  defaultStoreId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  stores: StoreLite[];
  defaultStoreId: number;
  onDone?: () => void | Promise<void>;
}) {
  const [storeId, setStoreId] = useState(String(defaultStoreId));
  const [mode, setMode] = useState<"set" | "add">("set");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; valid: number; errors: number; storeName: string } | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = useCallback(() => {
    setText("");
    setPreview(null);
    setResult(null);
  }, []);

  const parsed = parseBulkText(text);
  const canValidate = parsed.length > 0 && !!storeId && !busy;

  const validate = async () => {
    setBusy(true);
    setResult(null);
    try {
      const d = await api.post<{ ok: boolean; rows: PreviewRow[]; valid: number; errors: number; storeName: string }>(
        "/api/inventory/bulk-import",
        { storeId: Number(storeId), mode, dryRun: true, rows: parsed }
      );
      setPreview({ rows: d.rows, valid: d.valid, errors: d.errors, storeName: d.storeName });
    } catch (e) {
      toast({ title: "Validation failed", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview || preview.valid === 0) return;
    setBusy(true);
    try {
      const d = await api.post<{ ok: boolean; applied: number; ups: number; downs: number; skippedErrors: number; rows: ApplyResult["rows"] }>(
        "/api/inventory/bulk-import",
        { storeId: Number(storeId), mode, dryRun: false, rows: parsed }
      );
      setResult({ applied: d.applied, ups: d.ups, downs: d.downs, skippedErrors: d.skippedErrors, rows: d.rows });
      setPreview(null);
      toast({
        title: `📥 ${d.applied} stock line${d.applied === 1 ? "" : "s"} imported`,
        description: `${d.ups} up • ${d.downs} down • #stock-alerts notified`,
      });
      await onDone?.();
    } catch (e) {
      toast({ title: "Import failed", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setTimeout(reset, 150);
      }}
    >
      <DialogContent className="max-w-[640px] overflow-hidden rounded-2xl p-0">
        <div className="border-b border-[#DFE1E6] bg-[#FAFBFC] p-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-[15px] font-bold text-[#172B4D]">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8F5E9] text-[#1B7A2E]">
                <FileUp size={15} />
              </span>
              Bulk stock import
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              Paste a spreadsheet of barcode/SKU + quantity - preview every diff before anything is written.
            </DialogDescription>
          </DialogHeader>
        </div>

        {result ? (
          /* ── result card ── */
          <div className="p-4">
            <div className="rounded-xl border border-[#C8E6C9] bg-[#E8F5E9] p-4 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#00C853] text-white shadow-[0_6px_18px_rgba(0,200,83,0.4)]">
                <Check size={20} />
              </span>
              <p className="mt-2 font-display text-[15px] font-bold text-[#1B7A2E]">
                {result.applied} line{result.applied === 1 ? "" : "s"} applied
              </p>
              <p className="text-[12px] text-[#1B7A2E]/80">
                {result.ups} up • {result.downs} down • {result.applied - result.ups - result.downs} unchanged
                {result.skippedErrors > 0 ? ` • ${result.skippedErrors} invalid row${result.skippedErrors === 1 ? "" : "s"} skipped` : ""}
              </p>
            </div>
            <div className="df-scroll mt-3 max-h-[220px] space-y-1 overflow-y-auto pr-0.5">
              {result.rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-[#F4F5F7] bg-[#FAFBFC] px-2.5 py-1.5">
                  <span className="text-[14px]">{r.emoji}</span>
                  <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#172B4D]">{r.name}</p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 font-mono text-[10.5px] font-bold",
                      r.delta > 0 ? "bg-[#E8F5E9] text-[#1B7A2E]" : r.delta < 0 ? "bg-[#FFEBE8] text-[#C62828]" : "bg-[#F4F5F7] text-[#6B778C]"
                    )}
                  >
                    {r.delta > 0 ? "+" : ""}{r.delta} → {r.newQty}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={reset}
                className="h-10 rounded-xl border-[#DFE1E6] bg-white text-[12px] font-bold text-[#172B4D]"
              >
                <ClipboardPaste size={13} /> Import more
              </Button>
              <Button onClick={() => onOpenChange(false)} className="h-10 rounded-xl bg-[#0052CC] text-[12px] font-bold hover:bg-[#0041A8]">
                Done
              </Button>
            </div>
          </div>
        ) : (
          /* ── input + preview ── */
          <div className="p-4">
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <Label htmlFor="bi-store" className="text-[10px] font-semibold uppercase tracking-wide text-[#6B778C]">
                  Store
                </Label>
                <select
                  id="bi-store"
                  value={storeId}
                  onChange={(e) => {
                    setStoreId(e.target.value);
                    setPreview(null);
                  }}
                  className="mt-1 h-9 w-full rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-2.5 text-[12px] font-semibold text-[#172B4D] outline-none focus:border-[#0052CC]"
                >
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="bi-mode" className="text-[10px] font-semibold uppercase tracking-wide text-[#6B778C]">
                  Mode
                </Label>
                <select
                  id="bi-mode"
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value as "set" | "add");
                    setPreview(null);
                  }}
                  className="mt-1 h-9 w-full rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-2.5 text-[12px] font-semibold text-[#172B4D] outline-none focus:border-[#0052CC]"
                >
                  <option value="set">Set - qty becomes exactly this</option>
                  <option value="add">Add - qty += this (deliveries)</option>
                </select>
              </div>
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="bi-text" className="text-[10px] font-semibold uppercase tracking-wide text-[#6B778C]">
                  Paste rows (code, qty)
                </Label>
                <button
                  type="button"
                  onClick={() => {
                    setText(SAMPLE);
                    setPreview(null);
                  }}
                  className="flex items-center gap-1 text-[10.5px] font-bold text-[#0052CC] hover:underline"
                >
                  <Sparkle size={10} /> Fill sample
                </button>
              </div>
              <Textarea
                id="bi-text"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setPreview(null);
                }}
                placeholder={"6200001000000,40\nCMT-001,25\n# barcode or SKU - one per line"}
                rows={5}
                className="df-scroll mt-1 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] font-mono text-[12px]"
              />
              <p className="mt-1 text-[10px] text-[#6B778C]">
                {parsed.length} row{parsed.length === 1 ? "" : "s"} parsed • accepts CSV or tab-separated, “#” comments skipped
              </p>
            </div>

            {preview && (
              <div className="mt-3 rounded-xl border border-[#DFE1E6] bg-white">
                <div className="flex flex-wrap items-center gap-2 border-b border-[#DFE1E6] px-3 py-2">
                  <ShieldCheck size={13} className="text-[#0052CC]" />
                  <p className="flex-1 text-[11.5px] font-bold text-[#172B4D]">
                    Preview - {preview.valid} valid{preview.errors > 0 ? `, ${preview.errors} will be skipped` : ""}
                  </p>
                  <span className="rounded-full bg-[#F4F5F7] px-2 py-0.5 text-[10px] font-bold text-[#6B778C]">{preview.storeName}</span>
                </div>
                <div className="df-scroll max-h-[200px] overflow-y-auto">
                  {preview.rows.map((r, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex items-center gap-2 border-b border-[#F4F5F7] px-3 py-1.5 last:border-0",
                        r.ok ? "bg-white" : "bg-[#FFEBEE]"
                      )}
                    >
                      <span className="w-5 text-[14px]">{r.ok ? r.emoji : <TriangleAlert size={12} className="text-[#C62828]" />}</span>
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-[11.5px] font-semibold text-[#172B4D]", !r.ok && "text-[#C62828]")}>
                          {r.productName ?? r.code}
                        </p>
                        <p className="truncate font-mono text-[9.5px] text-[#6B778C]">
                          {r.ok ? `${r.code} • now ${r.currentQty} ${r.unit ?? ""}` : r.error}
                        </p>
                      </div>
                      {r.ok ? (
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-bold",
                            (r.delta ?? 0) > 0
                              ? "bg-[#E8F5E9] text-[#1B7A2E]"
                              : (r.delta ?? 0) < 0
                                ? "bg-[#FFEBE8] text-[#C62828]"
                                : "bg-[#F4F5F7] text-[#6B778C]"
                          )}
                        >
                          {(r.delta ?? 0) > 0 ? "+" : ""}{r.delta} → {r.newQty}
                        </span>
                      ) : (
                        <X size={13} className="shrink-0 text-[#C62828]" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                disabled={!canValidate}
                onClick={() => void validate()}
                className="h-10 rounded-xl border-[#DFE1E6] bg-white px-4 text-[12px] font-bold text-[#172B4D]"
              >
                {busy && !preview ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                Validate
              </Button>
              <Button
                disabled={busy || !preview || preview.valid === 0}
                onClick={() => void apply()}
                className="h-10 rounded-xl bg-[#00C853] px-5 text-[12px] font-bold text-[#052E14] shadow-[0_6px_18px_rgba(0,200,83,0.35)] hover:bg-[#00B34A]"
              >
                {busy && preview ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                Apply {preview && preview.valid > 0 ? preview.valid : ""}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
