"use client";

/**
 * POS - the offline-first point of sale (Naivas supermarket mode).
 *
 * Flow: every sale is written to the IndexedDB queue FIRST (survives refresh,
 * crash and full offline), then M-Pesa STK runs when applicable, then the sale
 * posts to /api/sales. 403 credit blocks raise a red AlertDialog; network
 * failures keep the sale queued and show the success modal with an
 * "OFFLINE QUEUED" badge. syncPendingSales() runs on mount and whenever
 * connectivity returns.
 *
 * Supermarket floor features: global barcode-gun capture (fast keystroke
 * buffer -> instant cart add with beep + flash), weight-scale barcodes,
 * price-check mode, hold/resume (server + localStorage mirror), multi-pay
 * split tenders, day-lock manager PIN override, digital receipt QR, offline
 * product cache for instant boots, fullscreen till mode and a customer
 * display pole broadcast (second window at /display).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  Banknote,
  Beer,
  Building2,
  Check,
  CreditCard,
  FileText,
  Gift,
  HandCoins,
  History,
  KeyRound,
  Landmark,
  Loader2,
  Lock,
  Mail,
  Maximize2,
  Minimize2,
  Minus,
  MonitorSmartphone,
  Package,
  Pause,
  Plus,
  Printer,
  RotateCcw,
  Scale as ScaleIcon,
  ScanBarcode,
  ScanSearch,
  Search,
  Send,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Store as StoreIcon,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useApp, useSync } from "@/lib/store";
import { happyHourLabel, happyHourMatchesCategory, isHappyHourActive, type HappyHourConfig } from "@/lib/happy-hour";
import { canSeeMargin } from "@/lib/roles";
import { kes, type ReceiptDocData } from "@/lib/receipt";
import { printReceiptDocs, type ReceiptPrintMode } from "@/services/receiptService";
import {
  KES,
  type CartLine,
  type CustomerDto,
  type PaySplit,
  type PaymentMethod,
  type ProductDto,
  type SaleDto,
  type SalePayload,
  type SaleResult,
} from "@/types";
import { StockBadge, TierBadge } from "@/components/df/badges";
import { DukaMark } from "@/components/df/logo";
import { PosQuickReturn } from "@/components/df/pos-quick-return";
import { QrImage } from "@/components/df/qr";
import { getCachedProducts, offlineQueue, saveProductCache, syncPendingSales } from "@/lib/offline";
import {
  ScannerBuffer,
  addLocalHold,
  createDisplayChannel,
  fromHoldLines,
  mergeHolds,
  playScanTone,
  readLocalHolds,
  remotePriceCheck,
  removeLocalHold,
  resolveScan,
  toHoldLines,
  timeAgo,
  type DisplayCartMessage,
  type HoldRecord,
} from "@/lib/pos-engine";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

/* -- helpers --------------------------------------------------- */

const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** qty of a product at the active store ("all" sums every stock row). */
const stockQty = (p: ProductDto, storeId: number | "all"): number => {
  if (storeId === "all") return p.stock.reduce((a, s) => a + s.qty, 0);
  const s = p.stock.find((st) => st.storeId === storeId);
  return s ? s.qty : 0;
};

const tierColor = (tier?: string | null) =>
  tier === "Gold" ? "#FFD700" : tier === "Silver" ? "#B0BEC5" : "#BCAAA4";

interface Totals {
  subtotal: number;
  tierPct: number;
  tierDiscount: number;
  promoEligible: boolean;
  promoDiscount: number;
  happyHourDiscount: number;
  billDiscount: number;
  pointsToUse: number;
  pointsValue: number;
  discountTotal: number;
  vat: number;
  total: number;
}

/** Client-side mirror of /api/sales pricing (server stays source of truth). */
function computeTotals(args: {
  lines: CartLine[];
  tier: string | null;
  promo: string | null;
  happyHourDiscount: number;
  billDiscount: number;
  usePoints: boolean;
  pointsAvailable: number;
  pointValue: number;
  vatRate: number;
}): Totals {
  const subtotal = args.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const tierPct = args.tier === "Gold" ? 0.1 : args.tier === "Silver" ? 0.05 : 0;
  // NOTE: components stay float to mirror /api/sales exactly - the server
  // rounds only VAT and the grand total, so the PAY button always matches
  // the receipt to the shilling.
  const tierDiscount = subtotal * tierPct;
  const promoEligible = !!args.promo && subtotal >= 5000;
  const promoDiscount = promoEligible ? 500 : 0;
  const happyHourDiscount = Math.max(0, args.happyHourDiscount);
  const billDiscount = Math.max(0, Math.round(args.billDiscount));

  // points never exceed the amount due after tier/promo/happy-hour/bill discounts
  const remaining = Math.max(0, subtotal - tierDiscount - promoDiscount - happyHourDiscount - billDiscount);
  const pointsToUse =
    args.usePoints && args.pointsAvailable > 0
      ? Math.max(0, Math.min(args.pointsAvailable, Math.floor(remaining / args.pointValue)))
      : 0;
  const pointsValue = pointsToUse * args.pointValue;

  const discountTotal = tierDiscount + promoDiscount + happyHourDiscount + billDiscount + pointsValue;
  const base = Math.max(0, subtotal - discountTotal);
  const vat = Math.round(base * args.vatRate);
  const total = base + vat;
  return {
    subtotal,
    tierPct,
    tierDiscount,
    promoEligible,
    promoDiscount,
    happyHourDiscount,
    billDiscount,
    pointsToUse,
    pointsValue,
    discountTotal,
    vat,
    total,
  };
}

interface PayMethod {
  method: PaymentMethod;
  label: string;
  icon: typeof Banknote;
  color: string;
}

const PAY_METHODS: PayMethod[] = [
  { method: "Cash", label: "CASH", icon: Banknote, color: "#172B4D" },
  { method: "M-Pesa", label: "M-PESA STK PUSH", icon: Smartphone, color: "#00C853" },
  { method: "Till", label: "TILL", icon: StoreIcon, color: "#0052CC" },
  { method: "Paybill", label: "PAYBILL", icon: Building2, color: "#6B778C" },
  { method: "Gift Card", label: "GIFT CARD", icon: CreditCard, color: "#B8860B" },
  { method: "Credit Sale", label: "CREDIT SALE", icon: HandCoins, color: "#FF5630" },
];

interface StkState {
  open: boolean;
  phase: "pending" | "success";
  phone: string;
  id: string | null;
  message: string | null;
}

interface SuccessState {
  sale: SaleDto;
  loyalty: { earned: number; balance: number; redeemed: number } | null;
  offline: boolean;
  /** digital twin from the API: NVS code + public URL rendered as a QR */
  digitalReceipt: { code: string; url: string } | null;
}

/** Build the printable document model from a completed sale (standalone print). */
function saleToPrintDoc(success: NonNullable<SuccessStateAsDoc>): ReceiptDocData {
  const s = success.sale;
  const settings = useApp.getState().settings as Record<string, unknown> | null;
  const code = success.digitalReceipt?.code;
  return {
    kind: "SALE",
    docNo: s.receiptNo,
    receiptCode: code,
    date: new Date(s.createdAt).toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    storeName: s.storeName,
    storePhone: (settings?.companyPhone as string) || undefined,
    tillNo: (settings?.tillNo as string) || undefined,
    kraPin: (settings?.kraPin as string) || undefined,
    cuInvoiceNumber: s.cuInvoiceNumber ?? undefined,
    etimsEnabled: s.kraStatus === "Verified",
    servedBy: s.staffName,
    customerName: s.customerName ?? undefined,
    customerLine:
      s.customerName
        ? `${s.customerName} - ${s.customerTier ?? s.tierAtSale ?? "Bronze"} Tier | Earned: ${s.pointsEarned} pts | Balance: ${success.loyalty?.balance ?? 0} pts | Value KES ${success.loyalty?.balance ?? 0}`
        : undefined,
    lines: s.items.map((it, i) => ({
      no: i + 1,
      name: it.name,
      qty: it.qty,
      unit: "pc",
      unitPrice: it.unitPrice,
      discount: it.discount,
      total: it.total,
    })),
    totals: [
      { label: "Subtotal", value: kes(s.subtotal) },
      ...(s.discount > 0 ? [{ label: "Discount", value: `- ${kes(s.discount)}` }] : []),
      ...(s.pointsRedeemed > 0 ? [{ label: "Points Used", value: `- ${kes(s.pointsRedeemed)}` }] : []),
      { label: "VAT 16%", value: kes(s.vat) },
    ],
    grandTotal: kes(s.total),
    paymentLines: [{ method: s.paymentMethod, amount: kes(s.total) }],
    pointsLine:
      s.customerName
        ? { earned: s.pointsEarned, redeemed: s.pointsRedeemed || undefined, balance: success.loyalty?.balance, value: success.loyalty?.balance }
        : undefined,
    footerMessage: (settings?.receiptPromoFooter as string) || undefined,
    qrText: success.digitalReceipt?.url ?? (code ? `https://retail-erp-pos-kenya.vercel.app/receipt/${code}` : undefined),
    company: (settings?.companyName as string) || "DukaFlow Ltd",
  };
}
type SuccessStateAsDoc = SuccessState;

/** Tenders available inside one split payment (Points redeems loyalty). */
const SPLIT_METHODS = ["Cash", "M-Pesa", "M-Pesa Till", "M-Pesa Paybill", "Card", "Points", "Gift Card"] as const;

/** Map a split tender label onto the SalePayload PaymentMethod union. */
function mapSplitMethod(m: string): PaymentMethod {
  if (m === "M-Pesa Till") return "Till";
  if (m === "M-Pesa Paybill") return "Paybill";
  if (m === "Points") return "Cash"; // points value rides on pointsRedeemed
  return m as PaymentMethod;
}

interface DayLockState {
  open: boolean;
  pin: string;
  error: string | null;
  zNo: string | null;
  busy: boolean;
}

interface PricePopupState {
  at: number;
  name: string;
  emoji: string;
  price: number;
  unit: string;
  kg?: number;
  computed?: number;
  stock?: number;
  /** owner/manager/accountant eyes only (canSeeMargin) */
  margin?: number;
}

/* -- component ------------------------------------------------- */

export default function PosScreen() {
  const activeStoreId = useApp((s) => s.activeStoreId);
  const user = useApp((s) => s.user);
  const categories = useApp((s) => s.categories);
  const settings = useApp((s) => s.settings);
  const activeStore = useApp((s) => (s.activeStoreId === "all" ? undefined : s.stores.find((st) => st.id === s.activeStoreId)));
  const online = useSync((s) => s.online);
  const unsynced = useSync((s) => s.unsynced);
  const setUnsynced = useSync((s) => s.setUnsynced);

  /* margins are Owner / Manager / Accountant eyes only (Naivas rule) */
  const canMargin = canSeeMargin(user?.role);
  const resolvedStoreId = activeStoreId === "all" ? (user?.storeId ?? 1) : activeStoreId;

  /* catalog */
  const [search, setSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const [category, setCategory] = useState("All");
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [catalogNonce, setCatalogNonce] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  /* cart */
  const [cart, setCart] = useState<CartLine[]>([]);
  /* weight lines: productId -> kg captured from EAN-13 scale barcodes */
  const [scaleKg, setScaleKg] = useState<Record<number, number>>({});
  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  const [promo, setPromo] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState("");
  const [billDiscount, setBillDiscount] = useState("");
  const [usePoints, setUsePoints] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Cash");
  const [paying, setPaying] = useState(false);
  const [tillOpen, setTillOpen] = useState(false);
  /* till shift liveness - drives the green pulse dot on the Till button */
  const [tillSessionLive, setTillSessionLive] = useState(false);
  useEffect(() => {
    if (activeStoreId === "all") return;
    api
      .get<{ session: unknown }>(`/api/till?storeId=${activeStoreId}`)
      .then((d) => setTillSessionLive(!!d.session))
      .catch(() => {});
  }, [activeStoreId, tillOpen]);

  /* dialogs */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<CustomerDto[]>([]);
  const [custLoading, setCustLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [stk, setStk] = useState<StkState>({ open: false, phase: "pending", phone: "", id: null, message: null });
  const [blocked, setBlocked] = useState<{ reason: string; overdueDays: number } | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  /* email the e-invoice right from the success modal (mirrors Receipts) */
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  /* quick-return at the till (F4) */
  const [quickReturnOpen, setQuickReturnOpen] = useState(false);

  /* -- Naivas floor mode -------------------------------------- */
  /* price check: scans pop a big price tag instead of adding to cart */
  const [priceCheckOn, setPriceCheckOn] = useState(false);
  const [pricePopup, setPricePopup] = useState<PricePopupState | null>(null);
  /* scan feedback: green/red wash + WebAudio beep */
  const [scanFlash, setScanFlash] = useState<"ok" | "err" | null>(null);
  const [flashAt, setFlashAt] = useState(0);
  /* fullscreen till mode (F11 style) */
  const [isFs, setIsFs] = useState(false);
  /* hold + resume */
  const [holds, setHolds] = useState<HoldRecord[]>([]);
  const [holdsOpen, setHoldsOpen] = useState(false);
  const [holding, setHolding] = useState(false);
  /* multi-pay split dialog */
  const [payOpen, setPayOpen] = useState(false);
  const [splits, setSplits] = useState<{ method: string; amount: string }[]>([]);
  const [allowPartial, setAllowPartial] = useState(false);
  /* day lock (423): manager PIN override dialog + retry payload */
  const [dayLock, setDayLock] = useState<DayLockState | null>(null);
  const retryRef = useRef<{ payload: SalePayload; clientId: string } | null>(null);
  /* customer display pole (second window) */
  const displayRef = useRef<BroadcastChannel | null>(null);
  /* guards against a late gun Enter double-firing the search handler */
  const lastScanAtRef = useRef(0);

  const vatRate = settings?.vatRate ?? 0.16;
  const pointValue = settings?.loyaltyPointValue ?? 1;

  /* -- sync on mount + whenever connectivity returns ----------- */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const c = await offlineQueue.count();
        if (!alive) return;
        setUnsynced(c.unsynced);
        if (online && c.unsynced > 0) {
          const { synced, failed } = await syncPendingSales();
          if (!alive) return;
          if (synced > 0) {
            toast({
              title: `↗ ${synced} offline sale${synced > 1 ? "s" : ""} synced`,
              description: failed ? `${failed} still queued` : "Queue clear",
            });
          }
          const c2 = await offlineQueue.count();
          if (alive) setUnsynced(c2.unsynced);
        }
      } catch {
        /* IndexedDB unavailable - POS still works in-memory */
      }
    })();
    return () => {
      alive = false;
    };
  }, [online, setUnsynced]);

  /* -- debounced search (fast, the filter itself is in-memory) -- */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(search), 120);
    return () => clearTimeout(t);
  }, [search]);

  /* F2 focuses the scan/search field, F4 opens the quick-return dialog */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        setQuickReturnOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* -- cart mutations ------------------------------------------ */
  const addToCart = useCallback(
    (p: ProductDto) => {
      const available = stockQty(p, activeStoreId);
      if (available <= 0) {
        toast({ title: "Out of stock", description: `${p.name} is unavailable at this store`, variant: "destructive" });
        return;
      }
      setCart((prev) => {
        const idx = prev.findIndex((l) => l.productId === p.id);
        if (idx === -1) {
          return [...prev, { productId: p.id, name: p.name, emoji: p.emoji, sku: p.sku, unitPrice: p.price, qty: 1, category: p.category }];
        }
        return prev.map((l, i) => (i === idx ? { ...l, qty: Math.min(l.qty + 1, available) } : l));
      });
    },
    [activeStoreId]
  );

  const setLineQty = (productId: number, qty: number) => {
    if (scaleKg[productId] != null) {
      // weight lines keep decimals (0.75 kg of bananas, not 1)
      const q = Math.max(0.01, Math.round(qty * 1000) / 1000 || 0.01);
      setScaleKg((prev) => ({ ...prev, [productId]: q }));
      setCart((prev) => prev.map((l) => (l.productId === productId ? { ...l, qty: q } : l)));
      return;
    }
    const q = Math.max(1, Math.min(9999, Math.round(qty) || 1));
    setCart((prev) => prev.map((l) => (l.productId === productId ? { ...l, qty: q } : l)));
  };

  const removeLine = (productId: number) => {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
    setScaleKg((prev) => {
      if (prev[productId] == null) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  };

  /* -- scan feedback: color wash + beep ------------------------- */
  const flash = useCallback((kind: "ok" | "err") => {
    setScanFlash(kind);
    setFlashAt(Date.now());
    window.setTimeout(() => setScanFlash((s) => (s === kind ? null : s)), 400);
  }, []);

  /* -- weight lines: add qty = kg from an EAN-13 scale barcode -- */
  const addToCartWeighted = useCallback(
    (p: ProductDto, kg: number) => {
      const available = stockQty(p, activeStoreId);
      if (available <= 0) {
        toast({ title: "Out of stock", description: `${p.name} is unavailable at this store`, variant: "destructive" });
        return;
      }
      setScaleKg((prev) => ({ ...prev, [p.id]: Math.round(((prev[p.id] ?? 0) + kg) * 1000) / 1000 }));
      setCart((prev) => {
        const idx = prev.findIndex((l) => l.productId === p.id);
        if (idx === -1) {
          return [...prev, { productId: p.id, name: p.name, emoji: p.emoji, sku: p.sku, unitPrice: p.price, qty: kg, category: p.category }];
        }
        return prev.map((l, i) => (i === idx ? { ...l, qty: Math.round((l.qty + kg) * 1000) / 1000 } : l));
      });
      toast({
        title: `${kg} kg x ${KES(p.price)}`,
        description: `${p.name} - ${kes(p.price * kg)} weighed and added`,
      });
    },
    [activeStoreId]
  );

  /* -- price check popup (never touches the cart) --------------- */
  const showPricePopup = useCallback(
    (p: ProductDto, kg?: number) => {
      setPricePopup({
        at: Date.now(),
        name: p.name,
        emoji: p.emoji,
        price: p.price,
        unit: p.unit,
        kg,
        computed: kg ? Math.round(p.price * kg * 100) / 100 : undefined,
        stock: stockQty(p, activeStoreId),
        margin: canMargin && p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : undefined,
      });
    },
    [activeStoreId, canMargin]
  );

  /* -- scan resolution: local catalog first, then price-check API */
  const clearTypedScan = useCallback((code: string) => {
    // the gun's characters may have landed in the focused input - sweep them
    setSearch("");
    try {
      const el = document.activeElement as HTMLInputElement | null;
      if (el && el.tagName === "INPUT" && el.value && el.value.replace(/\s/g, "").endsWith(code)) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        setter?.call(el, "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } catch {
      /* non-critical */
    }
  }, []);

  const handleRemoteScan = useCallback(
    (code: string) => {
      void (async () => {
        try {
          const r = await remotePriceCheck(code);
          const local = r.found && r.name ? products.find((p) => p.name === r.name) : undefined;
          if (r.found && r.type === "product" && local) {
            if (priceCheckOn) {
              showPricePopup(local, r.kg ?? (r.isScale ? r.qty : undefined));
              playScanTone(true);
              return;
            }
            addToCartWeighted(local, r.kg ?? r.qty ?? 1);
            playScanTone(true);
            flash("ok");
            clearTypedScan(code);
            return;
          }
        } catch {
          /* offline / failed - falls through to unknown */
        }
        playScanTone(false);
        flash("err");
        toast({ title: `Unknown barcode: ${code}`, description: "No product matches this code", variant: "destructive" });
        clearTypedScan(code);
      })();
    },
    [products, priceCheckOn, showPricePopup, addToCartWeighted, flash, clearTypedScan]
  );

  const handleScanCode = useCallback(
    (raw: string) => {
      const code = raw.trim();
      lastScanAtRef.current = Date.now();
      if (!code) return;
      const res = resolveScan(code, products);
      if (res.kind === "product") {
        if (priceCheckOn) {
          showPricePopup(res.product, res.kg);
          playScanTone(true);
        } else if (res.kg) {
          addToCartWeighted(res.product, res.kg);
          playScanTone(true);
        } else {
          addToCart(res.product);
          playScanTone(true);
        }
        flash("ok");
        clearTypedScan(code);
        return;
      }
      if (res.kind === "scale-unresolved") {
        // catalog has no scaleCode map (or it is stale) - ask the public
        // price-check API to resolve the embedded item + weight
        handleRemoteScan(code);
        return;
      }
      playScanTone(false);
      flash("err");
      toast({ title: `Unknown barcode: ${code}`, description: "No product matches this code", variant: "destructive" });
      clearTypedScan(code);
    },
    [products, priceCheckOn, showPricePopup, addToCart, addToCartWeighted, flash, clearTypedScan, handleRemoteScan]
  );

  /* -- GLOBAL barcode-gun capture --------------------------------
     Window-level listener: scanners type characters <80 ms apart and
     finish with Enter (or go silent for no-enter guns). Human typing
     fragments the buffer, so it stays safe while focus is anywhere in
     the POS. Dialogs (PIN entry, customer picker) pause the gun. */
  useEffect(() => {
    const buffer = new ScannerBuffer({
      gapMs: 80,
      idleMs: 80,
      minEnterLen: 6,
      minIdleLen: 8,
      onScan: (code) => {
        handleScanCode(code);
      },
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length > 1 && e.key !== "Enter") return; // F-keys, arrows etc.
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing && target?.closest('[role="dialog"]')) return; // modal inputs (PIN etc.) pause the gun
      const consumed = buffer.key(e);
      if (consumed) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      buffer.dispose();
    };
  }, [handleScanCode]);

  /* -- price check popup auto-dismiss (4 s) ---------------------- */
  useEffect(() => {
    if (!pricePopup) return;
    const t = setTimeout(() => setPricePopup(null), 4000);
    return () => clearTimeout(t);
  }, [pricePopup]);

  /* -- fullscreen till mode (F11 style) --------------------------- */
  const toggleFullscreen = useCallback(() => {
    try {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      } else {
        void document.documentElement.requestFullscreen().catch(() => {});
      }
    } catch {
      /* fullscreen blocked - no-op */
    }
  }, []);
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  /* -- customer display pole (second window at /display) ---------- */
  useEffect(() => {
    displayRef.current = createDisplayChannel();
    return () => {
      displayRef.current?.close();
      displayRef.current = null;
    };
  }, []);

  /* -- catalog: IndexedDB cache first, then a fresh full fetch --
     The whole catalog lives in memory; search/category filter it
     client side (<100 ms) and the POS keeps selling offline. */
  useEffect(() => {
    let alive = true;
    void (async () => {
      // 1. instant boot from the offline product cache (DB v2)
      try {
        const cached = await getCachedProducts();
        if (alive && cached.length > 0) {
          setProducts(cached);
          setProductsLoading(false);
        }
      } catch {
        /* IndexedDB unavailable - POS still works in-memory */
      }
      // 2. refresh from the server and re-snapshot the cache
      try {
        const list = await api.get<ProductDto[]>("/api/products");
        if (!alive) return;
        setProducts(list);
        setProductsLoading(false);
        void saveProductCache(list).catch(() => {});
      } catch {
        /* offline - keep serving the cached catalog */
        if (alive) setProductsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [catalogNonce]);

  /* in-memory search + category filter (instant, <100 ms) */
  const visibleProducts = useMemo(() => {
    const q = debouncedQ.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== "All" && p.category !== category) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.includes(q)
      );
    });
  }, [products, debouncedQ, category]);

  /* -- customer picker fetch ----------------------------------- */
  useEffect(() => {
    if (!pickerOpen) return;
    let alive = true;
    const t = setTimeout(() => {
      void (async () => {
        setCustLoading(true);
        try {
          const qs = custQuery.trim() ? `?q=${encodeURIComponent(custQuery.trim())}` : "";
          const list = await api.get<CustomerDto[]>(`/api/customers${qs}`);
          if (alive) setCustResults(list);
        } catch {
          if (alive) setCustResults([]);
        } finally {
          if (alive) setCustLoading(false);
        }
      })();
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [pickerOpen, custQuery]);

  const createCustomer = async () => {
    if (!newName.trim() || !newPhone.trim()) return;
    setCreating(true);
    try {
      const c = await api.post<CustomerDto>("/api/customers", {
        name: newName.trim(),
        phone: newPhone.trim(),
        storeId: activeStoreId === "all" ? undefined : activeStoreId,
      });
      toast({ title: `${c.name} added`, description: "Bronze tier • start earning loyalty points today" });
      setCustomer(c);
      setPickerOpen(false);
      setNewName("");
      setNewPhone("");
      setCustQuery("");
    } catch (e) {
      toast({
        title: "Could not create customer",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const applyPromo = () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setPromo(code);
    setPromoInput("");
    toast({
      title: `Promo ${code} applied`,
      description: "Server validates on pay - flat KES 500 off when subtotal ≥ KES 5,000",
    });
  };

  /* -- totals -------------------------------------------------- */
  /* -- happy hour auto-pricing (ticks every 30s so banners stay honest) -- */
  const [nowTick, setNowTick] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNowTick(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const hhCfg = useMemo<HappyHourConfig | null>(
    () =>
      settings
        ? {
            happyHourEnabled: settings.happyHourEnabled,
            happyHourStart: settings.happyHourStart,
            happyHourEnd: settings.happyHourEnd,
            happyHourPercent: settings.happyHourPercent,
            happyHourCategory: settings.happyHourCategory,
          }
        : null,
    [settings]
  );
  const hhActive = isHappyHourActive(hhCfg, nowTick);
  const happyHourDiscount = useMemo(() => {
    if (!hhActive || !hhCfg) return 0;
    return cart.reduce((sum, l) => {
      const cat = l.category ?? products.find((p) => p.id === l.productId)?.category ?? "";
      return happyHourMatchesCategory(hhCfg, cat) ? sum + l.unitPrice * l.qty * (hhCfg.happyHourPercent / 100) : sum;
    }, 0);
  }, [hhActive, hhCfg, cart, products]);

  const totals = computeTotals({
    lines: cart,
    tier: customer?.tier ?? null,
    promo,
    happyHourDiscount,
    billDiscount: Number(billDiscount) || 0,
    usePoints,
    pointsAvailable: customer?.loyaltyPoints ?? 0,
    pointValue,
    vatRate,
  });
  const cartTotal = totals.total;

  /* broadcast every cart change to the display pole (tenders, discounts
     and points switches all move the total, so it rides on cartTotal) */
  useEffect(() => {
    const ch = displayRef.current;
    if (!ch) return;
    const last = cart[cart.length - 1];
    const msg: DisplayCartMessage = {
      type: "cart",
      total: Math.round(cartTotal * 100) / 100,
      itemCount: cart.reduce((s, l) => s + l.qty, 0),
      points: Math.floor(cartTotal / (settings?.loyaltyEarnPerKes ?? 100)),
      storeName: activeStore?.name ?? "All Stores",
      customerName: customer?.name ?? "Walk-in",
      lastItem: last ? { name: last.name, qty: last.qty, price: last.unitPrice } : undefined,
      at: Date.now(),
    };
    try {
      ch.postMessage(msg);
    } catch {
      /* channel closed */
    }
  }, [cart, cartTotal, customer, activeStore, settings]);

  /* -- PAY flow ------------------------------------------------ */
  const markQueue = async (clientId: string, status: "synced" | "failed", error?: string) => {
    const item = (await offlineQueue.all()).find((q) => q.clientId === clientId);
    if (item) {
      await offlineQueue.update(
        status === "synced"
          ? { ...item, status: "synced", syncedAt: Date.now() }
          : { ...item, status: "failed", error: error ?? "Sale failed" }
      );
      if (status === "synced") await offlineQueue.clearSynced();
    }
    const c = await offlineQueue.count();
    setUnsynced(c.unsynced);
  };

  const buildOfflineSale = (payload: SalePayload, clientId: string, t: Totals): SaleDto => {
    const earned = Math.floor(t.total / (settings?.loyaltyEarnPerKes ?? 100));
    return {
      id: 0,
      receiptNo: `OFF-${clientId.slice(0, 6).toUpperCase()}`,
      storeId: payload.storeId,
      customerId: payload.customerId,
      customerName: customer?.name ?? "Walk-in",
      staffName: payload.staffName,
      subtotal: t.subtotal,
      discount: t.discountTotal,
      vat: t.vat,
      total: t.total,
      paymentMethod: payload.paymentMethod,
      pointsEarned: earned,
      pointsRedeemed: t.pointsToUse,
      tierAtSale: customer?.tier ?? null,
      promoCode: payload.promoCode ?? null,
      status: "Queued",
      kraStatus: "Pending",
      cuInvoiceNumber: null,
      qrCodeBase64: null,
      offlineCreated: true,
      createdAt: new Date().toISOString(),
      items: [],
    };
  };

  const resetTransaction = () => {
    setSuccess(null);
    setEmailOpen(false);
    setCart([]);
    setScaleKg({});
    setCustomer(null);
    setPromo(null);
    setPromoInput("");
    setBillDiscount("");
    setUsePoints(false);
    setPaymentMethod("Cash");
    setSplits([]);
    setAllowPartial(false);
  };

  /* -- email the e-invoice straight from the success modal ----- */
  const openSuccessEmail = async () => {
    if (!success || success.offline) return;
    setEmailOpen(true);
    setEmailLoading(true);
    setEmailTo(customer?.email ?? "");
    try {
      const r = await api.get<{ ok: boolean; subject: string; body: string; to: string }>(
        `/api/sales/${success.sale.id}/email`
      );
      setEmailSubject(r.subject);
      setEmailBody(r.body);
      if (r.to) setEmailTo(r.to);
    } catch {
      setEmailSubject(`Tax Invoice ${success.sale.receiptNo}`);
      setEmailBody("Could not preview the e-invoice - try again.");
    } finally {
      setEmailLoading(false);
    }
  };

  const sendSuccessEmail = async () => {
    if (!success || success.offline) return;
    setEmailSending(true);
    try {
      const r = await api.post<{ ok: boolean; to: string }>(`/api/sales/${success.sale.id}/email`, {
        to: emailTo.trim(),
      });
      toast({ title: "E-invoice sent ✉️", description: `${success.sale.receiptNo} → ${r.to}` });
      setEmailOpen(false);
    } catch (e) {
      toast({
        title: "Could not send",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setEmailSending(false);
    }
  };

  /**
   * Shared POST /api/sales response handler (used by the first attempt AND
   * the day-lock manager-PIN retry). Returns "handled" or "daylocked".
   * Raw fetch on purpose: we need the structured 403 {blocked} / 423 bodies.
   */
  const finishSaleResponse = async (res: Response, clientId: string): Promise<"handled" | "daylocked"> => {
    if (res.status === 423) {
      const data = (await res.json().catch(() => null)) as { error?: string; zNo?: string } | null;
      setDayLock({
        open: true,
        pin: "",
        error: data?.error ?? "Day is closed - Manager PIN required",
        zNo: data?.zNo ?? null,
        busy: false,
      });
      return "daylocked"; // queued item stays pending until retry or cancel
    }

    if (res.status === 403) {
      const data = (await res.json().catch(() => null)) as { blocked?: { reason: string; overdueDays: number } } | null;
      const reason = data?.blocked?.reason ?? "Credit sale blocked";
      await markQueue(clientId, "failed", reason);
      setBlocked(data?.blocked ?? { reason, overdueDays: 0 });
      return "handled";
    }

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      const message = data?.error ?? `Sale failed (${res.status})`;
      await markQueue(clientId, "failed", message);
      toast({ title: "Sale rejected", description: message, variant: "destructive" });
      return "handled";
    }

    const data = (await res.json()) as SaleResult & { digitalReceipt?: { code: string; url: string } | null };
    if (!data.ok || !data.sale) {
      const message = data.error ?? "Sale failed on server";
      await markQueue(clientId, "failed", message);
      toast({ title: "Sale rejected", description: message, variant: "destructive" });
      return "handled";
    }

    await markQueue(clientId, "synced");
    setSuccess({
      sale: data.sale,
      loyalty: data.loyalty ?? null,
      offline: false,
      digitalReceipt: data.digitalReceipt ?? null,
    });
    toast({ title: `✅ ${data.sale.receiptNo} recorded`, description: `${data.sale.paymentMethod} • ${KES(data.sale.total)}` });
    setCatalogNonce((n) => n + 1); // refresh stock badges after server decrement
    return "handled";
  };

  /** POST the payload to /api/sales and consume the response. */
  const postSale = async (payload: SalePayload, clientId: string): Promise<"handled" | "daylocked"> => {
    try {
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return await finishSaleResponse(res, clientId);
    } catch {
      /* network dropped mid-payment -> keep queued, show offline-queued receipt */
      const offlineSale = buildOfflineSale(payload, clientId, totals);
      const loyalty = {
        earned: offlineSale.pointsEarned,
        balance: Math.max(0, (customer?.loyaltyPoints ?? 0) - totals.pointsToUse + offlineSale.pointsEarned),
        redeemed: totals.pointsToUse,
      };
      setSuccess({ sale: offlineSale, loyalty, offline: true, digitalReceipt: null });
      toast({ title: "Sale saved offline - will auto-sync", description: KES(totals.total) });
      return "handled";
    }
  };

  const handlePay = async (paySplits?: { method: string; amount: number }[], partial?: boolean) => {
    if (cart.length === 0 || paying) return;
    const isOffline = !online || !navigator.onLine;
    const hasSplits = !!paySplits && paySplits.length > 0;
    if (!hasSplits && paymentMethod === "Credit Sale" && !customer) {
      toast({
        title: "Credit sale needs a customer",
        description: "Select a customer with a credit limit before paying on credit.",
        variant: "destructive",
      });
      return;
    }
    if (hasSplits && partial && !customer) {
      toast({ title: "Partial payment needs a customer", description: "The balance is tracked as customer debt.", variant: "destructive" });
      return;
    }

    setPaying(true);
    const clientId = crypto.randomUUID();

    /* Points tendered inside splits redeem loyalty the same way the
       "use points" switch does - otherwise the arithmetic never adds up. */
    const pointsFromSplits = hasSplits
      ? paySplits!.filter((s) => s.method === "Points").reduce((s, x) => s + x.amount, 0)
      : 0;
    const extraPoints = Math.round(pointsFromSplits / pointValue);
    const pointsRedeemed = Math.min(
      (customer?.loyaltyPoints ?? 0),
      totals.pointsToUse + extraPoints
    );

    const payload: SalePayload = {
      clientId,
      storeId: resolvedStoreId,
      customerId: customer?.id ?? null,
      staffName: user?.name ?? "Counter 1",
      items: cart,
      paymentMethod: hasSplits ? mapSplitMethod(paySplits![0].method) : paymentMethod,
      promoCode: promo,
      pointsRedeemed,
      billDiscount: totals.billDiscount > 0 ? totals.billDiscount : undefined,
      offlineCreated: isOffline,
      ...(isOffline ? { createdAt: new Date().toISOString() } : {}),
      ...(hasSplits
        ? {
            paySplits: paySplits!.map((s) => ({ method: s.method, amount: s.amount })),
            allowPartial: partial,
          }
        : {}),
    };

    /* 1. ALWAYS write to the offline queue first. The payload is also
       stashed so a 423 day-lock can be retried with a manager PIN. */
    retryRef.current = { payload, clientId };
    try {
      await offlineQueue.enqueue({ clientId, payload, status: "pending", createdAt: Date.now() });
      const c = await offlineQueue.count();
      setUnsynced(c.unsynced);
    } catch {
      /* queue write failed (private mode?) - continue with direct post */
    }

    try {
      /* 2. M-Pesa STK push (online, single tender only) */
      if (!hasSplits && paymentMethod === "M-Pesa") {
        const phone = customer?.phone ?? "0712345678";
        if (isOffline) {
          toast({ title: "Queued - STK will fire on sync", description: "Sale stored on this device" });
        } else {
          setStk({ open: true, phase: "pending", phone, id: null, message: null });
          try {
            const init = await api.post<{ ok: boolean; checkoutRequestId: string; customerMessage: string }>(
              "/api/mpesa/stk",
              { phone, amount: totals.total, receiptNo: null }
            );
            setStk((s) => ({ ...s, id: init.checkoutRequestId, message: init.customerMessage }));

            let status: "Pending" | "Success" = "Pending";
            const deadline = Date.now() + 10_000;
            while (status !== "Success" && Date.now() < deadline) {
              await sleep(1500);
              const st = await api.get<{ status: "Pending" | "Success" }>(`/api/mpesa/stk?id=${init.checkoutRequestId}`);
              status = st.status;
            }
            if (status !== "Success") {
              toast({ title: "STK not confirmed in 10s", description: "Confirm the payment on the phone - sale continues." });
            }
            setStk((s) => ({ ...s, phase: "success" }));
            await sleep(500);
            setStk((s) => ({ ...s, open: false }));
          } catch (e) {
            setStk((s) => ({ ...s, open: false }));
            await markQueue(clientId, "failed", e instanceof Error ? e.message : "STK failed");
            toast({
              title: "M-Pesa STK failed",
              description: e instanceof Error ? e.message : "Could not reach Daraja",
              variant: "destructive",
            });
            setPaying(false);
            return;
          }
        }
      }

      /* 3. Post the sale (online) or resolve offline */
      if (isOffline) {
        const offlineSale = buildOfflineSale(payload, clientId, totals);
        const loyalty = {
          earned: offlineSale.pointsEarned,
          balance: Math.max(0, (customer?.loyaltyPoints ?? 0) - pointsRedeemed + offlineSale.pointsEarned),
          redeemed: pointsRedeemed,
        };
        setSuccess({ sale: offlineSale, loyalty, offline: true, digitalReceipt: null });
        toast({ title: "Sale saved offline - will auto-sync", description: KES(totals.total) });
        setPaying(false);
        return;
      }

      await postSale(payload, clientId).then((outcome) => {
        if (outcome === "handled") retryRef.current = null; // day-lock retry no longer needed
      });
    } finally {
      setPaying(false);
    }
  };

  /* -- day lock (423): manager PIN override ---------------------- */
  const retryDayLockSale = async () => {
    const r = retryRef.current;
    if (!r || !dayLock?.pin) return;
    setDayLock({ ...dayLock, busy: true, error: null });
    try {
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...r.payload, managerPin: dayLock.pin }),
      });
      const outcome = await finishSaleResponse(res, r.clientId);
      if (outcome === "handled") {
        setDayLock(null);
        retryRef.current = null;
      } else {
        setDayLock((s) => (s ? { ...s, busy: false, error: "Override rejected - check the PIN and try again." } : s));
      }
    } catch (e) {
      setDayLock((s) =>
        s ? { ...s, busy: false, error: e instanceof Error ? e.message : "Retry failed - check the network." } : s
      );
    }
  };

  const cancelDayLockSale = async () => {
    const r = retryRef.current;
    if (r) await markQueue(r.clientId, "failed", "Day locked - sale cancelled");
    retryRef.current = null;
    setDayLock(null);
  };

  /* -- HOLD + resume (Naivas park-and-serve) --------------------- */
  const clearCartState = () => {
    setCart([]);
    setScaleKg({});
    setPromo(null);
    setPromoInput("");
    setBillDiscount("");
    setUsePoints(false);
  };

  const holdCart = async () => {
    if (cart.length === 0 || holding) return;
    setHolding(true);
    const items = toHoldLines(cart, scaleKg);
    const base = {
      storeId: resolvedStoreId,
      staffName: user?.name ?? "Cashier",
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? "",
      label: "",
    };
    let saved: HoldRecord;
    try {
      const d = await api.post<{ ok: boolean; hold: HoldRecord }>("/api/pos-hold", { ...base, items });
      saved = { ...d.hold, items, local: false };
    } catch {
      /* network down - park on this device so the cart still survives */
      const total = items.reduce((s, i) => s + (i.total ?? i.unitPrice * i.qty), 0);
      saved = {
        ...base,
        holdCode: `HOLD-9${String(Date.now()).slice(-3)}`,
        itemCount: items.reduce((s, i) => s + i.qty, 0),
        total,
        items,
        createdAt: new Date().toISOString(),
        local: true,
      };
    }
    addLocalHold(saved);
    setHolds((prev) => [saved, ...prev.filter((h) => h.holdCode !== saved.holdCode)]);
    clearCartState();
    setCustomer(null);
    toast({
      title: `${saved.holdCode} parked`,
      description: saved.local
        ? "Network is down - hold saved on this device and survives refresh"
        : "Cart cleared - ready for the next customer",
    });
    setHolding(false);
  };

  const refreshHolds = useCallback(async () => {
    let server: HoldRecord[] = [];
    try {
      const d = await api.get<{ holds: HoldRecord[] }>(`/api/pos-hold?storeId=${resolvedStoreId}`);
      server = (d.holds ?? []).map((h) => ({ ...h, items: h.items ?? [] }));
    } catch {
      /* offline - the localStorage mirror keeps holds visible */
    }
    setHolds(mergeHolds(server, readLocalHolds()));
  }, [resolvedStoreId]);

  /* merge server + device holds on mount and whenever connectivity flips */
  useEffect(() => {
    void refreshHolds();
  }, [refreshHolds, online]);

  const resumeHold = async (h: HoldRecord) => {
    const { lines, scale } = fromHoldLines(h.items ?? []);
    if (lines.length === 0) {
      toast({ title: "Hold is empty", description: `${h.holdCode} has no lines to resume`, variant: "destructive" });
      return;
    }
    setCart(lines);
    setScaleKg(scale);
    setPromo(null);
    setPromoInput("");
    setBillDiscount("");
    setUsePoints(false);
    if (h.customerId) {
      try {
        const list = await api.get<CustomerDto[]>("/api/customers");
        const c = list.find((x) => x.id === h.customerId);
        if (c) setCustomer(c);
      } catch {
        /* offline - the cart resumes without the loyalty profile */
      }
    }
    if (h.local || !h.id) {
      removeLocalHold(h.holdCode);
      setHolds((prev) => prev.filter((x) => x.holdCode !== h.holdCode));
    } else {
      try {
        await api.del(`/api/pos-hold?id=${h.id}`);
        removeLocalHold(h.holdCode); // clear any stale device mirror
        setHolds((prev) => prev.filter((x) => x.holdCode !== h.holdCode));
      } catch {
        if (!navigator.onLine) {
          toast({
            title: "Resumed offline copy",
            description: "Network is down - the server hold stays parked",
          });
        } else {
          toast({
            title: "Could not free the server hold",
            description: "It may be resumed again - ask a manager to clear it",
            variant: "destructive",
          });
        }
      }
    }
    setHoldsOpen(false);
    toast({ title: `${h.holdCode} resumed`, description: `${lines.length} line${lines.length > 1 ? "s" : ""} back in the cart` });
  };

  /* -- multi-pay split dialog helpers ----------------------------- */
  const splitsSum = splits.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const splitRemaining = Math.round((totals.total - splitsSum) * 100) / 100;
  const fullySplit = splits.length > 0 && Math.abs(splitRemaining) < 0.01;
  const splitOver = splitsSum > totals.total + 0.009;
  const pointsInSplits = splits
    .filter((s) => s.method === "Points")
    .reduce((s, x) => s + (Number(x.amount) || 0), 0);

  const confirmPay = () => {
    const clean = splits
      .map((s) => ({ method: s.method, amount: Math.round((Number(s.amount) || 0) * 100) / 100 }))
      .filter((s) => s.amount > 0);
    if (clean.length > 0) {
      if (splitOver) {
        toast({ title: "Split exceeds the total", description: `Splits add to ${KES(splitsSum)} but the total is ${KES(totals.total)}`, variant: "destructive" });
        return;
      }
      if (splitRemaining > 0.009 && !allowPartial) {
        toast({ title: "Split incomplete", description: `${KES(splitRemaining)} still unpaid - complete the split or allow partial.`, variant: "destructive" });
        return;
      }
      if (allowPartial && !customer) {
        toast({ title: "Partial payment needs a customer", description: "Select a customer so the balance tracks as debt.", variant: "destructive" });
        return;
      }
      if (pointsInSplits > 0) {
        const available = (customer?.loyaltyPoints ?? 0) - totals.pointsToUse;
        if (Math.round(pointsInSplits / pointValue) > available) {
          toast({ title: "Not enough points", description: `${customer?.name ?? "The customer"} has ${available} points left after this bill's redemption.`, variant: "destructive" });
          return;
        }
      }
    }
    setPayOpen(false);
    void handlePay(clean.length > 0 ? clean : undefined, allowPartial);
  };

  /* -- render -------------------------------------------------- */

  const billNum = Number(billDiscount) || 0;

  return (
    <div className="df-pos-root relative flex min-h-[620px] max-h-full! flex-col overflow-hidden rounded-2xl border border-[#DFE1E6] bg-white shadow-sm">
      {/* scan feedback wash (green ok / red unknown) */}
      {scanFlash && (
        <div
          key={flashAt}
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 z-40 animate-out fade-out duration-500 fill-mode-forwards",
            scanFlash === "ok" ? "bg-[#00C853]/15" : "bg-[#FF5630]/15"
          )}
        />
      )}
      {/* header strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DFE1E6] bg-[#FAFBFC] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0052CC]">
            <div className="h-5 w-5">
              <DukaMark white />
            </div>
          </div>
          <div>
            <p className="font-display text-[14px] font-bold leading-tight text-[#172B4D]">DukaFlow POS</p>
            <p className="text-[11px] text-[#6B778C]">
              {activeStore ? activeStore.name : "All Stores"} • {user?.name ?? "Guest"} ({user?.role ?? "Staff"})
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Cash-drawer / shift control (X & Z reports) */}
          <button
            onClick={() => setTillOpen(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#DFE1E6] bg-white px-3 text-[11px] font-bold text-[#172B4D] transition hover:border-[#0052CC]/50 hover:text-[#0052CC]"
            aria-label="Open cash drawer & shift reports"
          >
            <Landmark size={12} /> Till
            {tillSessionLive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00C853]" aria-hidden />}
          </button>
          {/* Price check mode - scans pop the price instead of selling */}
          <button
            onClick={() => setPriceCheckOn((v) => !v)}
            aria-pressed={priceCheckOn}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[11px] font-bold transition",
              priceCheckOn
                ? "border-[#FFD54F] bg-[#FFF8E1] text-[#B8860B]"
                : "border-[#DFE1E6] bg-white text-[#172B4D] hover:border-[#B8860B]/50 hover:text-[#B8860B]"
            )}
            aria-label="Toggle price check mode"
          >
            <ScanSearch size={12} /> Price Check
          </button>
          {/* Fullscreen till (F11 style) */}
          <button
            onClick={toggleFullscreen}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#DFE1E6] bg-white px-3 text-[11px] font-bold text-[#172B4D] transition hover:border-[#0052CC]/50 hover:text-[#0052CC]"
            aria-label={isFs ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFs ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            {isFs ? "Exit Full" : "Fullscreen"}
          </button>
          {/* Quick return - scan a receipt at the till (F4) */}
          <button
            onClick={() => setQuickReturnOpen(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#FFCDD2] bg-[#FFEBEE] px-3 text-[11px] font-bold text-[#C62828] transition hover:border-[#FF5630]/60 hover:bg-[#ffe3e0]"
            aria-label="Process a quick return - scan or type a receipt number"
          >
            <RotateCcw size={12} /> Quick Return
            <kbd className="rounded border border-[#F4B8B0] bg-white/70 px-1 font-sans text-[9px] font-bold text-[#C62828]">F4</kbd>
          </button>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold",
              online ? "border-[#C8E6C9] bg-[#E8F5E9] text-[#1B7A2E]" : "border-[#FFE0B2] bg-[#FFF8E1] text-[#B8860B]"
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", online ? "animate-pulse bg-[#00C853]" : "bg-[#FFAB00]")} />
            {online ? "Online • Auto-sync" : "Offline mode"}
          </span>
          {unsynced > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF0E5] px-2.5 py-1 text-[11px] font-bold text-[#D04A1E]">
              <Package size={11} /> {unsynced} queued
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full border border-[#C8E6C9] bg-[#E8F5E9] px-2.5 py-1 text-[11px] font-bold text-[#1B7A2E]">
            <Check size={11} /> Offline-ready
          </span>
        </div>
      </div>

      {/* body */}
      <div className="grid min-h-0 flex-1 grid-cols-1 @4xl:grid-cols-12">
        {/* -- LEFT: catalog ----------------------------------- */}
        <div className="flex min-h-0 flex-col bg-[#F4F5F7] @4xl:col-span-7">
          {/* search */}
          <div className="flex items-center gap-3 p-4 pb-2">
            <div className="relative max-w-[520px] flex-1">
              <span
                className={cn(
                  "absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg",
                  searchFocus ? "df-barcode-pulse bg-[#FFF8E1] text-[#B8860B]" : "bg-[#F4F5F7] text-[#6B778C]"
                )}
              >
                {searchFocus ? <ScanBarcode size={15} /> : <Search size={15} />}
              </span>
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setSearchFocus(true)}
                onBlur={() => setSearchFocus(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && Date.now() - lastScanAtRef.current > 600) {
                    // a gun burst resolves through the global scanner listener;
                    // this path is for human typing (first filtered match)
                    if (priceCheckOn) {
                      const exact = products.find((p) => p.barcode === search.trim() || p.sku === search.trim());
                      if (exact) {
                        showPricePopup(exact);
                        setSearch("");
                        return;
                      }
                    }
                    if (visibleProducts.length > 0) {
                      addToCart(visibleProducts[0]);
                      toast({ title: `${visibleProducts[0].name} added`, description: KES(visibleProducts[0].price) });
                      setSearch("");
                    }
                  }
                }}
                placeholder={priceCheckOn ? "Scan or type to CHECK a price… (F2)" : "Scan barcode or search items… (F2)"}
                className="h-10 rounded-xl border-[#DFE1E6] bg-white pl-11 pr-10 text-[13px]"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-[#DFE1E6] bg-[#FAFBFC] px-1.5 py-0.5 text-[10px] font-bold text-[#6B778C]">
                F2
              </span>
            </div>
            {priceCheckOn && (
              <span className="df-scan-bar inline-flex shrink-0 items-center gap-1 rounded-full border border-[#FFD54F] bg-[#FFF8E1] px-2.5 py-1 text-[10px] font-bold text-[#B8860B]">
                <ScanSearch size={11} /> PRICE CHECK MODE
              </span>
            )}
          </div>

          {/* category pills */}
          <div className="df-scroll flex items-center gap-1.5 overflow-x-auto px-4 pb-2">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cn(
                  "whitespace-nowrap rounded-full border px-3 py-1.5 text-[12px] font-semibold transition",
                  category === c
                    ? "border-[#0052CC] bg-[#0052CC] text-white"
                    : "border-[#DFE1E6] bg-white text-[#6B778C] hover:border-[#0052CC]/40"
                )}
              >
                {c}
              </button>
            ))}
          </div>

          {/* customer strip */}
          <div className="flex items-center justify-between gap-3 border-b border-[#DFE1E6] bg-white px-4 py-2.5">
            {customer ? (
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#172B4D] text-[11px] font-bold text-white">
                  {initials(customer.name)}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-[#172B4D]">
                    {customer.name} <TierBadge tier={customer.tier} />
                  </p>
                  <p className="text-[11px] text-[#6B778C]">{customer.phone}</p>
                </div>
                <button
                  type="button"
                  aria-label="Clear customer"
                  onClick={() => {
                    setCustomer(null);
                    setUsePoints(false);
                  }}
                  className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#DFE1E6] text-[#6B778C] transition hover:text-[#FF5630]"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#DFE1E6] text-[#6B778C]">
                  <Users size={14} />
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-[#172B4D]">Walk-in customer</p>
                  <p className="text-[11px] text-[#6B778C]">No loyalty • No debt tracking</p>
                </div>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCustQuery("");
                setPickerOpen(true);
              }}
              className="h-8 shrink-0 rounded-full border-[#DFE1E6] bg-white px-3 text-[12px] font-semibold text-[#172B4D]"
            >
              {customer ? "Change" : "Select customer"}
            </Button>
          </div>

          {/* product grid */}
          <div className="df-scroll min-h-0 flex-1 overflow-y-auto p-4 pt-3">
            {productsLoading ? (
              <div className="grid grid-cols-2 gap-3 @6xl:grid-cols-3">
                {Array.from({ length: 9 }).map((_, i) => (
                  <Skeleton key={i} className="h-[168px] rounded-2xl" />
                ))}
              </div>
            ) : visibleProducts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#DFE1E6] bg-white/70 py-12 text-center">
                <Package size={28} className="mx-auto mb-2 text-[#6B778C]" />
                <p className="font-display text-[14px] font-semibold text-[#172B4D]">No products found</p>
                <p className="mt-1 text-[12px] text-[#6B778C]">Try another search, category or store.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 @6xl:grid-cols-3">
                {visibleProducts.map((p) => {
                  const qty = stockQty(p, activeStoreId);
                  const out = qty <= 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={out}
                      onClick={() => addToCart(p)}
                      className={cn(
                        "group flex flex-col rounded-2xl border border-[#DFE1E6] bg-white p-3 text-left shadow-sm transition hover:shadow-md",
                        out && "opacity-60"
                      )}
                    >
                      <div className="relative flex h-14 items-center justify-center rounded-xl bg-[#F4F5F7] text-2xl">
                        {p.emoji}
                        {out && (
                          <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/70">
                            <span className="rounded-full bg-[#172B4D] px-2 py-1 text-[10px] font-bold text-white">
                              Out of Stock
                            </span>
                          </span>
                        )}
                        <span className="absolute -top-1.5 right-1.5">
                          <StockBadge qty={qty} />
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-[13px] font-semibold leading-tight text-[#172B4D]">{p.name}</p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-[#6B778C]">{p.sku}</p>
                      <div className="mt-auto flex items-center justify-between pt-2">
                        <span className="font-display text-[13px] font-bold text-[#172B4D]">{KES(p.price)}</span>
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0052CC] text-white transition group-hover:bg-[#0041A8] group-disabled:bg-[#DFE1E6]">
                          <Plus size={14} />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* -- RIGHT: cart ------------------------------------- */}
        <div className="flex min-h-0 flex-col border-t border-[#DFE1E6] bg-white @4xl:col-span-5 @4xl:border-l @4xl:border-t-0">
          {/* customer card */}
          {customer ? (
            <div className="relative border-b border-[#DFE1E6] bg-[#FAFBFC] p-4 pt-5">
              <div className="absolute inset-x-0 top-0 h-1.5" style={{ background: tierColor(customer.tier) }} />
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#172B4D] text-[12px] font-bold text-white">
                    {initials(customer.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-[#172B4D]">
                      {customer.name} <TierBadge tier={customer.tier} />
                    </p>
                    <p className="text-[11px] text-[#6B778C]">{customer.phone}</p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Clear customer"
                  onClick={() => {
                    setCustomer(null);
                    setUsePoints(false);
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#DFE1E6] bg-white text-[#6B778C] transition hover:text-[#FF5630]"
                >
                  <X size={12} />
                </button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-lg border border-[#DFE1E6] bg-white p-2">
                  <p className="flex items-center gap-1 font-semibold text-[#6B778C]">
                    <Sparkles size={11} className="text-[#B8860B]" /> Points
                  </p>
                  <p className="mt-0.5 font-bold text-[#172B4D]">{customer.loyaltyPoints} pts</p>
                </div>
                <div
                  className={cn(
                    "rounded-lg border p-2",
                    customer.debtBalance > 0 ? "border-[#FFCDD2] bg-[#FFEBEE]" : "border-[#DFE1E6] bg-white"
                  )}
                >
                  <p className="flex items-center gap-1 font-semibold text-[#6B778C]">
                    <HandCoins size={11} /> Debt
                  </p>
                  <p className={cn("mt-0.5 font-bold", customer.debtBalance > 0 ? "text-[#C62828]" : "text-[#172B4D]")}>
                    {KES(customer.debtBalance)}
                  </p>
                </div>
                <div className="rounded-lg border border-[#DFE1E6] bg-white p-2">
                  <p className="flex items-center gap-1 font-semibold text-[#6B778C]">
                    <Gift size={11} className="text-[#0052CC]" /> Gift Card
                  </p>
                  <p className="mt-0.5 font-bold text-[#172B4D]">{KES(customer.giftCardBalance)}</p>
                </div>
                <div className="rounded-lg border border-[#DFE1E6] bg-white p-2">
                  <p className="flex items-center gap-1 font-semibold text-[#6B778C]">
                    <Shield size={11} className="text-[#1B7A2E]" /> Credit limit
                  </p>
                  <p className="mt-0.5 font-bold text-[#172B4D]">{KES(customer.creditLimit, true)}</p>
                  {customer.creditLimit > 0 && (
                    <div className="mt-1 h-1 rounded-full bg-[#F4F5F7]">
                      <div
                        className="h-1 rounded-full bg-[#FF5630]"
                        style={{ width: `${Math.min(100, Math.round((customer.debtBalance / customer.creditLimit) * 100))}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="border-b border-[#DFE1E6] bg-[#FAFBFC] p-4">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-[#DFE1E6] p-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#DFE1E6] text-[#6B778C]">
                    <Users size={15} />
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold text-[#172B4D]">Walk-in customer</p>
                    <p className="text-[11px] text-[#6B778C]">No loyalty • No debt</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCustQuery("");
                    setPickerOpen(true);
                  }}
                  className="h-8 rounded-full border-[#DFE1E6] bg-white px-3 text-[12px] font-semibold text-[#172B4D]"
                >
                  Select customer
                </Button>
              </div>
            </div>
          )}

          {/* cart lines */}
          <div className="df-scroll df-pos-cart-scroll min-h-0 flex-1 space-y-2 p-3">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center py-10 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F4F5F7] text-[#6B778C]">
                  <ShoppingCart size={20} />
                </div>
                <p className="font-display text-[14px] font-semibold text-[#172B4D]">Cart empty - scan or tap a product</p>
                <p className="mt-1 text-[12px] text-[#6B778C]">Works fully offline; sales queue and auto-sync.</p>
              </div>
            ) : (
              cart.map((l) => {
                const kg = scaleKg[l.productId];
                return (
                <div
                  key={l.productId}
                  className="flex gap-3 rounded-xl border border-[#F4F5F7] bg-[#FAFBFC] p-2 transition hover:border-[#DFE1E6]"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#DFE1E6] bg-white text-lg">
                    {l.emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-[#172B4D]">{l.name}</p>
                    <p className="truncate text-[11px] text-[#6B778C]">
                      {l.sku} • {KES(l.unitPrice)}
                    </p>
                    {kg != null && (
                      <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-full border border-[#C8E6C9] bg-[#E8F5E9] px-1.5 py-0.5 text-[10px] font-bold text-[#1B7A2E]">
                        <ScaleIcon size={9} /> {l.qty} kg x {KES(l.unitPrice)}/kg
                      </span>
                    )}
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex items-center gap-1 rounded-full border border-[#DFE1E6] bg-white px-1">
                        <button
                          type="button"
                          aria-label="Decrease quantity"
                          onClick={() => setLineQty(l.productId, kg != null ? l.qty - 0.05 : l.qty - 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-[#6B778C] transition hover:bg-[#F4F5F7] hover:text-[#172B4D]"
                        >
                          <Minus size={12} />
                        </button>
                        <input
                          value={l.qty}
                          onChange={(e) =>
                            setLineQty(
                              l.productId,
                              kg != null
                                ? Number(e.target.value.replace(/[^\d.]/g, "")) || 0.01
                                : Number(e.target.value.replace(/\D/g, "")) || 1
                            )
                          }
                          inputMode="decimal"
                          aria-label={`Quantity for ${l.name}`}
                          className="w-10 border-0 bg-transparent text-center text-[12px] font-bold text-[#172B4D] outline-none"
                        />
                        <button
                          type="button"
                          aria-label="Increase quantity"
                          onClick={() => setLineQty(l.productId, kg != null ? l.qty + 0.05 : l.qty + 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-[#6B778C] transition hover:bg-[#F4F5F7] hover:text-[#172B4D]"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end justify-between">
                    <p className="whitespace-nowrap text-[13px] font-bold text-[#172B4D]">{kes(l.unitPrice * l.qty)}</p>
                    <button
                      type="button"
                      aria-label={`Remove ${l.name}`}
                      onClick={() => removeLine(l.productId)}
                      className="text-[#FF5630] transition hover:opacity-70"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                );
              })
            )}
          </div>

          {/* hold + resume + clear (Naivas park-and-serve) */}
          <div className="flex items-center gap-2 border-t border-[#DFE1E6] bg-[#FAFBFC] px-3 py-2">
            <Button
              variant="outline"
              size="sm"
              disabled={cart.length === 0 || holding}
              onClick={() => void holdCart()}
              className="h-8 flex-1 rounded-lg border-[#DFE1E6] bg-white px-2 text-[11px] font-bold text-[#172B4D] hover:border-[#B8860B]/60 hover:text-[#B8860B]"
              aria-label="Hold the current cart and serve the next customer"
            >
              {holding ? <Loader2 size={13} className="animate-spin" /> : <Pause size={13} />} HOLD
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setHoldsOpen(true);
                void refreshHolds();
              }}
              className="h-8 flex-1 rounded-lg border-[#DFE1E6] bg-white px-2 text-[11px] font-bold text-[#172B4D] hover:border-[#0052CC]/60 hover:text-[#0052CC]"
              aria-label="Resume a parked cart"
            >
              <History size={13} /> RESUME
              {holds.length > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0052CC] px-1 text-[9px] font-bold text-white">
                  {holds.length}
                </span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={cart.length === 0}
              onClick={clearCartState}
              className="h-8 rounded-lg px-2 text-[11px] font-bold text-[#6B778C] hover:text-[#FF5630]"
              aria-label="Clear the cart"
            >
              <Trash2 size={13} /> CLEAR
            </Button>
          </div>

          {/* totals footer */}
          <div className="space-y-3 border-t border-[#DFE1E6] bg-white p-4">
            {/* happy hour auto-pricing banner */}
            {hhActive && hhCfg && (
              <div className="df-happy-banner flex items-center gap-2.5 rounded-xl border border-[#FFD54F] bg-gradient-to-r from-[#FFF8E1] via-[#FFF3CD] to-[#FFF8E1] px-3 py-2">
                <span className="df-happy-dot h-2 w-2 shrink-0 rounded-full bg-[#FFAB00]" />
                <Beer size={15} className="shrink-0 text-[#B8860B]" />
                <p className="min-w-0 flex-1 text-[12px] font-bold text-[#8D6708]">
                  Happy Hour! {Math.round(hhCfg.happyHourPercent)}% off {hhCfg.happyHourCategory === "All" ? "everything" : hhCfg.happyHourCategory}
                  <span className="ml-1 font-medium">until {hhCfg.happyHourEnd}</span>
                </p>
                {happyHourDiscount > 0 && (
                  <span className="shrink-0 font-mono text-[12px] font-bold text-[#FF5630]">−{KES(totals.happyHourDiscount)}</span>
                )}
              </div>
            )}
            {/* promo */}
            {promo ? (
              <div className="flex items-center justify-between rounded-xl border border-[#C8E6C9] bg-[#E8F5E9] px-3 py-2">
                <span className="flex items-center gap-1.5 text-[12px] font-bold text-[#1B7A2E]">
                  <Check size={13} /> {promo}
                  {totals.promoEligible ? (
                    <span>−{KES(totals.promoDiscount)}</span>
                  ) : (
                    <span className="font-semibold text-[#B8860B]">needs min spend KES 5,000</span>
                  )}
                </span>
                <button type="button" aria-label="Remove promo" onClick={() => setPromo(null)} className="text-[#6B778C] hover:text-[#FF5630]">
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  value={promoInput}
                  onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && applyPromo()}
                  placeholder="Promo code (e.g. GOLD10)"
                  className="h-9 flex-1 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px]"
                />
                <Button
                  variant="outline"
                  onClick={applyPromo}
                  className="h-9 rounded-xl border-[#DFE1E6] bg-white px-4 text-[12px] font-bold text-[#172B4D]"
                >
                  Apply
                </Button>
              </div>
            )}

            {/* bill discount + loyalty */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="bill-discount" className="text-[10px] font-semibold uppercase tracking-wide text-[#6B778C]">
                  Bill discount KES
                </label>
                <Input
                  id="bill-discount"
                  type="number"
                  min={0}
                  value={billDiscount}
                  onChange={(e) => setBillDiscount(e.target.value)}
                  placeholder="0"
                  className="mt-1 h-9 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px]"
                />
              </div>
              {customer && (
                <div className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={usePoints}
                      onCheckedChange={setUsePoints}
                      disabled={customer.loyaltyPoints <= 0}
                      className="data-[state=checked]:bg-[#00C853]"
                    />
                    <p className="text-[12px] font-semibold text-[#172B4D]">Use points</p>
                  </div>
                  <p className="mt-0.5 text-[10px] leading-tight text-[#6B778C]">
                    {customer.loyaltyPoints} pts available (1 pt = KES {pointValue})
                    {totals.pointsToUse > 0 && (
                      <b className="text-[#1B7A2E]">
                        {" "}
                        • −KES {totals.pointsValue.toLocaleString()} ({totals.pointsToUse} pts used)
                      </b>
                    )}
                  </p>
                </div>
              )}
            </div>

            {/* totals */}
            <div className="space-y-1.5 text-[13px]">
              <div className="flex justify-between">
                <span className="text-[#6B778C]">Subtotal</span>
                <span className="font-semibold text-[#172B4D]">{KES(totals.subtotal)}</span>
              </div>
              {totals.tierDiscount > 0 && customer && (
                <div className="flex justify-between">
                  <span className="text-[#6B778C]">
                    Discount <span className="font-medium text-[#B8860B]">({customer.tier} {Math.round(totals.tierPct * 100)}% applied)</span>
                  </span>
                  <span className="font-semibold text-[#FF5630]">−{KES(totals.tierDiscount)}</span>
                </div>
              )}
              {hhActive && totals.happyHourDiscount > 0 && hhCfg && (
                <div className="flex justify-between">
                  <span className="text-[#6B778C]">
                    Happy Hour <span className="font-medium text-[#B8860B]">({happyHourLabel(hhCfg)} • {Math.round(hhCfg.happyHourPercent)}%)</span>
                  </span>
                  <span className="font-semibold text-[#FF5630]">−{KES(totals.happyHourDiscount)}</span>
                </div>
              )}
              {promo && totals.promoEligible && (
                <div className="flex justify-between">
                  <span className="text-[#6B778C]">Promo {promo}</span>
                  <span className="font-semibold text-[#FF5630]">−{KES(totals.promoDiscount)}</span>
                </div>
              )}
              {billNum > 0 && (
                <div className="flex justify-between">
                  <span className="text-[#6B778C]">Bill discount</span>
                  <span className="font-semibold text-[#FF5630]">−{KES(totals.billDiscount)}</span>
                </div>
              )}
              {totals.pointsToUse > 0 && (
                <div className="flex justify-between">
                  <span className="text-[#6B778C]">Points redemption</span>
                  <span className="font-semibold text-[#FF5630]">−{KES(totals.pointsValue)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[#6B778C]">VAT {Math.round(vatRate * 100)}%</span>
                <span className="font-semibold text-[#172B4D]">{KES(totals.vat)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-dashed border-[#DFE1E6] pt-2">
                <span className="font-display text-[14px] font-bold text-[#172B4D]">GRAND TOTAL</span>
                <span className="font-display text-[22px] font-extrabold text-[#172B4D]">{KES(totals.total)}</span>
              </div>
            </div>

            {/* payment modes */}
            <div className="grid grid-cols-3 gap-2">
              {PAY_METHODS.map((m) => {
                const active = paymentMethod === m.method;
                return (
                  <button
                    key={m.method}
                    type="button"
                    onClick={() => setPaymentMethod(m.method)}
                    className={cn(
                      "flex h-[52px] flex-col items-center justify-center gap-1 rounded-xl border px-1 text-[10px] font-bold leading-tight transition",
                      active
                        ? "border-[#172B4D] bg-[#172B4D] text-white shadow-md"
                        : "border-[#DFE1E6] bg-[#FAFBFC] hover:bg-white"
                    )}
                    style={active ? undefined : { color: m.color }}
                  >
                    <m.icon size={16} />
                    {m.label}
                  </button>
                );
              })}
            </div>

            {/* PAY - opens the payment dialog (single tender or split) */}
            <Button
              type="button"
              disabled={cart.length === 0 || paying}
              onClick={() => setPayOpen(true)}
              className="h-12 w-full rounded-xl bg-[#0052CC] text-[15px] font-bold text-white shadow-[0_8px_24px_rgba(0,82,204,0.35)] hover:bg-[#0041A8]"
            >
              {paying ? <Loader2 size={18} className="animate-spin" /> : <ShoppingBag size={18} />}
              {paying ? "Processing…" : `PAY ${KES(totals.total)}`}
            </Button>

            {/* peripheral row */}
            <div className="flex items-center justify-between text-[11px] text-[#6B778C]">
              <button
                type="button"
                onClick={() => toast({ title: "Receipt sent to 80mm printer" })}
                className="flex items-center gap-1 transition hover:text-[#172B4D]"
              >
                <Printer size={12} /> 80mm receipt
              </button>
              <button
                type="button"
                onClick={() => toast({ title: "💵 Drawer kicked" })}
                className="flex items-center gap-1 font-semibold transition hover:text-[#172B4D]"
              >
                <Wallet size={12} /> Cash drawer
              </button>
              <button
                type="button"
                onClick={() => toast({ title: "Display pole live", description: "Open /display in a second window - it mirrors this cart live" })}
                className="flex items-center gap-1 transition hover:text-[#172B4D]"
              >
                <MonitorSmartphone size={12} /> Display
              </button>
            </div>
            <p className="text-center text-[10px] text-[#6B778C]">
              Prices include 0% rating for exempt items - VAT auto-calculated
            </p>
          </div>
        </div>
      </div>

      {/* -- customer picker dialog ------------------------------ */}
      <Dialog
        open={pickerOpen}
        onOpenChange={(o) => {
          setPickerOpen(o);
          if (!o) setCustQuery("");
        }}
      >
        <DialogContent className="max-w-[520px] overflow-hidden rounded-2xl p-0">
          <div className="border-b border-[#DFE1E6] bg-[#FAFBFC] p-4">
            <DialogHeader>
              <DialogTitle className="font-display text-[15px] font-bold text-[#172B4D]">Select customer</DialogTitle>
              <DialogDescription className="text-[12px]">
                Search by name or phone (e.g. 0712), or create a new walk-in signup.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={custQuery}
              onChange={(e) => setCustQuery(e.target.value)}
              placeholder="Search name or phone…"
              autoFocus
              className="mt-3 h-10 rounded-xl border-[#DFE1E6] bg-white text-[13px]"
            />
          </div>
          <div className="df-scroll max-h-[300px] overflow-y-auto p-2">
            {custLoading ? (
              <div className="space-y-2 p-1">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-xl" />
                ))}
              </div>
            ) : custResults.length === 0 ? (
              <p className="py-8 text-center text-[12px] text-[#6B778C]">No customers match - create one below.</p>
            ) : (
              custResults.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCustomer(c);
                    setPickerOpen(false);
                    setCustQuery("");
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-transparent p-2 text-left transition hover:border-[#DFE1E6] hover:bg-[#FAFBFC]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#172B4D] text-[11px] font-bold text-white">
                    {initials(c.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-[#172B4D]">
                      {c.name} <TierBadge tier={c.tier} />
                    </p>
                    <p className="truncate text-[11px] text-[#6B778C]">
                      {c.phone}
                      {c.debtBalance > 0 && <b className="text-[#FF5630]"> • Debt {KES(c.debtBalance)}</b>}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] font-bold text-[#6B778C]">{c.loyaltyPoints} pts</span>
                </button>
              ))
            )}
          </div>
          <div className="border-t border-[#DFE1E6] bg-[#FAFBFC] p-4">
            <p className="text-[12px] font-bold text-[#172B4D]">＋ New customer</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Full name"
                className="h-9 min-w-[130px] flex-1 rounded-xl border-[#DFE1E6] bg-white text-[13px]"
              />
              <Input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="07xx xxx xxx"
                inputMode="tel"
                className="h-9 min-w-[130px] flex-1 rounded-xl border-[#DFE1E6] bg-white text-[13px]"
              />
              <Button
                disabled={!newName.trim() || !newPhone.trim() || creating}
                onClick={() => void createCustomer()}
                className="h-9 rounded-xl bg-[#0052CC] px-4 text-[12px] font-bold text-white hover:bg-[#0041A8]"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* -- M-Pesa STK dialog ----------------------------------- */}
      <Dialog open={stk.open} onOpenChange={(o) => !o && setStk((s) => ({ ...s, open: false }))}>
        <DialogContent className="max-w-[420px] rounded-2xl" showCloseButton={false}>
          <DialogTitle className="sr-only">M-Pesa STK Push</DialogTitle>
          <DialogDescription className="sr-only">
            Confirm the M-Pesa payment on the customer&apos;s phone.
          </DialogDescription>
          <div className="flex flex-col items-center py-4 text-center">
            <div
              className={cn(
                "flex h-14 w-14 items-center justify-center rounded-2xl",
                stk.phase === "success" ? "bg-[#E8F5E9] text-[#00C853]" : "bg-[#E9F2FF] text-[#0052CC]"
              )}
            >
              {stk.phase === "success" ? <Check size={26} /> : <Loader2 size={26} className="animate-spin" />}
            </div>
            <h3 className="font-display mt-3 text-[16px] font-bold text-[#172B4D]">M-Pesa STK Push</h3>
            <p className="mt-1 text-[13px] text-[#6B778C]">
              {stk.phase === "success" ? "Payment confirmed" : "Enter M-Pesa PIN on your phone"}
            </p>
            <p className="mt-2 rounded-full bg-[#F4F5F7] px-3 py-1 font-mono text-[12px] font-bold text-[#172B4D]">
              {stk.phone} • {KES(totals.total)}
            </p>
            {stk.message && <p className="mt-2 max-w-[300px] text-[11px] text-[#6B778C]">{stk.message}</p>}
            {stk.phase === "pending" && (
              <p className="mt-3 text-[11px] font-semibold text-[#B8860B]">Polling Daraja simulator…</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* -- success / offline-queued modal ---------------------- */}
      <Dialog open={!!success} onOpenChange={(o) => !o && resetTransaction()}>
        <DialogContent className="max-w-[560px] overflow-hidden rounded-[24px] p-0">
          <DialogTitle className="sr-only">Sale receipt</DialogTitle>
          <DialogDescription className="sr-only">Sale completed successfully.</DialogDescription>
          {success && (
            <>
              <div className="df-print-area bg-white p-6 text-center md:p-8">
                <div className="df-point-pop mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#E8F5E9]">
                  <Check size={36} className="text-[#00C853]" />
                </div>
                <h2 className="font-display mt-4 text-[24px] font-bold text-[#172B4D]">
                  {success.offline ? "Sale Queued Offline!" : "Sale Complete!"}
                </h2>
                <p className="mt-1 text-[14px] text-[#6B778C]">
                  <span className="font-mono font-semibold text-[#172B4D]">{success.sale.receiptNo}</span> •{" "}
                  {success.sale.paymentMethod}
                  {success.offline && (
                    <span className="ml-2 rounded-full bg-[#FFF8E1] px-2 py-0.5 text-[10px] font-bold text-[#B8860B]">
                      OFFLINE QUEUED
                    </span>
                  )}
                </p>

                {/* KRA eTIMS QR */}
                {success.sale.qrCodeBase64 && !success.offline && (
                  <div className="mx-auto mt-5 w-fit rounded-xl border border-[#DFE1E6] p-3">
                    <img
                      src={success.sale.qrCodeBase64}
                      alt="KRA verification QR"
                      width={120}
                      height={120}
                      className="rounded-lg"
                    />
                    <p className="mt-2 text-[10px] font-medium text-[#6B778C]">
                      KRA Verification QR - CU:{" "}
                      <span className="font-mono">{success.sale.cuInvoiceNumber ?? "-"}</span>
                    </p>
                  </div>
                )}

                {/* digital receipt twin: NVS code + QR + thermal print */}
                {success.digitalReceipt && !success.offline && (
                  <div className="mx-auto mt-4 flex w-fit max-w-full items-center gap-4 rounded-xl border border-[#C8E6C9] bg-[#F6FBF6] p-3">
                    <QrImage text={success.digitalReceipt.url} size={92} alt="Digital receipt QR" />
                    <div className="min-w-0 text-left">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1B7A2E]">Digital receipt</p>
                      <p className="truncate font-mono text-[13px] font-bold text-[#172B4D]">{success.digitalReceipt.code}</p>
                      <p className="mt-0.5 max-w-[190px] text-[10px] leading-tight text-[#6B778C]">
                        Scan to view, print or verify anytime - the QR never dies.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void printReceiptDocs(saleToPrintDoc(success), "thermal")}
                        className="mt-1.5 h-7 rounded-lg border-[#DFE1E6] bg-white px-2.5 text-[11px] font-bold text-[#172B4D]"
                      >
                        <Printer size={12} /> Print Receipt
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void printReceiptDocs(saleToPrintDoc(success), "a4")}
                        className="ml-1.5 mt-1.5 h-7 rounded-lg border-[#DFE1E6] bg-white px-2.5 text-[11px] font-bold text-[#172B4D]"
                      >
                        <FileText size={12} /> Print A4 PDF
                      </Button>
                    </div>
                  </div>
                )}

                {/* loyalty QR */}
                {success.loyalty && success.sale.customerId && !success.offline && (
                  <div className="mt-4 flex items-center justify-center gap-4 rounded-xl border border-[#FFE082] bg-[#FFFDE7] p-3">
                    <QrImage
                      text={`DUKAFLOW-LOYALTY:${success.sale.customerId}:${success.loyalty.balance}`}
                      size={100}
                      alt="Loyalty QR"
                    />
                    <div className="text-left">
                      <p className="df-point-pop font-display text-[15px] font-bold text-[#B8860B]">
                        +{success.loyalty.earned} points earned
                      </p>
                      <p className="mt-0.5 text-[12px] text-[#6B778C]">
                        Balance {success.loyalty.balance} pts • {customer?.name ?? "Customer"}
                      </p>
                    </div>
                  </div>
                )}

                {/* totals recap */}
                <div className="mx-auto mt-5 w-full max-w-[320px] space-y-1.5 rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-3 text-[12px]">
                  <div className="flex justify-between">
                    <span className="text-[#6B778C]">Subtotal</span>
                    <span className="font-semibold text-[#172B4D]">{KES(success.sale.subtotal)}</span>
                  </div>
                  {success.sale.discount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-[#6B778C]">Discount</span>
                      <span className="font-semibold text-[#FF5630]">−{KES(success.sale.discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[#6B778C]">VAT</span>
                    <span className="font-semibold text-[#172B4D]">{KES(success.sale.vat)}</span>
                  </div>
                  <div className="flex justify-between border-t border-dashed border-[#DFE1E6] pt-1.5">
                    <span className="font-bold text-[#172B4D]">Total</span>
                    <span className="font-display text-[15px] font-extrabold text-[#172B4D]">{KES(success.sale.total)}</span>
                  </div>
                </div>
                {success.offline && (
                  <p className="mt-3 text-[11px] text-[#6B778C]">
                    Stored on this device - will sync automatically when back online.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 border-t border-[#DFE1E6] bg-[#FAFBFC] p-4">
                <Button
                  variant="outline"
                  onClick={() => void printReceiptDocs(saleToPrintDoc(success), "thermal" as ReceiptPrintMode)}
                  className="h-10 rounded-xl border-[#DFE1E6] bg-white text-[13px] font-semibold text-[#172B4D]"
                >
                  <Printer size={14} /> Print 80mm
                </Button>
                {!success.offline && success.sale.kraStatus === "Verified" ? (
                  <Button
                    onClick={() => void openSuccessEmail()}
                    className="h-10 rounded-xl border border-[#C5CAE9] bg-[#E8EAF6] text-[13px] font-semibold text-[#283593] hover:bg-[#DCDFF5]"
                  >
                    <Mail size={14} /> Email
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    disabled
                    title={success.offline ? "Sync the queued sale first - offline sales have no KRA invoice yet" : "Retry eTIMS on the Receipts screen once online"}
                    className="h-10 rounded-xl border-dashed border-[#DFE1E6] bg-white text-[13px] font-semibold text-[#6B778C]"
                  >
                    <Mail size={14} /> Email
                  </Button>
                )}
                <Button
                  onClick={resetTransaction}
                  className="h-10 rounded-xl bg-[#172B4D] text-[13px] font-bold text-white hover:bg-[#0F1E38]"
                >
                  <ShoppingBag size={14} /> New Sale
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* -- POS e-invoice email dialog ----------------------- */}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="rounded-2xl sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-[15px] font-bold text-[#172B4D]">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8EAF6] text-[#283593]">
                <Mail size={15} />
              </span>
              Email KRA e-invoice
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              {success?.sale.receiptNo} - verified electronic tax invoice (mock mailer, audited in Messages).
            </DialogDescription>
          </DialogHeader>

          {emailLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-[#6B778C]">
              <Loader2 size={14} className="animate-spin" /> Preparing invoice email…
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pos-email-to" className="text-[10px] font-bold uppercase tracking-wide text-[#6B778C]">
                  To
                </Label>
                <Input
                  id="pos-email-to"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="customer@email.com"
                  type="email"
                  className="h-9 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px]"
                />
                <p className="text-[10px] text-[#6B778C]">
                  {customer?.email
                    ? "Customer has an email on file - future verified invoices auto-send to it."
                    : `No email on file for ${customer?.name ?? "this customer"} - the address you send to will be saved.`}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-wide text-[#6B778C]">Subject</Label>
                <p className="rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-3 py-2 text-[12px] font-semibold text-[#172B4D]">
                  {emailSubject}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-wide text-[#6B778C]">Preview</Label>
                <pre className="df-scroll max-h-[200px] overflow-auto whitespace-pre-wrap rounded-xl border border-[#DFE1E6] bg-white p-3 font-mono text-[11px] leading-relaxed text-[#172B4D]">
                  {emailBody}
                </pre>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEmailOpen(false)} className="h-9 rounded-xl text-[12px] font-bold text-[#172B4D]">
              Cancel
            </Button>
            <Button
              disabled={emailLoading || emailSending || !emailTo.trim()}
              onClick={() => void sendSuccessEmail()}
              className="h-9 rounded-xl bg-[#283593] px-5 text-[12px] font-bold text-white hover:bg-[#1A237E]"
            >
              {emailSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send email
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* -- payment dialog: single tender OR multi-pay split ---- */}
      <Dialog open={payOpen} onOpenChange={(o) => !o && setPayOpen(false)}>
        <DialogContent className="df-modal-scroll max-w-[540px] rounded-2xl df-scroll">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center justify-between text-[16px] font-bold text-[#172B4D]">
              <span>Complete sale</span>
              <span className="font-display text-[20px] font-extrabold text-[#0052CC]">{KES(totals.total)}</span>
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              {splits.length === 0
                ? `Single payment on ${paymentMethod} - or split across up to 4 tenders.`
                : `Splitting ${KES(splitsSum)} across ${splits.length} tender${splits.length > 1 ? "s" : ""}.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* split rows */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">Split payment</p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={splits.length >= 4}
                  onClick={() => setSplits((prev) => [...prev, { method: "Cash", amount: "" }])}
                  className="h-7 rounded-lg border-[#DFE1E6] px-2.5 text-[11px] font-bold text-[#172B4D]"
                >
                  <Plus size={12} /> Add split
                </Button>
              </div>

              {splits.length === 0 && (
                <p className="rounded-xl border border-dashed border-[#DFE1E6] bg-[#FAFBFC] px-3 py-2.5 text-[12px] text-[#6B778C]">
                  No splits - the full {KES(totals.total)} charges to <b className="text-[#172B4D]">{paymentMethod}</b>.
                </p>
              )}

              {splits.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select
                    value={s.method}
                    onValueChange={(v) =>
                      setSplits((prev) => prev.map((x, j) => (j === i ? { ...x, method: v } : x)))
                    }
                  >
                    <SelectTrigger className="h-9 flex-1 rounded-xl border-[#DFE1E6] text-[12px]" aria-label={`Split ${i + 1} method`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SPLIT_METHODS.map((m) => (
                        <SelectItem key={m} value={m} className="text-[12px]">
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={s.amount}
                    onChange={(e) =>
                      setSplits((prev) => prev.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                    }
                    placeholder="0"
                    aria-label={`Split ${i + 1} amount`}
                    className="h-9 w-[120px] rounded-xl border-[#DFE1E6] text-right text-[13px] font-bold"
                  />
                  <button
                    type="button"
                    aria-label={`Remove split ${i + 1}`}
                    onClick={() => setSplits((prev) => prev.filter((_, j) => j !== i))}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#6B778C] transition hover:bg-[#FFEBEE] hover:text-[#FF5630]"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>

            {/* live balance */}
            {splits.length > 0 && (
              <div className="flex items-center justify-between rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-3 py-2.5">
                <span className="text-[12px] font-semibold text-[#6B778C]">
                  Remaining after splits ({KES(splitsSum)} tendered)
                </span>
                <Badge
                  className={cn(
                    "rounded-full px-3 py-1 text-[11px] font-bold",
                    fullySplit
                      ? "border border-[#C8E6C9] bg-[#E8F5E9] text-[#1B7A2E]"
                      : splitOver
                        ? "border border-[#FFCDD2] bg-[#FFEBEE] text-[#C62828]"
                        : "border border-[#FFE0B2] bg-[#FFF8E1] text-[#B8860B]"
                  )}
                >
                  {fullySplit ? "Fully split" : splitOver ? `${KES(splitsSum - totals.total)} over` : `${KES(splitRemaining)} remaining`}
                </Badge>
              </div>
            )}

            {/* allow partial */}
            <div className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5", allowPartial ? "border-[#FFE0B2] bg-[#FFF8E1]" : "border-[#DFE1E6] bg-white")}>
              <Switch
                checked={allowPartial}
                onCheckedChange={setAllowPartial}
                disabled={!customer}
                className="data-[state=checked]:bg-[#B8860B]"
                aria-label="Allow partial payment"
              />
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-[#172B4D]">Allow partial (customer pays balance later)</p>
                <p className="text-[10px] text-[#6B778C]">
                  {customer
                    ? `Unpaid balance goes to ${customer.name}'s debt account`
                    : "Requires a customer on the sale - the balance tracks as debt"}
                </p>
              </div>
            </div>
          </div>

          <Button
            onClick={confirmPay}
            disabled={paying}
            className="h-12 w-full rounded-xl bg-[#0052CC] text-[14px] font-bold text-white hover:bg-[#0041A8]"
          >
            {paying ? <Loader2 size={16} className="animate-spin" /> : <ShoppingBag size={16} />}
            {paying
              ? "Processing…"
              : splits.length > 0
                ? `Charge ${KES(Math.min(splitsSum, totals.total))} split`
                : `Charge ${KES(totals.total)} via ${paymentMethod}`}
          </Button>
        </DialogContent>
      </Dialog>

      {/* -- hold/resume dialog (server + device mirror merged) --- */}
      <Dialog open={holdsOpen} onOpenChange={setHoldsOpen}>
        <DialogContent className="max-w-[640px] rounded-2xl p-0">
          <DialogHeader className="border-b border-[#DFE1E6] bg-[#FAFBFC] p-4">
            <DialogTitle className="font-display flex items-center gap-2 text-[15px] font-bold text-[#172B4D]">
              <History size={15} className="text-[#0052CC]" /> Parked carts - {activeStore?.name ?? "This store"}
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              Holds live on the server and are mirrored on this device - they survive refresh, offline mode and logout.
            </DialogDescription>
          </DialogHeader>
          <div className="df-modal-scroll df-scroll space-y-2 p-3">
            {holds.length === 0 ? (
              <p className="py-8 text-center text-[12px] text-[#6B778C]">
                No parked carts. Press HOLD at the till to park one.
              </p>
            ) : (
              holds.map((h) => {
                const names = (h.items ?? []).slice(0, 3).map((i) => i.name).join(" • ");
                const more = (h.items?.length ?? 0) > 3 ? ` +${h.items.length - 3} more` : "";
                return (
                  <div key={h.holdCode} className="flex items-center gap-3 rounded-xl border border-[#DFE1E6] bg-white p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FFF8E1] text-[#B8860B]">
                      <Pause size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-[12px] font-bold text-[#172B4D]">
                        <span className="font-mono">{h.holdCode}</span>
                        <Badge variant="outline" className="rounded-full px-1.5 py-0 text-[9px] font-bold text-[#6B778C]">
                          {timeAgo(h.createdAt)}
                        </Badge>
                        {h.local && (
                          <Badge className="rounded-full bg-[#FFF8E1] px-1.5 py-0 text-[9px] font-bold text-[#B8860B]">
                            ON THIS DEVICE
                          </Badge>
                        )}
                      </p>
                      <p className="truncate text-[11px] text-[#6B778C]">
                        {names}
                        {more} • {h.staffName}
                        {h.customerName ? ` • for ${h.customerName}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-display text-[13px] font-bold text-[#172B4D]">{KES(h.total)}</p>
                      <p className="text-[10px] text-[#6B778C]">{h.itemCount} item{h.itemCount === 1 ? "" : "s"}</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => void resumeHold(h)}
                      className="h-8 shrink-0 rounded-lg bg-[#0052CC] px-3 text-[11px] font-bold text-white hover:bg-[#0041A8]"
                    >
                      Resume
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* -- day lock (423): manager PIN override ------------------ */}
      <Dialog
        open={!!dayLock?.open}
        onOpenChange={(o) => {
          if (!o) void cancelDayLockSale();
        }}
      >
        <DialogContent className="max-w-[440px] rounded-2xl" showCloseButton={false}>
          <DialogHeader>
            <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FFEBEE] text-[#C62828]">
              <Lock size={22} />
            </div>
            <DialogTitle className="font-display text-[15px] font-bold text-[#C62828]">
              Day is closed - Manager PIN required
            </DialogTitle>
            <DialogDescription className="text-[12px] leading-relaxed">
              {dayLock?.error}
              {dayLock?.zNo ? ` (Z ${dayLock.zNo})` : ""} The sale is parked in the offline queue - a Manager or Owner
              PIN overrides the lock and posts it.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={dayLock?.pin ?? ""}
            onChange={(e) => setDayLock((s) => (s ? { ...s, pin: e.target.value.replace(/\D/g, "") } : s))}
            onKeyDown={(e) => e.key === "Enter" && void retryDayLockSale()}
            placeholder="Manager or Owner PIN"
            aria-label="Manager override PIN"
            autoFocus
            className="h-11 rounded-xl text-center font-mono text-[16px] font-bold tracking-[0.4em]"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void cancelDayLockSale()}
              className="h-10 flex-1 rounded-xl border-[#DFE1E6] font-bold text-[#172B4D]"
            >
              Cancel sale
            </Button>
            <Button
              onClick={() => void retryDayLockSale()}
              disabled={!dayLock?.pin || dayLock?.busy}
              className="h-10 flex-1 rounded-xl bg-[#172B4D] font-bold text-white hover:bg-[#0F1E38]"
            >
              {dayLock?.busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Override &amp; retry
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* -- price check popup (auto-dismiss 4 s, never adds) ------ */}
      {pricePopup && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div
            key={pricePopup.at}
            className="df-point-pop w-full max-w-[400px] rounded-3xl border-2 border-[#00A84A] bg-white p-6 text-center shadow-2xl"
            role="status"
          >
            <p className="text-5xl">{pricePopup.emoji}</p>
            <h3 className="font-display mt-2 text-[19px] font-bold text-[#172B4D]">{pricePopup.name}</h3>
            {pricePopup.kg ? (
              <>
                <p className="mt-1 font-mono text-[14px] font-bold text-[#1B7A2E]">
                  {pricePopup.kg} kg x {KES(pricePopup.price)}/kg
                </p>
                <p className="font-display text-[30px] font-extrabold text-[#172B4D]">{kes(pricePopup.computed ?? 0)}</p>
              </>
            ) : (
              <p className="font-display mt-2 text-[34px] font-extrabold text-[#172B4D]">{KES(pricePopup.price)}</p>
            )}
            <p className="mt-1 text-[12px] text-[#6B778C]">
              per {pricePopup.unit}
              {pricePopup.stock != null ? ` • ${pricePopup.stock} in stock` : ""}
            </p>
            {canMargin && pricePopup.margin != null && (
              <p className="mt-2 inline-flex rounded-full border border-[#C8E6C9] bg-[#E8F5E9] px-2.5 py-1 text-[10px] font-bold text-[#1B7A2E]">
                Margin {pricePopup.margin}% (staff never see this)
              </p>
            )}
            <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.3em] text-[#6B778C]">Price check</p>
          </div>
        </div>
      )}

      {/* -- credit-sale blocked alert --------------------------- */}
      <AlertDialog open={!!blocked} onOpenChange={(o) => !o && setBlocked(null)}>
        <AlertDialogContent className="max-w-[460px] rounded-2xl border-[#FFCDD2]">
          <AlertDialogHeader>
            <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FFEBEE] text-[#FF5630]">
              <Ban size={22} />
            </div>
            <AlertDialogTitle className="font-display text-[#FF5630]">Credit Sale Blocked</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] font-medium text-[#172B4D]">
              {blocked?.reason}
            </AlertDialogDescription>
            <p className="text-[12px] text-[#6B778C]">
              Clear the block at Manager - record a debt payment on the Debts screen, then retry the sale.
            </p>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction className="rounded-xl bg-[#FF5630] font-bold text-white hover:bg-[#E14A28]">
              Understood
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* -- cash drawer / X & Z reports ------------------------- */}
      <TillDialog
        open={tillOpen}
        onOpenChange={setTillOpen}
        storeId={activeStoreId === "all" ? (useApp.getState().stores.find((s) => s.isMain)?.id ?? 1) : activeStoreId}
        storeName={activeStore?.name ?? "Thika Road (HQ)"}
        userName={user?.name ?? "Counter 1"}
      />

      {/* -- quick return at the till (F4) ----------------------- */}
      <PosQuickReturn open={quickReturnOpen} onOpenChange={setQuickReturnOpen} />
    </div>
  );
}

/* ---------------------------------------------------------------
   TillDialog - cash-drawer shift management (X & Z reports).

   X-Report: mid-shift snapshot. Drawer stays in, shift continues.
   Z-Report: end-of-shift close. Counted cash is reconciled against
   the expected drawer (opening float + cash sales) and the shift is
   locked with a variance figure - exactly like a real hardware till.
   --------------------------------------------------------------- */

interface TillSessionDto {
  id: number;
  storeId: number;
  openedBy: string;
  openingFloat: number;
  expectedCash: number | null;
  countedCash: number | null;
  variance: number | null;
  status: string;
  note: string | null;
  openedAt: string;
  closedAt: string | null;
}

interface TillReportDto {
  receipts: number;
  units: number;
  gross: number;
  discounts: number;
  vat: number;
  total: number;
  avgBasket: number;
  byMethod: Record<string, { total: number; count: number }>;
  cash: number;
  expectedCash: number;
  openingFloat: number;
  pointsRedeemed: number;
  pointsEarned: number;
  creditCount: number;
  creditTotal: number;
  recentSales: { id: number; receiptNo: string; total: number; paymentMethod: string; staffName: string; customer: string; createdAt: string }[];
}

function TillDialog({
  open,
  onOpenChange,
  storeId,
  storeName,
  userName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  storeId: number;
  storeName: string;
  userName: string;
}) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<TillSessionDto | null>(null);
  const [report, setReport] = useState<TillReportDto | null>(null);
  const [history, setHistory] = useState<TillSessionDto[]>([]);
  const [float, setFloat] = useState("5000");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zResult, setZResult] = useState<{ session: TillSessionDto; report: TillReportDto } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<{ session: TillSessionDto | null; report: TillReportDto | null; history: TillSessionDto[] }>(
        `/api/till?storeId=${storeId}`
      );
      setSession(d.session);
      setReport(d.report);
      setHistory(d.history ?? []);
    } catch (e) {
      toast({ title: "Could not load till", description: e instanceof Error ? e.message : "Try again" });
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    if (!open) return;
    // async boundary: the loader and the resets touch state, so run them off-tick
    const t = setTimeout(() => {
      setZResult(null);
      setClosing(false);
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [open, load]);

  const openTill = async () => {
    setBusy(true);
    try {
      await api.post("/api/till", { action: "open", storeId, openedBy: userName, openingFloat: Number(float) || 0 });
      toast({ title: "Till opened ✓", description: `${KES(Number(float) || 0)} float recorded - drawer unlocked.` });
      await load();
    } catch (e) {
      toast({ title: "Could not open till", description: e instanceof Error ? e.message : "Try again" });
    } finally {
      setBusy(false);
    }
  };

  const xReport = async () => {
    setBusy(true);
    try {
      await api.post("/api/till", { action: "x-report", storeId });
      toast({ title: "X-Report printed ✓", description: "Mid-shift snapshot - drawer stays open." });
    } catch (e) {
      toast({ title: "X-Report failed", description: e instanceof Error ? e.message : "Try again" });
    } finally {
      setBusy(false);
    }
  };

  const closeTill = async () => {
    setBusy(true);
    try {
      const d = await api.post<{ ok: boolean; type: string; session: TillSessionDto; report: TillReportDto }>("/api/till", {
        action: "close",
        storeId,
        countedCash: Number(counted) || 0,
        note,
      });
      setZResult({ session: d.session, report: d.report });
      toast({
        title: "Z-Report - shift closed",
        description:
          d.session.variance === 0
            ? "Drawer balanced to the shilling. Asante!"
            : `Variance ${d.session.variance! > 0 ? "+" : ""}${KES(d.session.variance ?? 0)}`,
      });
      await load();
    } catch (e) {
      toast({ title: "Could not close till", description: e instanceof Error ? e.message : "Try again" });
    } finally {
      setBusy(false);
    }
  };

  const variancePreview = session && counted !== "" ? (Number(counted) || 0) - (report?.expectedCash ?? 0) : null;
  const methodRows = report
    ? Object.entries(report.byMethod).sort((a, b) => b[1].total - a[1].total)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-[520px] df-scroll">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2 text-[16px] text-[#172B4D]">
            <Landmark size={16} className="text-[#0052CC]" /> Cash Drawer - {storeName}
          </DialogTitle>
          <DialogDescription>
            {zResult
              ? `Shift #${zResult.session.id} closed at ${zResult.session.closedAt ? new Date(zResult.session.closedAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : ""} - drawer locked.`
              : session
                ? `Shift open since ${new Date(session.openedAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })} by ${session.openedBy}`
                : "No open shift - open the till to start selling on this drawer."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2 py-4">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : zResult ? (
          /* -- Z-Report result -- */
          <div className="space-y-3">
            <div
              className={cn(
                "rounded-2xl border p-4 text-center",
                Math.abs(zResult.session.variance ?? 0) < 1 ? "border-[#C8E6C9] bg-[#E8F5E9]" : "border-[#FFE0B2] bg-[#FFF8E1]"
              )}
            >
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#6B778C]">Z-Report • Shift #{zResult.session.id}</p>
              <p className={cn("font-display mt-1 text-3xl font-extrabold tabular-nums", Math.abs(zResult.session.variance ?? 0) < 1 ? "text-[#00C853]" : "text-[#D04A1E]")}>
                {zResult.session.variance === 0 ? "Balanced" : `${(zResult.session.variance ?? 0) > 0 ? "+" : ""}${KES(zResult.session.variance ?? 0)}`}
              </p>
              <p className="text-[11px] text-[#6B778C]">
                Counted {KES(zResult.session.countedCash ?? 0)} vs expected {KES(zResult.session.expectedCash ?? 0)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div className="rounded-xl border border-[#DFE1E6] p-3">
                <p className="text-[10px] font-bold uppercase text-[#6B778C]">Shift takings</p>
                <p className="font-display text-lg font-bold tabular-nums text-[#172B4D]">{KES(zResult.report.total)}</p>
                <p className="text-[11px] text-[#6B778C]">{zResult.report.receipts} receipts • {Math.round(zResult.report.units)} units</p>
              </div>
              <div className="rounded-xl border border-[#DFE1E6] p-3">
                <p className="text-[10px] font-bold uppercase text-[#6B778C]">Banking (cash)</p>
                <p className="font-display text-lg font-bold tabular-nums text-[#00C853]">{KES(zResult.report.cash)}</p>
                <p className="text-[11px] text-[#6B778C]">Float {KES(zResult.report.openingFloat)} returned</p>
              </div>
            </div>
            {zResult.session.note && <p className="rounded-xl bg-[#F4F5F7] p-3 text-[12px] text-[#6B778C]">📝 {zResult.session.note}</p>}
            <Button onClick={() => setZResult(null)} className="h-9 w-full rounded-xl bg-[#0052CC] font-bold text-white hover:bg-[#0041A8]">
              Back to till
            </Button>
          </div>
        ) : !session ? (
          /* -- open till flow -- */
          <div className="space-y-4">
            <div className="rounded-2xl border border-[#DFE1E6] bg-[#FAFBFC] p-4">
              <Label className="text-[12px] font-semibold text-[#172B4D]">Opening float (cash in drawer)</Label>
              <Input
                inputMode="numeric"
                value={float}
                onChange={(e) => setFloat(e.target.value.replace(/[^0-9]/g, ""))}
                className="mt-2 h-11 rounded-xl text-right font-display text-lg font-bold tabular-nums"
                placeholder="0"
                aria-label="Opening float amount"
              />
              <p className="mt-2 text-[11px] text-[#6B778C]">
                Typical float: KES 2,000-5,000 in KES 50/100/200 notes for change-making.
              </p>
            </div>
            <Button
              onClick={openTill}
              disabled={busy}
              className="h-11 w-full rounded-xl bg-[#00C853] font-display font-bold text-white hover:bg-[#00A84A]"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Landmark size={15} />} Open till & start shift
            </Button>
          </div>
        ) : (
          /* -- live shift -- */
          <div className="space-y-3">
            {/* expected drawer hero */}
            <div className="rounded-2xl bg-gradient-to-br from-[#172B4D] to-[#0E1B33] p-4 text-white">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Expected cash in drawer</p>
                  <p className="font-display mt-0.5 text-3xl font-extrabold tabular-nums">{KES(report?.expectedCash ?? 0)}</p>
                  <p className="text-[11px] text-white/60">Float {KES(report?.openingFloat ?? 0)} + cash sales {KES(report?.cash ?? 0)}</p>
                </div>
                <span className="rounded-full bg-[#00C853]/20 px-2.5 py-1 text-[10px] font-bold text-[#7CFFB2]">● OPEN</span>
              </div>
            </div>

            {/* takings grid */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-[#DFE1E6] p-2.5 text-center">
                <p className="font-display text-[15px] font-extrabold tabular-nums text-[#172B4D]">{report?.receipts ?? 0}</p>
                <p className="text-[10px] font-semibold text-[#6B778C]">Receipts</p>
              </div>
              <div className="rounded-xl border border-[#DFE1E6] p-2.5 text-center">
                <p className="font-display text-[15px] font-extrabold tabular-nums text-[#172B4D]">{Math.round(report?.units ?? 0)}</p>
                <p className="text-[10px] font-semibold text-[#6B778C]">Units sold</p>
              </div>
              <div className="rounded-xl border border-[#DFE1E6] p-2.5 text-center">
                <p className="font-display text-[15px] font-extrabold tabular-nums text-[#172B4D]">{KES(report?.avgBasket ?? 0)}</p>
                <p className="text-[10px] font-semibold text-[#6B778C]">Avg basket</p>
              </div>
            </div>

            {/* payment split */}
            <div className="rounded-xl border border-[#DFE1E6] p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Payment split</p>
              {methodRows.length === 0 ? (
                <p className="py-2 text-center text-[12px] text-[#6B778C]">No sales yet this shift.</p>
              ) : (
                <div className="space-y-1.5">
                  {methodRows.map(([m, v]) => (
                    <div key={m} className="flex items-center justify-between text-[12px]">
                      <span className="font-semibold text-[#172B4D]">{m}</span>
                      <span className="text-[#6B778C]">×{v.count}</span>
                      <span className="font-mono tabular-nums font-bold text-[#172B4D]">{KES(v.total)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-[#DFE1E6] pt-1.5 text-[12px]">
                    <span className="font-bold text-[#172B4D]">Total takings</span>
                    <span className="font-mono tabular-nums font-extrabold text-[#0052CC]">{KES(report?.total ?? 0)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* close flow */}
            {closing ? (
              <div className="space-y-3 rounded-2xl border border-[#FFE0B2] bg-[#FFF8E1] p-4">
                <p className="text-[12px] font-bold text-[#8D6708]">Count the physical cash in the drawer, then enter it below.</p>
                <Input
                  inputMode="numeric"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value.replace(/[^0-9]/g, ""))}
                  className="h-11 rounded-xl text-right font-display text-lg font-bold tabular-nums"
                  placeholder="Counted cash"
                  aria-label="Counted cash amount"
                  autoFocus
                />
                {variancePreview !== null && (
                  <p className={cn("text-center text-[13px] font-bold tabular-nums", variancePreview === 0 ? "text-[#00C853]" : "text-[#D04A1E]")}>
                    {variancePreview === 0 ? "✓ Balanced" : `Variance: ${variancePreview > 0 ? "+" : ""}${KES(variancePreview)}`}
                  </p>
                )}
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="rounded-xl text-[12px]"
                  placeholder="Note (optional) - e.g. KES 200 given as change to neighbour shop"
                  aria-label="Shift note"
                />
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setClosing(false)} className="h-9 flex-1 rounded-xl border-[#DFE1E6] font-bold text-[#172B4D]">
                    Cancel
                  </Button>
                  <Button onClick={closeTill} disabled={busy || counted === ""} className="h-9 flex-1 rounded-xl bg-[#FF5630] font-bold text-white hover:bg-[#E14A28]">
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Close & print Z
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" onClick={xReport} disabled={busy} className="h-10 flex-1 rounded-xl border-[#DFE1E6] font-bold text-[#172B4D]">
                  <Printer size={14} /> X-Report
                </Button>
                <Button onClick={() => setClosing(true)} className="h-10 flex-1 rounded-xl bg-[#172B4D] font-bold text-white hover:bg-[#0E1B33]">
                  <Lock size={14} /> Close till
                </Button>
              </div>
            )}
          </div>
        )}

        {/* recent closed shifts */}
        {history.length > 0 && !zResult && (
          <div className="rounded-xl border border-[#DFE1E6] p-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">Recent closed shifts</p>
            <div className="space-y-1.5">
              {history.slice(0, 4).map((h) => (
                <div key={h.id} className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-[#172B4D]">
                    #{h.id} • {h.openedBy.split(" ")[0]} • {h.closedAt ? new Date(h.closedAt).toLocaleDateString("en-KE", { day: "numeric", month: "short" }) : ""}
                  </span>
                  <span className={cn("font-mono font-bold tabular-nums", Math.abs(h.variance ?? 0) < 1 ? "text-[#00C853]" : "text-[#D04A1E]")}>
                    {Math.abs(h.variance ?? 0) < 1 ? "Balanced" : `${(h.variance ?? 0) > 0 ? "+" : ""}${KES(h.variance ?? 0)}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
