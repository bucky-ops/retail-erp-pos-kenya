"use client";

/**
 * Login screen — split marketing/auth card.
 * Staff PIN keypad (auto-submits at 4 digits, shake on error) or Owner PIN login,
 * then a store-select modal that sets activeStoreId and calls onLogin.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Delete,
  Info,
  Loader2,
  Lock,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
  Store as StoreIcon,
  WifiOff,
} from "lucide-react";
import { api } from "@/lib/api";
import { useApp, useSync, type AuthUser } from "@/lib/store";
import { type StoreDto } from "@/types";
import { Logo } from "@/components/df/logo";
import { Panel } from "@/components/df/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface LoginResponse {
  ok: boolean;
  user: AuthUser;
}

interface StaffChip {
  id: number;
  name: string;
  role: string;
  color: string;
}

const FALLBACK_STAFF: StaffChip[] = [
  { id: 1, name: "Mary Wanjiku", role: "Cashier", color: "#0052CC" },
  { id: 2, name: "James Otieno", role: "Store Keeper", color: "#00C853" },
  { id: 3, name: "Grace Akinyi", role: "Sales", color: "#FF5630" },
];

const FALLBACK_STORES: StoreDto[] = [
  { id: 1, name: "Thika Road", location: "Nairobi", isMain: true },
  { id: 2, name: "Kiambu Road", location: "Kiambu", isMain: false },
];

const SHELF_EMOJIS = ["🧱", "🎨", "🚿", "🔨"];
const BAR_STRIP = ["#0052CC", "#00C853", "#0052CC", "#00C853"];

const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export default function LoginScreen({
  onLogin,
  embedded,
}: {
  onLogin?: (user: AuthUser) => void;
  embedded?: boolean;
}) {
  const staff = useApp((s) => s.staff);
  const stores = useApp((s) => s.stores);
  const online = useSync((s) => s.online);

  const [tab, setTab] = useState<string>("staff");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [pin, setPin] = useState("");
  const [ownerPin, setOwnerPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [authed, setAuthed] = useState<AuthUser | null>(null);

  const staffList: StaffChip[] =
    staff.length > 0
      ? staff.filter((s) => s.role !== "Owner").map((s) => ({ id: s.id, name: s.name, role: s.role, color: s.color }))
      : FALLBACK_STAFF;
  const storeList: StoreDto[] = stores.length > 0 ? stores : FALLBACK_STORES;

  const submitPin = useCallback(async (value: string, role?: "owner") => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<LoginResponse>("/api/auth/login", role ? { pin: value, role } : { pin: value });
      setAuthed(res.user);
      setPin("");
      setOwnerPin("");
      toast({
        title: `Karibu, ${res.user.name}`,
        description: `${res.user.role} — pick a store to start operating`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed. Try again.");
      setShake((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }, []);

  /* auto-submit staff PIN at 4 digits */
  useEffect(() => {
    if (tab === "staff" && pin.length === 4 && !busy && !authed) void submitPin(pin);
  }, [pin, tab, busy, authed, submitPin]);

  const press = (digit: string) => {
    setError(null);
    setPin((p) => (p.length < 4 ? p + digit : p));
  };

  const completeLogin = (storeId: number | "all") => {
    if (!authed) return;
    const store = storeList.find((s) => s.id === storeId);
    useApp.getState().setActiveStoreId(storeId);
    onLogin?.({ ...authed, storeName: store?.name ?? authed.storeName });
    setAuthed(null);
  };

  const card = (
    <div
      className={cn(
        "grid w-full max-w-[980px] grid-cols-1 overflow-hidden rounded-3xl bg-white md:grid-cols-2",
        !embedded && "border border-[#DFE1E6] shadow-2xl"
      )}
    >
      {/* ── Left: marketing panel ─────────────────────────── */}
      <div className="relative hidden flex-col overflow-hidden bg-gradient-to-br from-[#172B4D] via-[#142748] to-[#0E1B33] p-8 text-white md:flex md:p-10">
        {/* ambient animated blobs */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full opacity-25 blur-3xl df-blob-a"
          style={{ background: "radial-gradient(circle, #0052CC 0%, transparent 70%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-28 -right-16 h-80 w-80 rounded-full opacity-20 blur-3xl df-blob-b"
          style={{ background: "radial-gradient(circle, #00C853 0%, transparent 70%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/3 top-1/2 h-48 w-48 rounded-full opacity-15 blur-3xl df-blob-a"
          style={{ background: "radial-gradient(circle, #FF5630 0%, transparent 70%)", animationDelay: "-6s" }}
        />
        <div className="absolute -right-20 -top-20 h-[280px] w-[280px] rounded-full bg-[#0052CC]/30 blur-[30px]" />
        <div className="absolute -bottom-24 -left-16 h-[220px] w-[220px] rounded-full bg-[#00C853]/10 blur-[30px]" />

        <Logo variant="white" size={30} className="relative" />

        <h2 className="font-display relative mt-10 text-[30px] font-bold leading-[1.12]">
          Karibu.
          <br />
          Sell Smart.
          <br />
          Stock Smart.
        </h2>
        <p className="relative mt-3 text-sm text-white/70">
          {"Kenya's smart retail ERP + POS — KRA eTIMS & M-Pesa native."}
        </p>

        {/* duka shelf illustration */}
        <div className="relative mt-9 rounded-[20px] border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex gap-1">
            {BAR_STRIP.map((c, i) => (
              <div key={i} className="h-3 w-10 rounded" style={{ background: c }} />
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {SHELF_EMOJIS.map((e) => (
              <div key={e} className="flex h-[56px] items-center justify-center rounded-xl bg-white/10 text-lg">
                {e}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-white/60">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#00C853]" />
            Thika Road • Live Sales 24
          </div>
        </div>

        <div className="relative mt-8 space-y-2.5 text-[13px]">
          <div className="flex items-center gap-2.5">
            <RefreshCcw size={16} className="shrink-0 text-[#00C853]" />
            Offline-first POS that never stops selling
          </div>
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={16} className="shrink-0 text-[#00C853]" />
            KRA eTIMS compliant receipts in one tap
          </div>
          <div className="flex items-center gap-2.5">
            <Smartphone size={16} className="shrink-0 text-[#00C853]" />
            M-Pesa, Loyalty &amp; Debt control in one place
          </div>
        </div>
      </div>

      {/* ── Right: auth panel ─────────────────────────────── */}
      <div className="relative flex flex-col p-6 md:p-10">
        <div className="mb-6 md:hidden">
          <Logo size={22} />
        </div>

        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v);
            setError(null);
          }}
        >
          <TabsList className="h-auto w-fit rounded-full bg-[#F4F5F7] p-1">
            <TabsTrigger
              value="staff"
              className="rounded-full px-5 py-2 text-sm font-semibold text-[#6B778C] data-[state=active]:bg-white data-[state=active]:text-[#172B4D] data-[state=active]:shadow-sm"
            >
              Staff PIN
            </TabsTrigger>
            <TabsTrigger
              value="owner"
              className="rounded-full px-5 py-2 text-sm font-semibold text-[#6B778C] data-[state=active]:bg-white data-[state=active]:text-[#172B4D] data-[state=active]:shadow-sm"
            >
              Owner login
            </TabsTrigger>
          </TabsList>

          {/* Staff PIN */}
          <TabsContent value="staff" className="mt-7">
            <div className="flex flex-wrap gap-2">
              {staffList.map((s, i) => (
                <button
                  key={`${s.id}-${s.name}`}
                  type="button"
                  onClick={() => {
                    setSelectedIdx(i);
                    setPin("");
                    setError(null);
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition",
                    selectedIdx === i
                      ? "border-[#0052CC] bg-[#E3F2FD] text-[#172B4D]"
                      : "border-[#DFE1E6] bg-white text-[#6B778C] hover:border-[#0052CC]/40"
                  )}
                >
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ background: s.color }}
                  >
                    {initials(s.name)}
                  </span>
                  {s.name}
                </button>
              ))}
            </div>

            <p className="mt-6 text-sm font-semibold text-[#172B4D]">Enter 4-digit PIN</p>
            <div key={shake} className={cn("mt-3 flex gap-2", shake > 0 && "df-pin-shake")}>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={cn(
                    "flex h-14 w-12 items-center justify-center rounded-xl border-2 text-xl font-bold transition",
                    i < pin.length
                      ? "border-[#0052CC] bg-[#E3F2FD] text-[#0052CC]"
                      : "border-[#DFE1E6] bg-[#FAFBFC]"
                  )}
                >
                  {i < pin.length ? "•" : ""}
                </div>
              ))}
            </div>
            {error && <p className="mt-2 text-[12px] font-semibold text-[#FF5630]">{error}</p>}

            {/* keypad */}
            <div className="mt-6 grid max-w-[300px] grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={busy}
                  onClick={() => press(d)}
                  className="h-14 rounded-xl border border-[#DFE1E6] bg-[#F4F5F7] text-lg font-bold text-[#172B4D] transition hover:bg-white disabled:opacity-50"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setPin("");
                  setError(null);
                }}
                className="h-14 rounded-xl border border-[#FFCDD2] bg-[#FFF0F0] text-lg font-bold text-[#FF5630] transition hover:bg-[#FFE3E0]"
              >
                C
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => press("0")}
                className="h-14 rounded-xl border border-[#DFE1E6] bg-[#F4F5F7] text-lg font-bold text-[#172B4D] transition hover:bg-white disabled:opacity-50"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => setPin((p) => p.slice(0, -1))}
                aria-label="Backspace"
                className="flex h-14 items-center justify-center rounded-xl border border-[#DFE1E6] bg-[#F4F5F7] text-[#172B4D] transition hover:bg-white"
              >
                <Delete size={18} />
              </button>
            </div>

            <Button
              type="button"
              disabled={busy || pin.length === 0}
              onClick={() => void submitPin(pin)}
              className="mt-6 h-12 w-full max-w-[300px] rounded-xl bg-[#0052CC] font-semibold text-white hover:bg-[#0041A8]"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
              Login with PIN
            </Button>
          </TabsContent>

          {/* Owner login */}
          <TabsContent value="owner" className="mt-7">
            <div className="max-w-[360px] space-y-4">
              <div>
                <label htmlFor="owner-pin" className="text-[12px] font-semibold text-[#172B4D]">
                  Owner PIN
                </label>
                <div className="mt-1 flex h-11 items-center gap-2 rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-3">
                  <Lock size={16} className="shrink-0 text-[#6B778C]" />
                  <Input
                    id="owner-pin"
                    value={ownerPin}
                    onChange={(e) => {
                      setOwnerPin(e.target.value.replace(/\D/g, "").slice(0, 4));
                      setError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && ownerPin.length === 4 && !busy) void submitPin(ownerPin, "owner");
                    }}
                    placeholder="••••"
                    inputMode="numeric"
                    autoComplete="off"
                    className="h-8 border-0 bg-transparent px-0 text-lg font-bold tracking-[0.5em] shadow-none focus-visible:ring-0"
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-[#6B778C]">Owner PIN 0000 — unlocks dashboards, payroll &amp; settings</p>
              </div>
              {error && <p className="text-[12px] font-semibold text-[#FF5630]">{error}</p>}
              <Button
                type="button"
                disabled={busy || ownerPin.length !== 4}
                onClick={() => void submitPin(ownerPin, "owner")}
                className="h-11 w-full rounded-xl bg-[#0052CC] font-semibold text-white hover:bg-[#0041A8]"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                Sign In
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {/* demo hint */}
        <div className="mt-auto flex items-start gap-2 rounded-xl border border-[#DFE1E6] bg-[#F4F5F7] p-3 pt-3 text-[11px] leading-relaxed text-[#6B778C]">
          <Info size={14} className="mt-0.5 shrink-0 text-[#0052CC]" />
          <span>
            Demo PINs: <b className="text-[#172B4D]">Cashier 1234</b> • James 2345 • Grace 3456 •{" "}
            <b className="text-[#172B4D]">Owner 0000</b>
          </span>
        </div>

        {!online && (
          <div className="mt-3 flex w-fit items-center gap-2 rounded-full border border-[#FFE0B2] bg-[#FFF8E1] px-3 py-1.5 text-[11px] font-bold text-[#B8860B]">
            <WifiOff size={12} /> Offline — POS will queue sales
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* local animation (shake on wrong PIN) — kept self-contained in this file */}
      <style>{`
        @keyframes df-pin-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-7px); }
          40% { transform: translateX(7px); }
          60% { transform: translateX(-5px); }
          80% { transform: translateX(5px); }
        }
        .df-pin-shake { animation: df-pin-shake 0.45s ease both; }
      `}</style>

      {embedded ? (
        <Panel padding={false} className="mx-auto w-full max-w-[980px] overflow-hidden rounded-3xl">
          {card}
        </Panel>
      ) : (
        <div className="flex min-h-screen items-center justify-center bg-[#172B4D] p-4">{card}</div>
      )}

      {/* store-select modal */}
      {authed && (
        <div className="df-fade-in fixed inset-0 z-50 flex items-center justify-center bg-[#172B4D]/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[560px] rounded-[20px] border border-[#DFE1E6] bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-2">
              <StoreIcon size={18} className="text-[#0052CC]" />
              <h3 className="font-display text-lg font-bold text-[#172B4D]">Select Store</h3>
            </div>
            <p className="mt-1 text-sm text-[#6B778C]">Choose which store to operate in. You can switch anytime.</p>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {storeList.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => completeLogin(s.id)}
                  className={cn(
                    "rounded-2xl border-2 p-4 text-left transition",
                    i === 0
                      ? "border-[#0052CC] bg-[#E3F2FD] hover:bg-[#D6EBFF]"
                      : "border-[#DFE1E6] bg-white hover:border-[#0052CC]/40"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xl">{s.isMain ? "🏬" : "🏪"}</span>
                    {i === 0 && (
                      <span className="rounded-full bg-[#0052CC] px-2 py-1 text-[10px] font-bold text-white">Active</span>
                    )}
                  </div>
                  <p className="mt-3 font-bold text-[#172B4D]">{s.name}</p>
                  <p className="text-[12px] text-[#6B778C]">
                    {s.location} • {s.isMain ? "Flagship store" : "Branch"}
                  </p>
                  <p className="mt-1 text-[12px] font-bold text-[#00C853]">Tap to operate here</p>
                </button>
              ))}
            </div>

            <Button
              variant="outline"
              onClick={() => completeLogin("all")}
              className="mt-4 w-full rounded-xl border-[#DFE1E6] bg-white font-semibold text-[#172B4D]"
            >
              Skip — operate across All Stores
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
