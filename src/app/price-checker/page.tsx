"use client";

/**
 * Public PRICE CHECKER kiosk (Naivas style). Runs on a tablet/PC at a pillar
 * next to the shelves - no auth, no app shell, dark full-bleed .df-kiosk.
 * Scan with a barcode gun (guns press Enter) or type a name / gift card code.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Delete, Gift, Loader2, ScanBarcode, ScanLine, SearchX } from "lucide-react";
import { DukaMark } from "@/components/df/logo";
import { kes } from "@/lib/receipt";
import { cn } from "@/lib/utils";

interface PriceResult {
  found: boolean;
  type?: "product" | "giftcard";
  name?: string;
  emoji?: string;
  price?: number;
  unit?: string;
  category?: string;
  isScale?: boolean;
  kg?: number;
  computed?: number;
  balance?: number;
  initialBalance?: number;
  status?: string;
  error?: string;
}

type Phase = "idle" | "loading" | "found" | "missing";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"] as const;

export default function PriceCheckerPage() {
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<PriceResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastLookup = useRef("");
  const missTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lookup = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    lastLookup.current = q;
    setPhase("loading");
    try {
      const res = await fetch(`/api/price-check?code=${encodeURIComponent(q)}`, { cache: "no-store" });
      const data = (await res.json()) as PriceResult;
      setResult(data);
      setPhase(data.found ? "found" : "missing");
    } catch {
      setResult({ found: false, error: "Cannot reach the shop server" });
      setPhase("missing");
    }
  }, []);

  /* Enter = immediate lookup (barcode guns fire Enter after the code). */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") void lookup(code);
  };

  /* 300ms debounce so typing a product name checks itself. */
  useEffect(() => {
    const q = code.trim();
    if (!q || q === lastLookup.current) return;
    const t = setTimeout(() => void lookup(code), 300);
    return () => clearTimeout(t);
  }, [code, lookup]);

  /* Not-found auto-clears after 4s so the next customer starts fresh. */
  useEffect(() => {
    if (phase !== "missing") return;
    missTimer.current = setTimeout(() => {
      setPhase("idle");
      setResult(null);
      setCode("");
      inputRef.current?.focus();
    }, 4000);
    return () => {
      if (missTimer.current) clearTimeout(missTimer.current);
    };
  }, [phase]);

  const tapKey = (k: (typeof KEYS)[number]) => {
    if (k === "del") setCode((c) => c.slice(0, -1));
    else setCode((c) => (c + k).slice(0, 32));
  };

  const isGift = result?.type === "giftcard";
  const unitLine =
    result?.unit && result.unit !== "pc" ? `per ${result.unit}` : result?.isScale ? "per kg" : "each";

  return (
    <div className="df-kiosk flex min-h-screen flex-col" onClick={() => inputRef.current?.focus()}>
      {/* slim top bar */}
      <header className="flex items-center justify-between px-5 py-3 sm:px-8">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-[#00C853] p-1.5">
            <DukaMark white />
          </div>
          <div>
            <p className="font-display text-[14px] font-bold tracking-[0.22em] text-white">DUKAFLOW</p>
            <p className="text-[10px] font-medium uppercase tracking-widest text-white/40">Price Checker</p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-white/50">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00C853]" /> Live
        </span>
      </header>

      {/* scan field */}
      <div className="px-5 pt-2 sm:px-8">
        <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border-2 border-white/15 bg-white/5 px-5 py-3 focus-within:border-[#00C853]">
          <ScanBarcode size={26} className="shrink-0 text-[#00C853]" />
          <input
            ref={inputRef}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={onKeyDown}
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            aria-label="Scan barcode or type product name"
            placeholder="Scan barcode or type name"
            className="w-full bg-transparent font-mono text-2xl font-bold uppercase tracking-wider text-white caret-[#00C853] outline-none placeholder:text-white/25 sm:text-4xl"
          />
          {phase === "loading" && <Loader2 size={24} className="shrink-0 animate-spin text-white/50" />}
        </div>
        <p className="mt-2 text-center text-[11px] font-medium uppercase tracking-[0.3em] text-white/30">
          Scan barcode or type name
        </p>
      </div>

      {/* result stage */}
      <main className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center sm:px-8">
        {phase === "idle" && (
          <div className="flex flex-col items-center gap-4 text-white/35">
            <ScanLine size={72} strokeWidth={1.4} />
            <p className="font-display text-2xl font-bold text-white/60">Ready to scan</p>
            <p className="max-w-sm text-[13px] leading-relaxed text-white/35">
              Point the barcode at the gun, or type the product name. Gift card codes show the remaining balance.
            </p>
          </div>
        )}

        {phase === "found" && result && isGift && (
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#00C853]/15">
              <Gift size={40} className="text-[#00C853]" />
            </div>
            <p className="font-display text-4xl font-extrabold text-white sm:text-6xl">{result.name}</p>
            <p className="text-5xl font-black tabular-nums text-[#00E676] sm:text-7xl">
              Balance {kes(result.balance ?? 0)}
            </p>
            <div className="flex gap-2 pt-2">
              <span className="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-[12px] font-bold uppercase tracking-widest text-white/60">
                Gift Card
              </span>
              {result.status && (
                <span className="rounded-full border border-[#00C853]/40 bg-[#00C853]/10 px-4 py-1.5 text-[12px] font-bold uppercase tracking-widest text-[#00E676]">
                  {result.status}
                </span>
              )}
            </div>
          </div>
        )}

        {phase === "found" && result && !isGift && (
          <div className="flex flex-col items-center gap-2">
            {result.emoji && <span className="text-7xl leading-none sm:text-8xl">{result.emoji}</span>}
            <p className="max-w-4xl font-display text-4xl font-extrabold leading-tight text-white sm:text-6xl">
              {result.name}
            </p>
            <p className="text-7xl font-black tabular-nums text-[#00E676] sm:text-8xl">{kes(result.price ?? 0)}</p>
            <p className="text-xl font-semibold uppercase tracking-[0.25em] text-white/50">{unitLine}</p>
            {result.isScale && result.kg ? (
              <p className="mt-1 rounded-2xl border border-[#00C853]/40 bg-[#00C853]/10 px-6 py-2 font-mono text-xl font-bold text-[#00E676] sm:text-2xl">
                {result.kg} kg x {kes(result.price ?? 0)} = {kes(result.computed ?? 0)}
              </p>
            ) : null}
            {result.category ? (
              <span className="mt-3 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-[12px] font-bold uppercase tracking-widest text-white/60">
                {result.category}
              </span>
            ) : null}
          </div>
        )}

        {phase === "missing" && (
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#FF5630]/15">
              <SearchX size={40} className="text-[#FF6B4A]" />
            </div>
            <p className="font-display text-5xl font-black tracking-tight text-[#FF6B4A] sm:text-7xl">NO MATCH</p>
            <p className="text-lg font-medium text-white/50">{result?.error ?? "No match for this code"}</p>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/25">
              Clearing - try the next item
            </p>
          </div>
        )}
      </main>

      {/* touch keypad - tablets at the pillar have no keyboard */}
      <div className="df-no-print mx-auto w-full max-w-md px-5 pb-6">
        <div className="grid grid-cols-4 gap-2">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                tapKey(k);
              }}
              aria-label={k === "del" ? "Delete last character" : `Type ${k}`}
              className={cn(
                "flex h-12 items-center justify-center rounded-xl border text-xl font-bold transition active:scale-95 sm:h-14",
                k === "del"
                  ? "border-[#FF5630]/40 bg-[#FF5630]/10 text-[#FF6B4A]"
                  : "border-white/10 bg-white/5 text-white hover:bg-white/10"
              )}
            >
              {k === "del" ? <Delete size={20} /> : k}
            </button>
          ))}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void lookup(code);
            }}
            aria-label="Check price"
            className="col-span-1 flex h-12 items-center justify-center rounded-xl bg-[#00C853] text-[13px] font-black uppercase tracking-wider text-[#04240F] transition active:scale-95 sm:h-14"
          >
            Enter
          </button>
        </div>
      </div>
    </div>
  );
}
