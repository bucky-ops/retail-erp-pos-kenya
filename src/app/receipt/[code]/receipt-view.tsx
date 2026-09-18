"use client";

/**
 * Public digital receipt page (the QR target). Standalone layout: no app
 * shell, no auth, no store dependencies - a customer phone is the primary
 * screen. Loads GET /api/digital-receipt?code=... (works with the receipt
 * code OR the uuid alias) and renders the universal ReceiptDocument.
 */

import { ReactNode, useEffect, useRef, useState } from "react";
import {
  Check, FileDown, FileText, Link2, Loader2, MessageCircle, Printer, ReceiptText, SearchX,
} from "lucide-react";
import { ReceiptDocument } from "@/components/df/receipt-document";
import { printReceiptDocs, printElementStandalone } from "@/services/receiptService";
import { payloadToReceiptDoc } from "@/components/df/receipt-doc-adapter";
import { DukaMark } from "@/components/df/logo";
import { ReceiptDocData, kes } from "@/lib/receipt";
import { cn } from "@/lib/utils";

interface ReceiptApi {
  ok: boolean;
  receipt?: {
    receiptCode: string;
    uuid: string;
    kind: string;
    title: string;
    refNo: string;
    url: string;
    qrDataUrl: string;
    payload: unknown;
    createdAt: string;
  };
  error?: string;
}

type Mode = "thermal" | "a4";

/** Print resets: undo preview scaling + clipping so the paper prints 1:1. */
function ensurePrintStyle(): void {
  if (document.getElementById("df-receipt-page-print")) return;
  const st = document.createElement("style");
  st.id = "df-receipt-page-print";
  st.textContent =
    "@media print { .df-scale-wrap, .df-scale-wrap * { transform: none !important; }" +
    " .df-scale-wrap { overflow: visible !important; height: auto !important; } }";
  document.head.appendChild(st);
}

export default function ReceiptView({ code }: { code: string }) {
  const [status, setStatus] = useState<"loading" | "missing" | "ready">("loading");
  const [doc, setDoc] = useState<ReceiptDocData | null>(null);
  const [meta, setMeta] = useState<{ url: string; kind: string; refNo: string; createdAt: string } | null>(null);
  const [mode, setMode] = useState<Mode>("thermal");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/digital-receipt?code=${encodeURIComponent(code)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json()) as ReceiptApi;
        if (!alive) return;
        if (!res.ok || !data.ok || !data.receipt) {
          setStatus("missing");
          return;
        }
        const r = data.receipt;
        setDoc(payloadToReceiptDoc(r.payload, { receiptCode: r.receiptCode, kind: r.kind, title: r.title, refNo: r.refNo, createdAt: r.createdAt }));
        setMeta({ url: r.url, kind: r.kind, refNo: r.refNo, createdAt: r.createdAt });
        setStatus("ready");
      })
      .catch(() => alive && setStatus("missing"));
    return () => {
      alive = false;
    };
  }, [code]);

  const shareUrl = meta?.url ?? "";
  const shareText = `Your DukaFlow receipt ${code} - ${shareUrl}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl || window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked - ignore */
    }
  };

  const pts = doc?.pointsLine;
  const showPoints = Boolean(pts && ((pts.earned ?? 0) > 0 || (pts.balance ?? 0) > 0 || (pts.redeemed ?? 0) > 0));

  return (
    <div className="min-h-screen bg-[#F4F5F7] font-inter">
      {/* header */}
      <header className="df-no-print bg-[#172B4D] text-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-[#0052CC] p-1.5">
              <DukaMark white />
            </div>
            <div>
              <p className="font-display text-[15px] font-bold leading-tight">DukaFlow</p>
              <p className="text-[11px] text-white/60">Digital Receipt Portal</p>
            </div>
          </div>
          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 font-mono text-[11px] font-semibold tracking-wide">
            {code}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-14 pt-5 sm:px-6">
        {status === "loading" && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#DFE1E6] bg-white px-6 py-14 text-center shadow-sm">
            <Loader2 size={30} className="animate-spin text-[#0052CC]" />
            <p className="text-[13px] font-medium text-[#6B778C]">Loading receipt {code}...</p>
          </div>
        )}

        {status === "missing" && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#FFCDD2] bg-white px-6 py-12 text-center shadow-sm">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FFEBEE]">
              <SearchX size={26} className="text-[#C5221F]" />
            </div>
            <h1 className="font-display text-xl font-bold text-[#172B4D]">Receipt not found</h1>
            <p className="max-w-sm text-[13px] leading-relaxed text-[#6B778C]">
              We could not find a receipt for code <span className="font-mono font-semibold text-[#172B4D]">{code}</span>.
              Check the QR link you scanned, or ask the cashier to reprint - every DukaFlow receipt carries a working QR.
            </p>
            <a
              href="/"
              className="mt-1 inline-flex h-10 items-center rounded-xl bg-[#172B4D] px-5 text-[13px] font-semibold text-white transition hover:bg-[#0F1D33]"
            >
              Go to DukaFlow
            </a>
          </div>
        )}

        {status === "ready" && doc && meta && (
          <div className="space-y-4">
            {/* loyalty hero - prominent when the payload carries points */}
            {showPoints && pts && (
              <section
                aria-label="Loyalty points"
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-[#00C853] to-[#009A3E] px-5 py-4 text-white shadow-sm"
              >
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-white/75">Points earned</p>
                  <p className="font-display text-3xl font-extrabold tabular-nums">+{pts.earned ?? 0} pts</p>
                </div>
                {(pts.balance ?? 0) > 0 && (
                  <div className="text-right">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-white/75">Loyalty balance</p>
                    <p className="font-display text-xl font-bold tabular-nums">
                      {pts.balance} pts - {kes((pts.balance ?? 0) * (pts.value ?? 1))}
                    </p>
                  </div>
                )}
              </section>
            )}

            {/* mode toggle + actions */}
            <div className="df-no-print flex flex-wrap items-center justify-between gap-2">
              <div className="flex rounded-xl border border-[#DFE1E6] bg-white p-1 shadow-sm">
                {(
                  [
                    { id: "thermal", label: "80mm Roll", icon: ReceiptText },
                    { id: "a4", label: "A4 Sheet", icon: FileText },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    aria-pressed={mode === m.id}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition",
                      mode === m.id ? "bg-[#172B4D] text-white" : "text-[#6B778C] hover:text-[#172B4D]"
                    )}
                  >
                    <m.icon size={13} /> {m.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ActionBtn
                  icon={<Printer size={14} />}
                  label="Print"
                  onClick={() => {
                    void printReceiptDocs(doc, mode);
                  }}
                />
                <ActionBtn
                  icon={<FileDown size={14} />}
                  label="Save PDF"
                  onClick={() => {
                    ensurePrintStyle();
                    window.print();
                  }}
                />
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DFE1E6] bg-white px-3 text-[12px] font-semibold text-[#172B4D] shadow-sm transition hover:border-[#00C853] hover:text-[#1B7A2E]"
                >
                  <MessageCircle size={14} /> WhatsApp
                </a>
                <ActionBtn
                  icon={copied ? <Check size={14} className="text-[#1B7A2E]" /> : <Link2 size={14} />}
                  label={copied ? "Copied!" : "Copy Link"}
                  onClick={copyLink}
                />
              </div>
            </div>

            {/* the document itself */}
            <div className="rounded-2xl border border-[#DFE1E6] bg-[#E9EDF3] p-3 shadow-sm sm:p-6">
              {mode === "thermal" ? (
                <ReceiptDocument data={doc} mode="thermal" />
              ) : (
                <FitWidth natural={718}>
                  <ReceiptDocument data={doc} mode="a4" />
                </FitWidth>
              )}
            </div>

            {/* meta strip */}
            <div className="df-no-print flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-center text-[11px] text-[#6B778C]">
              <span>
                Reference: <span className="font-semibold text-[#172B4D]">{meta.refNo || doc.docNo}</span>
              </span>
              <span>
                Kind: <span className="font-semibold text-[#172B4D]">{meta.kind}</span>
              </span>
              <span>
                Issued: <span className="font-semibold text-[#172B4D]">{doc.date}</span>
              </span>
            </div>
          </div>
        )}
      </main>

      <footer className="df-no-print pb-8 text-center text-[11px] text-[#6B778C]">
        Powered by DukaFlow POS - offline-first retail for Kenya
      </footer>
    </div>
  );
}

/** Scales a fixed-width document (190mm A4 = 718px) down to its container. */
function FitWidth({ natural, children }: { natural: number; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [h, setH] = useState(945);

  useEffect(() => {
    const el = outer.current;
    const doc = inner.current;
    if (!el) return;
    const update = () => {
      const s = Math.min(1, el.clientWidth / natural);
      setScale(s);
      if (doc) setH(Math.max(945, doc.offsetHeight));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (doc) ro.observe(doc);
    return () => ro.disconnect();
  }, [natural]);

  return (
    <div ref={outer} className="w-full">
      <div className="df-scale-wrap overflow-hidden mx-auto" style={{ height: h * scale, width: natural * scale }}>
        <div ref={inner} style={{ width: natural, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DFE1E6] bg-white px-3 text-[12px] font-semibold text-[#172B4D] shadow-sm transition hover:border-[#0052CC] hover:text-[#0052CC]"
    >
      {icon} {label}
    </button>
  );
}
