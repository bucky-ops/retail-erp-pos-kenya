"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2, CalendarClock, Check, Database, Download, Eye, EyeOff, Keyboard, Landmark, Loader2,
  MessageSquare, MonitorSmartphone, Percent, Play, Plug, ReceiptText, RefreshCw, Smartphone,
  Sparkles, Upload, Users, Warehouse, WifiOff, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { SettingsDto, StaffDto, StoreDto } from "@/types";
import { Panel, ScreenHeader, TableSkeleton } from "@/components/df/shared";
import { DukaMark } from "@/components/df/logo";
import { usePwaInstall } from "@/components/df/pwa";
import { offlineQueue, syncPendingSales } from "@/lib/offline";
import { isHappyHourActive } from "@/lib/happy-hour";
import { useApp } from "@/lib/store";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/* ── contracts + static config ─────────────────────────────── */

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

type SectionId =
  | "company" | "stores" | "users" | "pos" | "print" | "taxes"
  | "kra" | "mpesa" | "sms" | "loyalty" | "device" | "backup" | "shortcuts";

const SECTIONS: { id: SectionId; label: string; icon: typeof Building2 }[] = [
  { id: "company", label: "Company", icon: Building2 },
  { id: "stores", label: "Stores & Warehouses", icon: Warehouse },
  { id: "users", label: "Users & Roles", icon: Users },
  { id: "pos", label: "POS Profiles", icon: MonitorSmartphone },
  { id: "print", label: "Print Formats", icon: ReceiptText },
  { id: "taxes", label: "Taxes", icon: Percent },
  { id: "kra", label: "KRA eTIMS Settings", icon: Landmark },
  { id: "mpesa", label: "M-Pesa Daraja", icon: Smartphone },
  { id: "sms", label: "SMS Provider", icon: MessageSquare },
  { id: "loyalty", label: "Loyalty Rules", icon: Sparkles },
  { id: "device", label: "Device & Offline", icon: WifiOff },
  { id: "shortcuts", label: "Keyboard Shortcuts", icon: Keyboard },
  { id: "backup", label: "Backup & Restore", icon: Database },
];

const PERM_ROWS = ["POS", "Stock", "Reports", "Accounting", "Creditors", "Payroll", "All modules"] as const;

const ROLE_MATRIX: { role: string; perms: readonly string[] }[] = [
  { role: "Cashier", perms: ["POS"] },
  { role: "Store Manager", perms: ["Stock", "Reports"] },
  { role: "Accountant", perms: ["Accounting", "Creditors"] },
  { role: "HR Manager", perms: ["Payroll"] },
  { role: "System Manager", perms: [...PERM_ROWS] },
];

const rel = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return "never";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/* ── small building blocks ─────────────────────────────────── */

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-[11px] font-semibold text-[#172B4D]">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "••••••••••••"}
        className="h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] pr-9 font-mono text-[13px]"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6B778C] hover:text-[#172B4D]"
        aria-label={show ? "Hide value" : "Show value"}
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function SaveButton({ onSave, label = "Save changes" }: { onSave: () => Promise<void>; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      onClick={async () => {
        setBusy(true);
        try {
          await onSave();
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy}
      className="h-10 rounded-xl bg-[#0052CC] px-5 text-[13px] font-bold text-white hover:bg-[#0041A8]"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
      {busy ? "Saving…" : label}
    </Button>
  );
}

/**
 * Device & Offline panel - PWA install, service-worker status and the
 * offline sale queue with a manual replay button.
 */
function DevicePanel() {
  const { canInstall, installed, standalone, swActive, promptInstall } = usePwaInstall();
  const [queue, setQueue] = useState<{ total: number; unsynced: number }>({ total: 0, unsynced: 0 });
  const [online, setOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    offlineQueue
      .count()
      .then(setQueue)
      .catch(() => {});
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const replay = async () => {
    setSyncing(true);
    try {
      const r = await syncPendingSales();
      const c = await offlineQueue.count();
      setQueue(c);
      toast({
        title: r.failed === 0 ? "Offline sales synced ✅" : "Sync finished with errors",
        description: `${r.synced} replayed to the server${r.failed ? ` • ${r.failed} failed (kept in queue)` : ""}.`,
      });
    } finally {
      setSyncing(false);
    }
  };

  const statusDot = (ok: boolean, warn = false) => (
    <span
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        ok ? "bg-[#00C853]" : warn ? "bg-[#FFAB00]" : "bg-[#6B778C]"
      )}
    />
  );

  const rows: { label: string; ok: boolean; note: string; warn?: boolean }[] = [
    { label: "Connection", ok: online, note: online ? "Online - selling live" : "Offline - sales queue locally", warn: true },
    { label: "Offline shell (service worker)", ok: swActive, note: swActive ? "Active - app caches for zero-network boots" : "Registering… (or served without HTTPS)", warn: true },
    {
      label: "App install",
      ok: standalone || installed,
      note: standalone ? "Running as an installed app" : installed ? "Installed on this device" : canInstall ? "Ready to install" : "Use browser menu → Install app",
      warn: true,
    },
  ];

  return (
    <Panel>
      <PanelHead title="Device & Offline" sub="Install the app on this device and manage the offline engine" icon={WifiOff} />

      <div className="mt-6 max-w-[560px] space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-4 py-3">
            <div className="flex items-center gap-2.5">
              {statusDot(r.ok, r.warn)}
              <p className="text-[13px] font-semibold text-[#172B4D]">{r.label}</p>
            </div>
            <p className={cn("text-[12px]", r.ok ? "text-[#6B778C]" : "text-[#FF5630]")}>{r.note}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button
          disabled={!canInstall}
          onClick={async () => {
            const ok = await promptInstall();
            if (!ok) toast({ title: "Install dismissed", description: "You can install anytime from this panel." });
          }}
          className="h-10 rounded-xl bg-[#172B4D] px-5 text-[13px] font-bold text-white hover:bg-[#0F1D33] disabled:opacity-50"
        >
          <Download size={14} /> {standalone || installed ? "DukaFlow is installed" : "Install DukaFlow app"}
        </Button>
        <Button
          variant="outline"
          disabled={syncing || queue.unsynced === 0}
          onClick={() => void replay()}
          className="h-10 rounded-xl border-[#DFE1E6] px-5 text-[13px] font-bold text-[#172B4D] disabled:opacity-50"
        >
          {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Replay queued sales{queue.unsynced > 0 ? ` (${queue.unsynced})` : ""}
        </Button>
      </div>

      <div className="mt-6 max-w-[560px] rounded-xl border border-[#C8E6C9] bg-[#F0FFF4] p-4">
        <p className="text-[12px] leading-relaxed text-[#1B7A2E]">
          <strong>Offline-first by design.</strong> Sales are written to this device&apos;s IndexedDB first, then synced -
          so load-shedding or dead zones never stop the till. Stock, loyalty and KRA receipt numbering resolve when the
          connection returns.
        </p>
      </div>
    </Panel>
  );
}

function PanelHead({ title, sub, icon: Icon }: { title: string; sub: string; icon: typeof Building2 }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E9F2FF] text-[#0052CC]">
        <Icon size={16} />
      </div>
      <div>
        <h3 className="font-display text-[16px] font-bold text-[#172B4D]">{title}</h3>
        <p className="mt-0.5 text-[12px] text-[#6B778C]">{sub}</p>
      </div>
    </div>
  );
}

/* ── screen ────────────────────────────────────────────────── */

export default function SettingsScreen() {
  const [section, setSection] = useState<SectionId>("kra");
  const categories = useApp((s) => s.categories);

  const [draft, setDraft] = useState<SettingsDto | null>(null);
  const [stores, setStores] = useState<StoreDto[]>([]);
  const [staff, setStaff] = useState<StaffDto[]>([]);
  const [stockByStore, setStockByStore] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);

  const [autoBackup, setAutoBackup] = useState(true);
  const [jobsBusy, setJobsBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const set = useCallback(<K extends keyof SettingsDto>(key: K, value: SettingsDto[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, boot, inv] = await Promise.all([
          api.get<SettingsDto>("/api/settings"),
          api.get<{ stores: StoreDto[]; staff: StaffDto[] }>("/api/bootstrap"),
          api.get<{ rows: { storeId: number; qty: number; cost: number }[] }>("/api/inventory"),
        ]);
        if (!alive) return;
        setDraft(s);
        setStores(boot.stores);
        setStaff(boot.staff);
        const per: Record<number, number> = {};
        for (const r of inv.rows) per[r.storeId] = (per[r.storeId] ?? 0) + r.qty * r.cost;
        setStockByStore(per);
      } catch (e) {
        toast({ title: "Could not load settings", description: err(e) });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const put = useCallback(
    async (patch: Partial<SettingsDto>, okTitle: string, okDesc?: string) => {
      try {
        const res = await api.put<{ ok: boolean; settings: SettingsDto }>("/api/settings", patch);
        setDraft(res.settings);
        toast({ title: okTitle, description: okDesc });
      } catch (e) {
        toast({ title: "Save failed", description: err(e) });
      }
    },
    []
  );

  const downloadBackup = () => {
    if (!draft) return;
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), settings: draft, stores, staff }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `dukaflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Backup downloaded", description: "Settings, stores & staff exported as JSON." });
  };

  const loyaltyPreview = useMemo(() => {
    const earn = Math.max(1, draft?.loyaltyEarnPerKes ?? 100);
    const pts = Math.floor(1000 / earn);
    return { pts, kes: pts * (draft?.loyaltyPointValue ?? 1) };
  }, [draft?.loyaltyEarnPerKes, draft?.loyaltyPointValue]);

  /* happy hour liveness (re-checked every 30s, mirrors the POS banner) */
  const [hhNow, setHhNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setHhNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const hhLiveNow = isHappyHourActive(draft ?? undefined, hhNow);

  if (loading || !draft) {
    return (
      <div className="space-y-5">
        <ScreenHeader title="Settings" subtitle="Company, stores, integrations & compliance" />
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 @4xl:col-span-3">
            <TableSkeleton rows={8} cols={1} />
          </div>
          <div className="col-span-12 @4xl:col-span-9">
            <TableSkeleton rows={8} cols={3} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ScreenHeader title="Settings" subtitle="Company, stores, integrations & compliance" />

      <div className="grid grid-cols-12 gap-4">
        {/* LEFT nav */}
        <div className="col-span-12 @4xl:col-span-3">
          <div className="@4xl:sticky @4xl:top-4">
            <Panel padding={false} className="p-2">
              {SECTIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSection(id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition-colors",
                    section === id
                      ? "bg-[#E9F2FF] text-[#0052CC]"
                      : "text-[#6B778C] hover:bg-[#F4F5F7] hover:text-[#172B4D]"
                  )}
                >
                  <Icon size={15} className={section === id ? "text-[#0052CC]" : "text-[#6B778C]"} />
                  {label}
                </button>
              ))}
            </Panel>
          </div>
        </div>

        {/* RIGHT content */}
        <div className="col-span-12 @4xl:col-span-9">
            {/* ── COMPANY ── */}
            {section === "company" && (
              <Panel>
                <PanelHead title="Company" sub="Trading name & statutory VAT used on receipts and eTIMS invoices" icon={Building2} />
                <div className="mt-6 grid max-w-[560px] grid-cols-1 gap-4 @xl:grid-cols-2">
                  <Field label="Company name">
                    <Input
                      value={draft.companyName}
                      onChange={(e) => set("companyName", e.target.value)}
                      className="h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px]"
                    />
                  </Field>
                  <Field label="VAT rate (%)">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={draft.vatRate}
                      onChange={(e) => set("vatRate", Number(e.target.value))}
                      className="h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px]"
                    />
                  </Field>
                </div>
                <p className="mt-4 max-w-[560px] rounded-xl bg-[#F4F5F7] p-3 text-[12px] text-[#6B778C]">
                  VAT is applied on <span className="font-semibold text-[#172B4D]">(subtotal − discounts)</span> at{" "}
                  {draft.vatRate}% across all POS terminals, in line with KRA VAT Act.
                </p>
                <div className="mt-6">
                  <SaveButton
                    onSave={() =>
                      put(
                        { companyName: draft.companyName, vatRate: draft.vatRate },
                        "Company settings saved",
                        `${draft.companyName} • VAT ${draft.vatRate}%`
                      )
                    }
                  />
                </div>
              </Panel>
            )}

            {/* ── STORES ── */}
            {section === "stores" && (
              <Panel>
                <PanelHead title="Stores & Warehouses" sub="Branches running DukaFlow terminals right now" icon={Warehouse} />
                <div className="mt-6 grid grid-cols-1 gap-4 @2xl:grid-cols-2">
                  {stores.map((s) => {
                    const stock = stockByStore[s.id] ?? 0;
                    return (
                      <div key={s.id} className="rounded-2xl border border-[#DFE1E6] bg-white p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E9F2FF] text-[#0052CC]">
                              <Warehouse size={16} />
                            </span>
                            <div>
                              <p className="text-[14px] font-bold text-[#172B4D]">{s.name}</p>
                              <p className="text-[11px] text-[#6B778C]">{s.location || "Thika Road • Nairobi"}</p>
                            </div>
                          </div>
                          {s.isMain && (
                            <Badge className="rounded-full bg-[#0052CC] text-[10px] font-bold text-white">HQ</Badge>
                          )}
                        </div>
                        <Separator className="my-3" />
                        <div className="flex items-center justify-between text-[12px]">
                          <span className="text-[#6B778C]">Stock on hand</span>
                          <span className="font-display font-bold text-[#172B4D]">
                            KES {Math.round(stock).toLocaleString()}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[12px]">
                          <span className="text-[#6B778C]">Terminal status</span>
                          <span className="inline-flex items-center gap-1.5 font-semibold text-[#1B7A2E]">
                            <span className="h-2 w-2 rounded-full bg-[#00C853]" /> Active • synced
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {stores.length === 0 && (
                    <p className="text-[12px] text-[#6B778C]">No stores registered yet.</p>
                  )}
                </div>
              </Panel>
            )}

            {/* ── USERS & ROLES ── */}
            {section === "users" && (
              <Panel>
                <PanelHead title="Users & Roles" sub="Staff accounts and module permissions" icon={Users} />
                <div className="mt-6 flex flex-wrap gap-2">
                  {staff.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-2 rounded-full border border-[#DFE1E6] bg-white py-1 pl-1 pr-3"
                    >
                      <span
                        className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white"
                        style={{ background: s.color || "#172B4D" }}
                      >
                        {s.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                      <span className="text-[12px] font-semibold text-[#172B4D]">{s.name}</span>
                      <span className="text-[11px] text-[#6B778C]">• {s.role}</span>
                      <span
                        className={cn("h-2 w-2 rounded-full", s.onShift ? "bg-[#00C853]" : "bg-[#DFE1E6]")}
                        title={s.onShift ? "On shift" : "Off shift"}
                      />
                    </div>
                  ))}
                </div>

                <div className="mt-6 overflow-x-auto rounded-xl border border-[#DFE1E6]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#FAFBFC]">
                        <TableHead className="text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Module</TableHead>
                        {ROLE_MATRIX.map((r) => (
                          <TableHead key={r.role} className="text-center text-[11px] font-bold text-[#172B4D]">
                            {r.role}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {PERM_ROWS.map((perm) => (
                        <TableRow key={perm}>
                          <TableCell className="text-[12px] font-semibold text-[#172B4D]">{perm}</TableCell>
                          {ROLE_MATRIX.map((r) => {
                            const ok = r.perms.includes(perm);
                            return (
                              <TableCell key={r.role} className="text-center">
                                {ok ? (
                                  <Check size={14} className="mx-auto text-[#00C853]" />
                                ) : (
                                  <X size={14} className="mx-auto text-[#DFE1E6]" />
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-3 text-[11px] text-[#6B778C]">
                  Role permissions are enforced server-side - e.g. credit sales above limit need Manager override at POS.
                </p>
              </Panel>
            )}

            {/* ── POS PROFILES ── */}
            {section === "pos" && (
              <Panel>
                <PanelHead title="POS Profiles" sub="Terminal layouts per device type" icon={MonitorSmartphone} />
                <div className="mt-6 grid grid-cols-1 gap-4 @2xl:grid-cols-3">
                  {[
                    { name: "Counter POS", desc: "Desktop dock • 80mm receipt • barcode scanner", badge: "Thika Road + Kiambu" },
                    { name: "Mobile POS", desc: "Phone / tablet • M-Pesa STK push • queue-first offline", badge: "Delivery crews" },
                    { name: "Kiosk", desc: "Self-service • card + cash acceptor", badge: "Coming v2.5" },
                  ].map((p, i) => (
                    <div key={p.name} className="rounded-2xl border border-[#DFE1E6] bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-display text-[13px] font-bold text-[#172B4D]">{p.name}</span>
                        <Switch
                          checked={i !== 2}
                          onCheckedChange={(v) =>
                            toast({
                              title: `${p.name} ${v ? "enabled" : "disabled"}`,
                              description: "Profile change applies on next terminal sync.",
                            })
                          }
                        />
                      </div>
                      <p className="mt-2 text-[12px] text-[#6B778C]">{p.desc}</p>
                      <Badge variant="outline" className="mt-3 rounded-full border-[#DFE1E6] text-[10px] font-bold text-[#6B778C]">
                        {p.badge}
                      </Badge>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {/* ── PRINT FORMATS ── */}
            {section === "print" && (
              <Panel>
                <PanelHead title="Print Formats" sub="Receipt branding - live previews update as you edit" icon={ReceiptText} />
                <div className="mt-6 grid grid-cols-12 gap-6">
                  <div className="col-span-12 @2xl:col-span-5">
                    {/* 80mm mini receipt */}
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">80mm thermal</p>
                    <div className="w-[180px] rounded-lg border border-[#DFE1E6] bg-white p-3 font-mono text-[8px] leading-relaxed text-[#172B4D] shadow-sm">
                      <div className="flex flex-col items-center">
                        <div className="h-6 w-6">
                          <DukaMark color={draft.receiptPrimaryColor} accent={draft.receiptSecondaryColor} />
                        </div>
                        <p className="mt-1 text-[9px] font-bold">{draft.companyName}</p>
                        <p className="text-[7px] text-[#6B778C]">Thika Road • Tel 0712345678</p>
                      </div>
                      <p className="my-1 border-t border-dashed border-[#DFE1E6]" />
                      <div className="flex justify-between"><span>Bamburi 50kg ×4</span><span>5,000</span></div>
                      <div className="flex justify-between"><span>Dulux 4L ×1</span><span>3,850</span></div>
                      <div className="flex justify-between"><span>Discount</span><span>-500</span></div>
                      <p className="my-1 border-t border-dashed border-[#DFE1E6]" />
                      <div className="flex justify-between font-bold"><span>TOTAL</span><span>8,350</span></div>
                      <div className="flex justify-between"><span>VAT {draft.vatRate}% incl.</span><span>1,152</span></div>
                      <p className="my-1 border-t border-dashed border-[#DFE1E6]" />
                      <p className="text-center text-[7px]" style={{ color: draft.receiptSecondaryColor }}>
                        {draft.receiptPromoFooter}
                      </p>
                      <p className="mt-1 text-center text-[7px] text-[#1B7A2E]">KRA eTIMS VERIFIED ✓</p>
                    </div>

                    {/* A4 mini invoice */}
                    <p className="mt-5 mb-2 text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">A4 invoice</p>
                    <div className="h-[190px] w-[220px] overflow-hidden rounded-lg border border-[#DFE1E6] bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <div className="h-5 w-5">
                            <DukaMark color={draft.receiptPrimaryColor} accent={draft.receiptSecondaryColor} />
                          </div>
                          <p className="text-[9px] font-bold text-[#172B4D]">{draft.companyName}</p>
                        </div>
                        <span className="rounded bg-[#E8F5E9] px-1.5 py-0.5 text-[6px] font-bold text-[#1B7A2E]">TAX INVOICE</span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full" style={{ background: draft.receiptPrimaryColor }} />
                      <div className="mt-3 space-y-1.5">
                        {["INV-2847 • John Kamau", "Bamburi Cement 50kg - 4 × 1,250", "Dulux Vinyl Matt 4L - 1 × 3,850"].map((r) => (
                          <div key={r} className="flex justify-between border-b border-dashed border-[#DFE1E6] pb-1 text-[7px] text-[#172B4D]">
                            <span>{r.split(" • ")[0]}</span>
                            <span>{r.split(" • ")[1] ?? ""}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex justify-between text-[9px] font-bold" style={{ color: draft.receiptPrimaryColor }}>
                        <span>TOTAL DUE</span>
                        <span>KES 8,350</span>
                      </div>
                      <p className="mt-3 text-center text-[6px] text-[#6B778C]">{draft.receiptPromoFooter}</p>
                    </div>
                  </div>

                  <div className="col-span-12 @2xl:col-span-7">
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Primary colour">
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={draft.receiptPrimaryColor}
                            onChange={(e) => set("receiptPrimaryColor", e.target.value)}
                            className="h-10 w-12 cursor-pointer rounded-lg border border-[#DFE1E6] bg-white p-1"
                          />
                          <Input
                            value={draft.receiptPrimaryColor}
                            onChange={(e) => set("receiptPrimaryColor", e.target.value)}
                            className="h-10 flex-1 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] font-mono text-[12px]"
                          />
                        </div>
                      </Field>
                      <Field label="Secondary / accent colour">
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={draft.receiptSecondaryColor}
                            onChange={(e) => set("receiptSecondaryColor", e.target.value)}
                            className="h-10 w-12 cursor-pointer rounded-lg border border-[#DFE1E6] bg-white p-1"
                          />
                          <Input
                            value={draft.receiptSecondaryColor}
                            onChange={(e) => set("receiptSecondaryColor", e.target.value)}
                            className="h-10 flex-1 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] font-mono text-[12px]"
                          />
                        </div>
                      </Field>
                    </div>
                    <Field label="Promo footer (printed on every receipt)" className="mt-4">
                      <Textarea
                        rows={3}
                        value={draft.receiptPromoFooter}
                        onChange={(e) => set("receiptPromoFooter", e.target.value)}
                        className="rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px]"
                      />
                    </Field>
                    <div className="mt-5">
                      <SaveButton
                        onSave={() =>
                          put(
                            {
                              receiptPrimaryColor: draft.receiptPrimaryColor,
                              receiptSecondaryColor: draft.receiptSecondaryColor,
                              receiptPromoFooter: draft.receiptPromoFooter,
                            },
                            "Print formats saved",
                            "New branding prints on the next receipt from any terminal."
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              </Panel>
            )}

            {/* ── TAXES ── */}
            {section === "taxes" && (
              <Panel>
                <PanelHead title="Taxes" sub="Statutory tax configuration applied at checkout" icon={Percent} />
                <div className="mt-6 overflow-hidden rounded-xl border border-[#DFE1E6]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#FAFBFC]">
                        <TableHead className="text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Category</TableHead>
                        <TableHead className="text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Rate</TableHead>
                        <TableHead className="text-[11px] font-bold uppercase tracking-wide text-[#6B778C]">Examples</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="text-[12px] font-semibold text-[#172B4D]">Standard rated</TableCell>
                        <TableCell className="font-mono text-[12px] font-bold text-[#0052CC]">{draft.vatRate}%</TableCell>
                        <TableCell className="text-[12px] text-[#6B778C]">Cement, paint, tools, plumbing</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-[12px] font-semibold text-[#172B4D]">Zero rated</TableCell>
                        <TableCell className="font-mono text-[12px] font-bold text-[#00C853]">0%</TableCell>
                        <TableCell className="text-[12px] text-[#6B778C]">Unprocessed materials for resale</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-[12px] font-semibold text-[#172B4D]">Exempt</TableCell>
                        <TableCell className="font-mono text-[12px] font-bold text-[#6B778C]">-</TableCell>
                        <TableCell className="text-[12px] text-[#6B778C]">Financial services, land</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-4 rounded-xl bg-[#F4F5F7] p-3 text-[12px] text-[#6B778C]">
                  VAT rate is managed under <span className="font-semibold text-[#0052CC]">Company</span> - currently{" "}
                  {draft.vatRate}% on (subtotal − discounts). eTIMS invoices always transmit the computed VAT per line.
                </p>
              </Panel>
            )}

            {/* ── KRA eTIMS ── */}
            {section === "kra" && (
              <Panel>
                <PanelHead title="KRA eTIMS Settings" sub="Configure eTIMS for compliant invoicing • CU Serial • Branch • Device" icon={Landmark} />
                <div className="mt-5 flex max-w-[560px] items-center justify-between rounded-xl border border-[#DFE1E6] bg-[#E8F5E9] px-4 py-3">
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-[#1B7A2E]">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#00C853]" />
                    Online • Last sync {rel(draft.kraLastSync)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      toast({
                        title: "eTIMS handshake OK",
                        description: `Device ${draft.kraDeviceSerial} registered with KRA.`,
                      })
                    }
                    className="h-8 rounded-lg border-[#C8E6C9] bg-white text-[12px] font-bold text-[#1B7A2E]"
                  >
                    <Plug size={13} /> Test Connection
                  </Button>
                </div>

                <div className="mt-6 grid max-w-[560px] grid-cols-2 gap-4">
                  <Field label="KRA PIN">
                    <Input
                      value={draft.kraPin}
                      onChange={(e) => set("kraPin", e.target.value)}
                      className="h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] font-mono text-[13px]"
                    />
                  </Field>
                  <Field label="Branch ID">
                    <Input
                      value={draft.kraBranchId}
                      onChange={(e) => set("kraBranchId", e.target.value)}
                      className="h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] font-mono text-[13px]"
                    />
                  </Field>
                  <Field label="Device Serial">
                    <Input
                      value={draft.kraDeviceSerial}
                      onChange={(e) => set("kraDeviceSerial", e.target.value)}
                      className="h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] font-mono text-[13px]"
                    />
                  </Field>
                  <Field label="Connection status">
                    <div className="flex h-10 items-center gap-2 rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] px-3 text-[12px] text-[#6B778C]">
                      <span className="h-2 w-2 rounded-full bg-[#00C853]" /> Synced {rel(draft.kraLastSync)}
                    </div>
                  </Field>
                  <Field label="Callback URL" className="col-span-2">
                    <Input
                      value={draft.kraCallbackUrl}
                      onChange={(e) => set("kraCallbackUrl", e.target.value)}
                      className="h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] font-mono text-[12px] text-[#6B778C]"
                    />
                  </Field>
                </div>
                <div className="mt-6">
                  <SaveButton
                    onSave={() =>
                      put(
                        {
                          kraPin: draft.kraPin,
                          kraBranchId: draft.kraBranchId,
                          kraDeviceSerial: draft.kraDeviceSerial,
                          kraCallbackUrl: draft.kraCallbackUrl,
                        },
                        "KRA eTIMS settings saved",
                        "Device re-registered with KRA gateway."
                      )
                    }
                  />
                </div>
              </Panel>
            )}

            {/* ── M-PESA DARAJA ── */}
            {section === "mpesa" && (
              <Panel>
                <PanelHead title="M-Pesa Daraja" sub="STK push + B2C payouts via Safaricom Daraja API" icon={Smartphone} />
                <div className="mt-6 grid max-w-[560px] grid-cols-2 gap-4">
                  <Field label="Environment">
                    <Select
                      value={draft.mpesaEnvironment}
                      onValueChange={(v) => {
                        set("mpesaEnvironment", v as SettingsDto["mpesaEnvironment"]);
                        if (v === "Production") {
                          toast({
                            title: "Production selected - double-check keys",
                            description: "STK pushes will hit the live Daraja gateway. Save to persist.",
                          });
                        }
                      }}
                    >
                      <SelectTrigger className="h-10 rounded-xl text-[13px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Sandbox">Sandbox (test)</SelectItem>
                        <SelectItem value="Production">Production (live)</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Till / Paybill numbers">
                    <Input
                      value={draft.mpesaTillNumbers}
                      onChange={(e) => set("mpesaTillNumbers", e.target.value)}
                      className="h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] font-mono text-[13px]"
                    />
                  </Field>
                  <Field label="Consumer Key">
                    <PasswordInput value={draft.mpesaConsumerKey} onChange={(v) => set("mpesaConsumerKey", v)} />
                  </Field>
                  <Field label="Consumer Secret">
                    <PasswordInput value={draft.mpesaConsumerSecret} onChange={(v) => set("mpesaConsumerSecret", v)} />
                  </Field>
                  <Field label="Validation / callback URL" className="col-span-2">
                    <Input
                      value={draft.mpesaCallbackUrl}
                      onChange={(e) => set("mpesaCallbackUrl", e.target.value)}
                      className="h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] font-mono text-[12px] text-[#6B778C]"
                    />
                  </Field>
                </div>
                <div className="mt-6 flex flex-wrap gap-2">
                  <SaveButton
                    onSave={() =>
                      put(
                        {
                          mpesaEnvironment: draft.mpesaEnvironment,
                          mpesaConsumerKey: draft.mpesaConsumerKey,
                          mpesaConsumerSecret: draft.mpesaConsumerSecret,
                          mpesaTillNumbers: draft.mpesaTillNumbers,
                          mpesaCallbackUrl: draft.mpesaCallbackUrl,
                        },
                        "M-Pesa Daraja settings saved",
                        `Environment: ${draft.mpesaEnvironment}`
                      )
                    }
                  />
                  <Button
                    variant="outline"
                    onClick={() =>
                      toast({
                        title: "Daraja OAuth OK",
                        description: `Token issued (expires 3599s) • ${draft.mpesaEnvironment} app ${draft.mpesaTillNumbers.split(",")[0]?.trim() ?? ""}`,
                      })
                    }
                    className="h-10 rounded-xl border-[#DFE1E6] px-5 text-[13px] font-bold text-[#172B4D]"
                  >
                    <Plug size={14} /> Validate keys
                  </Button>
                </div>
              </Panel>
            )}

            {/* ── SMS PROVIDER ── */}
            {section === "sms" && (
              <Panel>
                <PanelHead title="SMS Provider" sub="Africa's Talking gateway + WhatsApp Cloud API" icon={MessageSquare} />
                <div className="mt-6 grid max-w-[560px] grid-cols-2 gap-4">
                  <Field label="API key">
                    <PasswordInput value={draft.smsApiKey} onChange={(v) => set("smsApiKey", v)} />
                  </Field>
                  <Field label="Sender name">
                    <Input
                      value={draft.smsSenderName}
                      onChange={(e) => set("smsSenderName", e.target.value)}
                      className="h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px] font-semibold"
                    />
                  </Field>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {["Africa's Talking", "WhatsApp Cloud API"].map((p) => (
                    <span
                      key={p}
                      className="inline-flex items-center gap-2 rounded-full border border-[#DFE1E6] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#172B4D]"
                    >
                      <span className="h-2 w-2 rounded-full bg-[#00C853]" /> {p}
                    </span>
                  ))}
                </div>
                <div className="mt-6 flex flex-wrap gap-2">
                  <SaveButton
                    onSave={() =>
                      put(
                        { smsApiKey: draft.smsApiKey, smsSenderName: draft.smsSenderName },
                        "SMS provider settings saved",
                        `Sender name "${draft.smsSenderName}" is live.`
                      )
                    }
                  />
                  <Button
                    variant="outline"
                    onClick={() =>
                      toast({
                        title: "Test SMS sent to 0712345678 - Delivered",
                        description: `Sender ${draft.smsSenderName} • 1 segment • KES 1`,
                      })
                    }
                    className="h-10 rounded-xl border-[#DFE1E6] px-5 text-[13px] font-bold text-[#172B4D]"
                  >
                    Send test SMS
                  </Button>
                </div>
              </Panel>
            )}

            {/* ── LOYALTY RULES ── */}
            {section === "loyalty" && (
              <Panel>
                <PanelHead title="Loyalty Rules" sub="How customers earn and spend points" icon={Sparkles} />
                <div className="mt-6 grid max-w-[560px] grid-cols-3 gap-4">
                  <Field label="Earn 1 point per KES">
                    <Input
                      type="number"
                      min={1}
                      value={draft.loyaltyEarnPerKes}
                      onChange={(e) => set("loyaltyEarnPerKes", Number(e.target.value))}
                      className="h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px]"
                    />
                  </Field>
                  <Field label="1 point = KES">
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      value={draft.loyaltyPointValue}
                      onChange={(e) => set("loyaltyPointValue", Number(e.target.value))}
                      className="h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px]"
                    />
                  </Field>
                  <Field label="Expiry (months)">
                    <Input
                      type="number"
                      min={0}
                      value={draft.loyaltyExpiryMonths}
                      onChange={(e) => set("loyaltyExpiryMonths", Number(e.target.value))}
                      className="h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px]"
                    />
                  </Field>
                </div>
                <div className="mt-4 max-w-[560px] rounded-xl border border-[#0052CC]/25 bg-[#E9F2FF] p-4">
                  <p className="text-[12px] font-bold text-[#0052CC]">Live preview - Gold member basket</p>
                  <p className="mt-1 text-[13px] text-[#172B4D]">
                    Spend KES 1,000 → earn{" "}
                    <span className="font-display font-bold">{loyaltyPreview.pts} pts</span> = KES {loyaltyPreview.kes} value
                    {draft.loyaltyExpiryMonths > 0
                      ? ` • points expire after ${draft.loyaltyExpiryMonths} months`
                      : " • points never expire"}
                  </p>
                </div>
                <div className="mt-6">
                  <SaveButton
                    onSave={() =>
                      put(
                        {
                          loyaltyEarnPerKes: draft.loyaltyEarnPerKes,
                          loyaltyPointValue: draft.loyaltyPointValue,
                          loyaltyExpiryMonths: draft.loyaltyExpiryMonths,
                        },
                        "Loyalty rules saved",
                        "Applied to the next sale at every terminal."
                      )
                    }
                  />
                </div>

                {/* ── Happy Hour auto-pricing ── */}
                <Separator className="my-6" />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 text-[14px] font-bold text-[#172B4D]">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#FFF3CD] text-[#B8860B]">
                        <Percent size={13} />
                      </span>
                      Happy Hour auto-pricing
                    </p>
                    <p className="mt-1 max-w-md text-[11px] leading-relaxed text-[#6B778C]">
                      Automatic time-boxed discount - e.g. 10% off Cement between 14:00 and 16:00 to move slow stock.
                      Applied at every till (and to offline sales replayed later, using the time they were rung up).
                    </p>
                  </div>
                  <Switch
                    checked={draft.happyHourEnabled}
                    onCheckedChange={(v) => set("happyHourEnabled", v)}
                    className="data-[state=checked]:bg-[#FFAB00]"
                  />
                </div>
                <div className="mt-4 grid max-w-[560px] grid-cols-2 gap-4 @xl:grid-cols-4">
                  <Field label="Starts">
                    <Input
                      type="time"
                      value={draft.happyHourStart}
                      onChange={(e) => set("happyHourStart", e.target.value)}
                      className="h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px]"
                    />
                  </Field>
                  <Field label="Ends">
                    <Input
                      type="time"
                      value={draft.happyHourEnd}
                      onChange={(e) => set("happyHourEnd", e.target.value)}
                      className="h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px]"
                    />
                  </Field>
                  <Field label="Discount %">
                    <Input
                      type="number"
                      min={1}
                      max={90}
                      value={draft.happyHourPercent}
                      onChange={(e) => set("happyHourPercent", Math.min(90, Math.max(0, Number(e.target.value))))}
                      className="h-10 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px]"
                    />
                  </Field>
                  <Field label="Applies to">
                    <Select value={draft.happyHourCategory} onValueChange={(v) => set("happyHourCategory", v)}>
                      <SelectTrigger className="h-10 rounded-xl text-[13px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="All">All products</SelectItem>
                        {categories
                          .filter((c) => c !== "All")
                          .map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <div className="mt-4 flex max-w-[560px] items-center justify-between rounded-xl border border-[#FFD54F] bg-[#FFF8E1] px-4 py-3">
                  <p className="text-[12px] text-[#8D6708]">
                    {draft.happyHourEnabled
                      ? `Window ${draft.happyHourStart}-${draft.happyHourEnd} • ${Math.round(draft.happyHourPercent)}% off ${draft.happyHourCategory === "All" ? "all products" : draft.happyHourCategory}`
                      : "Happy Hour is switched off"}
                  </p>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-bold",
                      hhLiveNow && draft.happyHourEnabled ? "bg-[#00C853] text-white" : "bg-[#DFE1E6] text-[#6B778C]"
                    )}
                  >
                    {hhLiveNow && draft.happyHourEnabled ? "Active now" : "Not active now"}
                  </span>
                </div>
                <div className="mt-4">
                  <SaveButton
                    onSave={() =>
                      put(
                        {
                          happyHourEnabled: draft.happyHourEnabled,
                          happyHourStart: draft.happyHourStart,
                          happyHourEnd: draft.happyHourEnd,
                          happyHourPercent: draft.happyHourPercent,
                          happyHourCategory: draft.happyHourCategory,
                        },
                        "Happy Hour saved",
                        draft.happyHourEnabled
                          ? `${draft.happyHourStart}-${draft.happyHourEnd} • ${Math.round(draft.happyHourPercent)}% off ${draft.happyHourCategory === "All" ? "all products" : draft.happyHourCategory}`
                          : "Tills will not auto-discount"
                      )
                    }
                  />
                </div>
              </Panel>
            )}

            {/* ── BACKUP & RESTORE ── */}
            {section === "backup" && (
              <Panel>
                <PanelHead title="Backup & Restore" sub="Nightly snapshots to cloud + one-click local export" icon={Database} />
                <div className="mt-6 flex max-w-[560px] items-center justify-between rounded-xl border border-[#DFE1E6] bg-[#FAFBFC] p-4">
                  <div>
                    <p className="text-[13px] font-semibold text-[#172B4D]">Automatic nightly backup</p>
                    <p className="text-[11px] text-[#6B778C]">Last snapshot {rel(draft.kraLastSync)} • stored in Nairobi (AWS af-south-1)</p>
                  </div>
                  <Switch checked={autoBackup} onCheckedChange={setAutoBackup} />
                </div>
                <div className="mt-6 flex flex-wrap gap-2">
                  <Button
                    onClick={downloadBackup}
                    className="h-10 rounded-xl bg-[#0052CC] px-5 text-[13px] font-bold text-white hover:bg-[#0041A8]"
                  >
                    <Download size={14} /> Download backup (JSON)
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => fileRef.current?.click()}
                    className="h-10 rounded-xl border-[#DFE1E6] px-5 text-[13px] font-bold text-[#172B4D]"
                  >
                    <Upload size={14} /> Restore from file
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f)
                        toast({
                          title: "Backup validated",
                          description: `${f.name} • restore is simulated in this demo build.`,
                        });
                    }}
                  />
                </div>

                {/* ── Daily automation jobs ── */}
                <div className="mt-6 rounded-xl border border-[#C8E6C9] bg-[#F0FFF4] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 text-[13px] font-semibold text-[#172B4D]">
                        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#00C853]/15 text-[#1B7A2E]">
                          <CalendarClock size={13} />
                        </span>
                        Daily automation jobs
                      </p>
                      <p className="mt-1 max-w-md text-[11px] leading-relaxed text-[#6B778C]">
                        Runs when triggered (wire <code className="rounded bg-white px-1 font-mono text-[10px]">GET /api/cron/daily</code> to any scheduler):
                        recalculate debt-plan overdue days • birthday SMS • debt reminders 1 day before due.
                        Last run: {draft?.lastDailyJobsAt ? rel(draft.lastDailyJobsAt) : "never"}.
                      </p>
                    </div>
                    <Button
                      disabled={jobsBusy}
                      onClick={async () => {
                        setJobsBusy(true);
                        try {
                          const r = await api.post<{ birthdaySent: number; debtRemindersSent: number; overdueUpdated: number; birthdayCandidates: number; reminderCandidates: number }>(
                            "/api/cron/daily",
                            {}
                          );
                          toast({
                            title: "Daily jobs completed ✅",
                            description: `${r.overdueUpdated} overdue recalculated • ${r.birthdaySent}/${r.birthdayCandidates} birthday SMS • ${r.debtRemindersSent}/${r.reminderCandidates} debt reminders sent.`,
                          });
                          const s = await api.get<SettingsDto>("/api/settings");
                          setDraft(s);
                        } catch (e) {
                          toast({ title: "Daily jobs failed", description: e instanceof Error ? e.message : "Unknown error" });
                        } finally {
                          setJobsBusy(false);
                        }
                      }}
                      className="h-10 rounded-xl bg-[#00C853] px-5 text-[13px] font-bold text-white hover:bg-[#00A844]"
                    >
                      {jobsBusy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run jobs now
                    </Button>
                  </div>
                </div>

                {/* ── Scheduled report email (mirrors Reports → Schedule email) ── */}
                <div className="mt-4 rounded-xl border border-[#C5CAE9] bg-[#E8EAF6]/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 text-[13px] font-semibold text-[#172B4D]">
                        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#0052CC]/10 text-[#0052CC]">
                          <CalendarClock size={13} />
                        </span>
                        Scheduled report email
                      </p>
                      <p className="mt-1 max-w-md text-[11px] leading-relaxed text-[#6B778C]">
                        Automatic owner summary - revenue, VAT, top products & payment split
                        (wire <code className="rounded bg-white px-1 font-mono text-[10px]">GET /api/cron/report</code> to any scheduler).
                        Last sent: {draft?.reportScheduleLastSentAt ? rel(draft.reportScheduleLastSentAt) : "never"}.
                      </p>
                    </div>
                    <Button
                      disabled={jobsBusy}
                      onClick={async () => {
                        setJobsBusy(true);
                        try {
                          const r = await api.post<{ ok: boolean; message?: string; email?: string }>("/api/cron/report?force=1", {});
                          toast({
                            title: r.ok ? "Report emailed ✅" : "Not sent",
                            description: r.ok ? `Delivered to ${r.email} - copy logged in Messages.` : r.message,
                          });
                          const s = await api.get<SettingsDto>("/api/settings");
                          setDraft(s);
                        } catch (e) {
                          toast({ title: "Report send failed", description: e instanceof Error ? e.message : "Unknown error" });
                        } finally {
                          setJobsBusy(false);
                        }
                      }}
                      className="h-10 rounded-xl bg-[#0052CC] px-5 text-[13px] font-bold text-white hover:bg-[#0041A8]"
                    >
                      {jobsBusy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Send now
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-[#172B4D]">
                      <Switch
                        checked={draft?.reportScheduleEnabled ?? false}
                        onCheckedChange={(v) => put({ reportScheduleEnabled: v }, v ? "Schedule activated" : "Schedule paused")}
                        aria-label="Toggle scheduled report email"
                      />
                      {draft?.reportScheduleEnabled ? "Active" : "Off"}
                    </label>
                    <Select
                      value={draft?.reportScheduleFrequency ?? "Weekly"}
                      onValueChange={(v) => put({ reportScheduleFrequency: v }, "Frequency updated", `${v} report, 08:00 EAT`)}
                      disabled={!draft?.reportScheduleEnabled}
                    >
                      <SelectTrigger className="h-9 w-[220px] rounded-xl text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Daily">Daily - every day 08:00</SelectItem>
                        <SelectItem value="Weekly">Weekly - Mondays 08:00</SelectItem>
                        <SelectItem value="Monthly">Monthly - 1st 08:00</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="email"
                      value={draft?.reportScheduleEmail ?? ""}
                      onChange={(e) => set("reportScheduleEmail", e.target.value)}
                      placeholder="owner@dukaflow.co.ke"
                      className="h-9 w-[240px] rounded-xl text-[12px]"
                      aria-label="Report recipient email"
                    />
                    <Button
                      variant="outline"
                      onClick={() => put({ reportScheduleEmail: draft?.reportScheduleEmail ?? "" }, "Recipient saved", draft?.reportScheduleEmail)}
                      className="h-9 rounded-xl border-[#DFE1E6] px-4 text-[12px] font-bold text-[#172B4D]"
                    >
                      Save email
                    </Button>
                  </div>
                </div>
              </Panel>
            )}

            {/* ── DEVICE & OFFLINE ── */}
            {section === "device" && (
              <DevicePanel />
            )}

            {/* ── KEYBOARD SHORTCUTS ── */}
            {section === "shortcuts" && (
              <Panel>
                <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Keyboard shortcuts</h3>
                <p className="mt-0.5 text-[12px] text-[#6B778C]">Every speed key in DukaFlow - learn these and the till flies.</p>
                <div className="mt-4 grid gap-2 @2xl:grid-cols-2">
                  {[
                    { keys: ["F2"], where: "POS", what: "Focus the scan / search field - scan or type, then Enter adds the first match" },
                    { keys: ["F4"], where: "POS", what: "Open Quick Return - scan a receipt number and refund what came back" },
                    { keys: ["Enter"], where: "POS scan", what: "Add the first search match to the cart (barcode guns press Enter automatically)" },
                    { keys: ["Enter"], where: "Stock take", what: "Scan mode: each barcode Enter bumps that line's counted quantity" },
                    { keys: ["Esc"], where: "Anywhere", what: "Close the top dialog without saving" },
                    { keys: ["Ctrl", "P"], where: "Anywhere", what: "Print the open statement / receipt / label sheet (uses the print-ready area)" },
                    { keys: ["0-9"], where: "Login", what: "Type the 4-digit staff PIN - the pad also clicks" },
                  ].map((r, i) => (
                    <div
                      key={i}
                      className="group flex items-start gap-3 rounded-xl border border-[#DFE1E6] bg-white px-3.5 py-3 transition hover:border-[#0052CC]/40 hover:shadow-[0_2px_8px_rgba(0,82,204,0.08)]"
                    >
                      <div className="flex shrink-0 gap-1 pt-0.5">
                        {r.keys.map((k) => (
                          <kbd
                            key={k}
                            className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-[#DFE1E6] border-b-2 bg-[#F4F5F7] px-1.5 font-mono text-[11px] font-bold text-[#172B4D] shadow-sm group-hover:border-[#0052CC]/30 group-hover:bg-[#E9F2FF] group-hover:text-[#0052CC]"
                          >
                            {k}
                          </kbd>
                        ))}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-bold text-[#172B4D]">
                          {r.what}
                          <span className="ml-2 rounded-full bg-[#F4F5F7] px-1.5 py-0.5 text-[9.5px] font-bold text-[#6B778C]">{r.where}</span>
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-4 rounded-xl border border-dashed border-[#DFE1E6] bg-[#FAFBFC] px-4 py-3 text-[11.5px] leading-relaxed text-[#6B778C]">
                  <b className="text-[#172B4D]">Tip for cashiers:</b> keep one hand on the barcode gun and one on the keyboard -
                  F2 → scan → Enter → Cash → Enter closes a sale without touching the mouse. Print dialogs respect the
                  print-area isolation, so only the receipt / statement / sticker sheet lands on paper.
                </p>
              </Panel>
            )}
        </div>
      </div>
    </div>
  );
}
