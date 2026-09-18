"use client";

/**
 * POS engine - shared supermarket-floor helpers for the Naivas-style POS.
 *
 * - ScannerBuffer: USB barcode guns type characters fast (<80 ms apart) then
 *   send Enter. This buffer collects the burst and resolves it on Enter, or
 *   on an 80 ms idle timeout for no-enter scanners, while ignoring slow
 *   human typing.
 * - playScanTone: WebAudio success/error beep.
 * - resolveScan: instant local catalog resolution (exact barcode/SKU plus
 *   EAN-13 weight-scale barcodes via parseScaleBarcode).
 * - remotePriceCheck: /api/price-check fallback (resolves scale barcodes
 *   server side and doubles as the kiosk price checker).
 * - Display pole: BroadcastChannel("dukaflow-display") cart mirror for the
 *   second-window customer display at /display.
 * - Hold/resume localStorage mirror so parked carts survive offline refresh.
 */

import { parseScaleBarcode } from "@/lib/receipt";
import type { CartLine, ProductDto } from "@/types";

/* -- scanner keystroke buffer --------------------------------- */

export interface ScannerBufferOptions {
  /** keystrokes closer than this belong to one gun burst (default 80 ms) */
  gapMs?: number;
  /** burst ends after this silence even without Enter (default 80 ms) */
  idleMs?: number;
  /** min chars for Enter to count as a scan (default 6) */
  minEnterLen?: number;
  /** min chars for the idle timeout to count as a scan (default 8) */
  minIdleLen?: number;
  onScan: (code: string, via: "enter" | "idle") => void;
}

export class ScannerBuffer {
  private chars = "";
  private lastAt = 0;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private readonly gapMs: number;
  private readonly idleMs: number;
  private readonly minEnterLen: number;
  private readonly minIdleLen: number;
  private readonly onScan: ScannerBufferOptions["onScan"];

  constructor(opts: ScannerBufferOptions) {
    this.gapMs = opts.gapMs ?? 80;
    this.idleMs = opts.idleMs ?? 80;
    this.minEnterLen = opts.minEnterLen ?? 6;
    this.minIdleLen = opts.minIdleLen ?? 8;
    this.onScan = opts.onScan;
  }

  /** Feed one keydown. Returns true when the key was consumed by the scanner. */
  key(e: KeyboardEvent): boolean {
    if (e.key.length === 1) {
      const now = performance.now();
      if (now - this.lastAt > this.gapMs) this.chars = "";
      this.chars += e.key;
      this.lastAt = now;
      if (this.idle) clearTimeout(this.idle);
      if (this.chars.length >= this.minIdleLen) {
        this.idle = setTimeout(() => {
          const code = this.chars;
          this.reset();
          if (this.looksLikeScan(code)) this.onScan(code, "idle");
        }, this.idleMs);
      }
      return false; // let the character flow into whatever is focused
    }
    if (e.key === "Enter") {
      const code = this.chars;
      const burst = performance.now() - this.lastAt <= this.gapMs + 5;
      this.reset();
      if (code.length >= this.minEnterLen && code.length <= 24 && burst) {
        this.onScan(code, "enter");
        return true;
      }
      return false; // human Enter - let the focused control handle it
    }
    return false; // Shift etc. keep the burst alive
  }

  reset(): void {
    this.chars = "";
    this.lastAt = 0;
    if (this.idle) {
      clearTimeout(this.idle);
      this.idle = null;
    }
  }

  dispose(): void {
    this.reset();
  }

  /** idle resolution needs a barcode-looking burst (mostly digits) */
  private looksLikeScan(code: string): boolean {
    if (code.length < this.minIdleLen || code.length > 24) return false;
    const digits = (code.match(/\d/g) ?? []).length;
    return digits / code.length >= 0.8;
  }
}

/* -- scan feedback (WebAudio beep + no dependencies) ----------- */

let audioCtx: AudioContext | null = null;

export function playScanTone(ok: boolean): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx = audioCtx ?? new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = ok ? 1046 : 220;
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.12 : 0.25));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.12 : 0.25));
  } catch {
    /* audio unavailable - visual flash still fires */
  }
}

/* -- scan resolution ------------------------------------------- */

export type ScanResolution =
  | { kind: "product"; product: ProductDto; kg?: number }
  | { kind: "scale-unresolved"; scale: { scaleCode: string; kg: number } }
  | { kind: "unknown" };

/** Resolve a scanned code against the local catalog (instant, offline-safe). */
export function resolveScan(code: string, catalog: ProductDto[]): ScanResolution {
  const clean = code.trim();
  if (!clean) return { kind: "unknown" };

  const exact = catalog.find(
    (p) => p.barcode === clean || p.sku.toLowerCase() === clean.toLowerCase()
  );
  if (exact) return { kind: "product", product: exact };

  // EAN-13 weight scale barcode: 2 AAAAA WWWWW C
  const scale = parseScaleBarcode(clean);
  if (scale) {
    const byScale = catalog.find(
      (p) => (p as ProductDto & { scaleCode?: string }).scaleCode === scale.scaleCode
    );
    if (byScale) return { kind: "product", product: byScale, kg: scale.kg };
    return { kind: "scale-unresolved", scale };
  }

  return { kind: "unknown" };
}

export interface PriceCheckResult {
  found: boolean;
  type?: string;
  name?: string;
  emoji?: string;
  price?: number;
  unit?: string;
  category?: string;
  isScale?: boolean;
  kg?: number;
  qty?: number;
  computed?: number;
  error?: string;
}

/** PUBLIC /api/price-check lookup (server resolves scale barcodes + gift cards). */
export async function remotePriceCheck(code: string): Promise<PriceCheckResult> {
  const res = await fetch(`/api/price-check?code=${encodeURIComponent(code.trim())}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Price check failed (${res.status})`);
  return (await res.json()) as PriceCheckResult;
}

/* -- customer display pole (second window at /display) --------- */

export const DISPLAY_CHANNEL = "dukaflow-display";

export interface DisplayCartMessage {
  type: "cart";
  total: number;
  itemCount: number;
  points: number;
  storeName: string;
  customerName: string;
  lastItem?: { name: string; qty: number; price: number };
  at: number;
}

export function createDisplayChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(DISPLAY_CHANNEL);
  } catch {
    return null;
  }
}

/* -- hold + resume: localStorage mirror (offline resilience) ---- */

export interface HoldLine {
  productId: number;
  name: string;
  emoji: string;
  sku: string;
  unitPrice: number;
  qty: number;
  category?: string;
  unit?: string;
  /** weight captured for scale lines - restored with the weight badge */
  kg?: number;
  discount?: number;
  total?: number;
}

export interface HoldRecord {
  id?: number; // server id when known
  holdCode: string;
  storeId: number;
  staffName: string;
  customerId: number | null;
  customerName: string;
  label: string;
  itemCount: number;
  total: number;
  items: HoldLine[];
  createdAt: string;
  /** true when parked on this device only (network was down) */
  local?: boolean;
}

const LOCAL_HOLDS_KEY = "dukaflow-pos-holds";

export function readLocalHolds(): HoldRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_HOLDS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as HoldRecord[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function writeLocalHolds(list: HoldRecord[]): void {
  try {
    localStorage.setItem(LOCAL_HOLDS_KEY, JSON.stringify(list));
  } catch {
    /* storage full / private mode - holds stay server side */
  }
}

export function addLocalHold(hold: HoldRecord): void {
  const list = readLocalHolds().filter((h) => h.holdCode !== hold.holdCode);
  list.unshift(hold);
  writeLocalHolds(list.slice(0, 100));
}

export function removeLocalHold(holdCode: string): void {
  writeLocalHolds(readLocalHolds().filter((h) => h.holdCode !== holdCode));
}

/** Server holds win over local mirrors with the same holdCode. Newest first. */
export function mergeHolds(server: HoldRecord[], local: HoldRecord[]): HoldRecord[] {
  const byCode = new Map<string, HoldRecord>();
  for (const h of local) byCode.set(h.holdCode, h);
  for (const h of server) byCode.set(h.holdCode, { ...h, local: false });
  return [...byCode.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

/* -- cart <-> hold line mapping -------------------------------- */

export function toHoldLines(cart: CartLine[], scaleKg: Record<number, number>): HoldLine[] {
  return cart.map((l) => {
    const kg = scaleKg[l.productId];
    return {
      productId: l.productId,
      name: l.name,
      emoji: l.emoji,
      sku: l.sku,
      unitPrice: l.unitPrice,
      qty: l.qty,
      category: l.category,
      unit: kg != null ? "kg" : "pc",
      kg,
      discount: 0,
      total: Math.round(l.unitPrice * l.qty * 100) / 100,
    };
  });
}

export function fromHoldLines(items: HoldLine[]): {
  lines: CartLine[];
  scale: Record<number, number>;
} {
  const lines: CartLine[] = [];
  const scale: Record<number, number> = {};
  for (const i of items ?? []) {
    lines.push({
      productId: i.productId,
      name: i.name,
      emoji: i.emoji,
      sku: i.sku,
      unitPrice: i.unitPrice,
      qty: i.qty,
      category: i.category,
    });
    if (i.kg != null) scale[i.productId] = i.kg;
  }
  return { lines, scale };
}
