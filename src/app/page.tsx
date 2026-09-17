"use client";

import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard, ShoppingCart, KanbanSquare, Boxes, Users, HandCoins, ReceiptText,
  Banknote, MessageSquare, MessagesSquare, BarChart3, Settings2, Palette, LogOut,
  ChevronLeft, Wifi, WifiOff, Search, Store as StoreIcon, RefreshCw, PackageCheck, Menu,
} from "lucide-react";
import { useApp, useSync, ScreenId } from "@/lib/store";
import { api } from "@/lib/api";
import { syncPendingSales, offlineQueue } from "@/lib/offline";
import { Logo, DukaMark } from "@/components/df/logo";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import LoginScreen from "@/components/screens/login-screen";
import DesignScreen from "@/components/screens/design-screen";
import DashboardScreen from "@/components/screens/dashboard-screen";
import PosScreen from "@/components/screens/pos-screen";
import PipelineScreen from "@/components/screens/pipeline-screen";
import InventoryScreen from "@/components/screens/inventory-screen";
import CustomersScreen from "@/components/screens/customers-screen";
import DebtsScreen from "@/components/screens/debts-screen";
import ReceiptsScreen from "@/components/screens/receipts-screen";
import PayrollScreen from "@/components/screens/payroll-screen";
import MessagesScreen from "@/components/screens/messages-screen";
import ChatScreen from "@/components/screens/chat-screen";
import ReportsScreen from "@/components/screens/reports-screen";
import SettingsScreen from "@/components/screens/settings-screen";

const NAV: { id: ScreenId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "pos", label: "POS", icon: ShoppingCart },
  { id: "pipeline", label: "Pipeline", icon: KanbanSquare },
  { id: "inventory", label: "Inventory", icon: Boxes },
  { id: "customers", label: "Customers", icon: Users },
  { id: "debts", label: "Debts", icon: HandCoins },
  { id: "receipts", label: "Receipts", icon: ReceiptText },
  { id: "payroll", label: "Payroll", icon: Banknote },
  { id: "messages", label: "Messages", icon: MessageSquare },
  { id: "chat", label: "Raven Chat", icon: MessagesSquare },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "design", label: "Design System", icon: Palette },
];

export default function App() {
  const { page, setPage, sidebarCollapsed, toggleSidebar, device, user, setUser, stores, activeStoreId, setActiveStoreId, setBootstrap, hydrated } = useApp();
  const { online, setOnline, unsynced, setUnsynced } = useSync();
  const [mobileNav, setMobileNav] = useState(false);
  const booted = useRef(false);
  const welcomed = useRef(false);

  /* bootstrap */
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    api
      .get<{
        stores: never[];
        staff: never[];
        settings: never;
        categories: string[];
      }>("/api/bootstrap")
      .then((d: { stores: never[]; staff: never[]; settings: never; categories: string[] }) =>
        setBootstrap({ stores: d.stores, staff: d.staff, settings: d.settings, categories: d.categories })
      )
      .catch(() =>
        toast({ title: "Offline start", description: "Could not reach server — POS still works offline." })
      );
  }, [setBootstrap]);

  /* session hydration flag — official persist API + failsafe */
  useEffect(() => {
    const flag = () => useApp.setState({ hydrated: true });
    if (useApp.persist.hasHydrated()) {
      flag();
      return;
    }
    const unsub = useApp.persist.onFinishHydration(flag);
    const failsafe = window.setTimeout(flag, 1500); // never trap the user on splash
    return () => {
      unsub();
      window.clearTimeout(failsafe);
    };
  }, []);

  /* welcome back once a persisted session is restored */
  useEffect(() => {
    if (hydrated && user && !welcomed.current) {
      welcomed.current = true;
      toast({ title: `Karibu tena, ${user.name.split(" ")[0]} 👋`, description: `${user.role} • session restored` });
    }
  }, [hydrated, user]);

  /* online detection + auto-sync of offline sales */
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    const tick = async () => {
      const { unsynced: n } = await offlineQueue.count();
      setUnsynced(n);
      if (navigator.onLine && n > 0) {
        const { synced, failed } = await syncPendingSales();
        if (synced > 0) {
          toast({ title: `↗ ${synced} offline sale${synced > 1 ? "s" : ""} synced`, description: failed ? `${failed} still queued` : "Queue clear" });
        }
        const c = await offlineQueue.count();
        setUnsynced(c.unsynced);
      }
    };
    tick();
    const iv = setInterval(tick, 10_000);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      clearInterval(iv);
    };
  }, [setOnline, setUnsynced]);

  const activeStore = stores.find((s) => s.id === activeStoreId);
  const today = new Date().toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
  const initials = user ? user.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase() : "DF";

  const frameClass =
    device === "tablet"
      ? "mx-auto my-6 w-[1024px] max-w-full h-[768px] overflow-hidden rounded-2xl border-4 border-[#172B4D] shadow-2xl"
      : device === "mobile"
        ? "mx-auto my-6 w-[390px] max-w-full h-[844px] overflow-hidden rounded-[36px] border-4 border-[#172B4D] shadow-2xl"
        : "";

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      {!hydrated ? (
        /* splash while the persisted session rehydrates */
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#172B4D]">
          <div className="h-14 w-14 animate-pulse rounded-[14px] bg-[#0052CC] shadow-lg" />
          <p className="font-display text-sm font-semibold tracking-wide text-white/80">DukaFlow POS</p>
        </div>
      ) : !user ? (
        <LoginScreen
          onLogin={(u) => {
            setUser(u);
            if (u.role === "Cashier" || u.role === "Store Keeper") setPage("pos");
          }}
        />
      ) : (
        <div className={cn(device !== "desktop" && "p-2 md:p-6 bg-[#E3E6EA] min-h-screen")}>
          {/* @container makes every responsive `@xl:`-style variant inside respond to the FRAME
              width in preview modes (tablet 1016px / mobile 382px) instead of the real viewport,
              and to the full window on desktop — fixes the mobile-frame clipping bug. */}
          <div className={cn("@container flex h-screen min-h-0", frameClass)}>
            {/* ── Sidebar (hidden in mobile frame — mobile nav is in topbar) ── */}
            <aside
              className={cn(
                "flex-col bg-[#172B4D] transition-all duration-200",
                device === "mobile" ? "hidden" : "flex",
                sidebarCollapsed ? "w-[72px]" : "w-[248px]"
              )}
            >
              <div className="flex h-[64px] items-center justify-between px-4">
                {!sidebarCollapsed ? (
                  <Logo variant="white" size={22} />
                ) : (
                  <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-[#0052CC]">
                    <div className="h-[60%] w-[60%]">
                      <DukaMark white />
                    </div>
                  </div>
                )}
                <button
                  onClick={toggleSidebar}
                  aria-label="Toggle sidebar"
                  className="text-white/50 transition hover:text-white"
                >
                  <ChevronLeft size={16} className={cn(sidebarCollapsed && "rotate-180")} />
                </button>
              </div>

              <nav className="df-scroll flex-1 space-y-1 overflow-y-auto px-3 py-3" aria-label="Main navigation">
                {NAV.map((c) => {
                  const active = page === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setPage(c.id)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition",
                        active
                          ? "border-l-4 border-l-[#0052CC] bg-white text-[#172B4D] shadow-sm"
                          : "text-white/70 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      <c.icon size={18} className={active ? "text-[#0052CC]" : ""} />
                      {!sidebarCollapsed && <span className="flex-1 text-left">{c.label}</span>}
                      {!sidebarCollapsed && c.id === "chat" && <ChatUnreadBadge />}
                    </button>
                  );
                })}
              </nav>

              <div className="space-y-3 border-t border-white/10 p-3">
                {!sidebarCollapsed && (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0052CC] font-bold text-white">
                      <div className="h-5 w-5">
                        <DukaMark white />
                      </div>
                    </div>
                      <div>
                        <p className="text-[12px] font-semibold text-white">DukaFlow POS</p>
                        <p className={cn("text-[11px]", online ? "text-white/60" : "text-[#FFAB00]")}>
                          Tablet v2.4 • {online ? "Online" : `Offline${unsynced ? ` • ${unsynced} queued` : ""}`}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setPage("pos")}
                      className="mt-3 flex h-8 w-full items-center justify-center rounded-lg bg-[#0052CC] text-white transition hover:bg-[#0041A3]"
                      aria-label="Open POS"
                    >
                      <div className="h-5 w-5">
                        <DukaMark white />
                      </div>
                    </button>
                  </div>
                )}
                <button
                  onClick={() => setUser(null)}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] text-white/60 transition hover:bg-white/10 hover:text-white"
                >
                  <LogOut size={16} /> {!sidebarCollapsed && "Sign Out"}
                </button>
              </div>
            </aside>

            {/* ── Main column ─────────────────────────── */}
            <div className="flex min-w-0 flex-1 flex-col bg-[#F4F5F7]">
              {/* Topbar */}
              <header className="sticky top-0 z-20 flex h-[64px] items-center justify-between border-b border-[#DFE1E6] bg-white px-4 @4xl:px-8">
                <div className="flex items-center gap-3">
                  <div className="@4xl:hidden">
                    <Logo size={20} />
                  </div>
                  <div className="hidden items-center gap-2 rounded-full border border-[#DFE1E6] bg-[#F4F5F7] px-3 py-1.5 @2xl:flex">
                    <StoreIcon size={14} className="text-[#6B778C]" />
                    <select
                      aria-label="Store selector"
                      value={String(activeStoreId)}
                      onChange={(e) => setActiveStoreId(e.target.value === "all" ? "all" : Number(e.target.value))}
                      className="bg-transparent text-[12px] font-semibold outline-none"
                    >
                      <option value="all">Thika Road • Kiambu • All Stores</option>
                      {stores.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div
                    className={cn(
                      "hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium @2xl:flex",
                      online
                        ? "border-[#C8E6C9] bg-[#E8F5E9] text-[#1B7A2E]"
                        : "border-[#FFE0B2] bg-[#FFF8E1] text-[#B8860B]"
                    )}
                  >
                    <span className={cn("h-2 w-2 rounded-full", online ? "animate-pulse bg-[#00C853]" : "bg-[#FFAB00]")} />
                    {online ? "Online • KRA Connected" : `Offline${unsynced ? ` • ${unsynced} sales queued` : ""}`}
                  </div>
                  {page === "pos" && (
                    <span className="hidden rounded-full border border-[#DFE1E6] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#6B778C] @2xl:inline-flex">
                      {activeStore ? activeStore.name : "All Stores"} • Offline-first
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <span className="hidden items-center gap-2 text-[12px] text-[#6B778C] @2xl:flex">{today}</span>
                  {unsynced > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF0E5] px-2.5 py-1 text-[11px] font-bold text-[#D04A1E]">
                      <WifiOff size={12} /> {unsynced} queued
                    </span>
                  )}
                  <button
                    onClick={async () => {
                      const { synced, failed } = await syncPendingSales();
                      toast({ title: synced ? `Synced ${synced} sale${synced > 1 ? "s" : ""}` : "Nothing to sync", description: failed ? `${failed} failed` : undefined });
                      const c = await offlineQueue.count();
                      setUnsynced(c.unsynced);
                    }}
                    className="hidden h-8 w-8 items-center justify-center rounded-full border border-[#DFE1E6] text-[#6B778C] transition hover:bg-[#F4F5F7] @md:flex"
                    aria-label="Sync offline sales"
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    onClick={() => setPage("pos")}
                    aria-label="Open POS"
                    className="hidden h-8 w-8 items-center justify-center rounded-full border border-[#DFE1E6] text-[#6B778C] transition hover:bg-[#F4F5F7] @md:flex"
                  >
                    <Search size={14} />
                  </button>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#172B4D] text-[11px] font-bold text-white">
                    {initials}
                  </div>
                  {/* mobile quick nav (small viewports + mobile frame) */}
                  <div className="flex items-center gap-1">
                    <div className="flex gap-1 rounded-full border border-[#DFE1E6] bg-[#F4F5F7] p-1">
                      {NAV.slice(0, 4).map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setPage(c.id)}
                          aria-label={c.label}
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-full",
                            page === c.id ? "bg-[#172B4D] text-white" : "text-[#6B778C]"
                          )}
                        >
                          <c.icon size={14} />
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setMobileNav(true)}
                      aria-label="All screens"
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full border border-[#DFE1E6] text-[#6B778C] transition hover:bg-[#F4F5F7]",
                        device === "desktop" && "@4xl:hidden"
                      )}
                    >
                      <Menu size={15} />
                    </button>
                  </div>
                </div>
              </header>

              {/* Screen body — keyed for a soft transition between screens */}
              <main key={page} className="df-fade-in min-h-0 flex-1 overflow-auto bg-[#F4F5F7] p-4 @md:p-6 @4xl:p-8 df-scroll" aria-live="polite">
                {page === "login" && <LoginScreen embedded />}
                {page === "design" && <DesignScreen />}
                {page === "dashboard" && <DashboardScreen />}
                {page === "pos" && <PosScreen />}
                {page === "pipeline" && <PipelineScreen />}
                {page === "inventory" && <InventoryScreen />}
                {page === "customers" && <CustomersScreen />}
                {page === "debts" && <DebtsScreen />}
                {page === "receipts" && <ReceiptsScreen />}
                {page === "payroll" && <PayrollScreen />}
                {page === "messages" && <MessagesScreen />}
                {page === "chat" && <ChatScreen />}
                {page === "reports" && <ReportsScreen />}
                {page === "settings" && <SettingsScreen />}
              </main>

              {/* Sticky footer */}
              <footer className="mt-auto flex items-center justify-between border-t border-[#DFE1E6] bg-white px-4 py-2.5 text-[11px] text-[#6B778C] @4xl:px-8">
                <span className="flex items-center gap-1.5">
                  <PackageCheck size={12} className="text-[#00C853]" />
                  DukaFlow v2.4 — Multi-store • Offline-first POS • KRA eTIMS • M-Pesa Ready
                </span>
                <span className="hidden @md:inline">
                  {activeStore ? `${activeStore.name}, ${activeStore.location}` : "All Stores"} • Nairobi, Kenya
                </span>
              </footer>
            </div>
          </div>
        </div>
      )}

      {/* Mobile all-screens nav */}
      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="right" className="w-[280px] bg-[#172B4D] border-white/10 p-4">
          <SheetTitle className="sr-only">All screens</SheetTitle>
          <div className="mb-4 px-2 pt-2">
            <Logo variant="white" size={20} />
          </div>
          <nav className="space-y-1" aria-label="All screens">
            {NAV.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setPage(c.id);
                  setMobileNav(false);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition",
                  page === c.id
                    ? "bg-white text-[#172B4D] shadow-sm"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                )}
              >
                <c.icon size={17} className={page === c.id ? "text-[#0052CC]" : ""} />
                {c.label}
              </button>
            ))}
          </nav>
          <button
            onClick={() => {
              setUser(null);
              setMobileNav(false);
            }}
            className="mt-6 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut size={16} /> Sign Out
          </button>
        </SheetContent>
      </Sheet>

      {/* Device switcher */}
      {user && (
        <div className="fixed bottom-4 right-4 z-30 flex gap-1 rounded-full border border-[#DFE1E6] bg-white p-1 shadow-xl">
          {(["desktop", "tablet", "mobile"] as const).map((d) => (
            <button
              key={d}
              onClick={() => useApp.getState().setDevice(d)}
              className={cn(
                "rounded-full px-3 py-1.5 text-[11px] font-bold",
                device === d ? "bg-[#172B4D] text-white" : "text-[#6B778C]"
              )}
            >
              {d === "desktop" ? "Desktop" : d === "tablet" ? "Tablet POS 1024" : "Mobile 390"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatUnreadBadge() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    api
      .get<{ channels: { unread: number }[] }>("/api/chat")
      .then((d) => setUnread(d.channels.reduce((a, c) => a + c.unread, 0)))
      .catch(() => {});
  }, []);
  if (!unread) return null;
  return (
    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#FF5630] px-1 text-[10px] font-bold text-white">
      {unread}
    </span>
  );
}
