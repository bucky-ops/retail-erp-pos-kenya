"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { SettingsDto, StoreDto, StaffDto } from "@/types";

export type ScreenId =
  | "design" | "login" | "dashboard" | "pos" | "pipeline" | "inventory"
  | "customers" | "debts" | "receipts" | "payroll" | "messages"
  | "chat" | "reports" | "settings" | "dayclose" | "accounting";

export interface AuthUser {
  id: number;
  name: string;
  role: string;
  color: string;
  storeId: number | null;
  storeName?: string;
}

/** Session-scoped slice — the only part persisted to localStorage. */
interface SessionSlice {
  page: ScreenId;
  sidebarCollapsed: boolean;
  device: "desktop" | "tablet" | "mobile";
  user: AuthUser | null;
  activeStoreId: number | "all";
}

interface AppState extends SessionSlice {
  /* hydration flag — flips once persisted session is restored */
  hydrated: boolean;

  setPage: (p: ScreenId) => void;
  toggleSidebar: () => void;
  setDevice: (d: "desktop" | "tablet" | "mobile") => void;
  setUser: (u: AuthUser | null) => void;
  setActiveStoreId: (id: number | "all") => void;

  /* bootstrap data (NOT persisted — refetched on boot) */
  stores: StoreDto[];
  staff: StaffDto[];
  settings: SettingsDto | null;
  categories: string[];
  setBootstrap: (data: {
    stores: StoreDto[];
    staff: StaffDto[];
    settings: SettingsDto | null;
    categories: string[];
  }) => void;
}

const initialSession: SessionSlice = {
  page: "dashboard",
  sidebarCollapsed: false,
  device: "desktop",
  user: null,
  activeStoreId: "all",
};

export const useApp = create<AppState>()(
  persist<AppState, [], [], SessionSlice>(
    (set) => ({
      ...initialSession,
      hydrated: false,

      setPage: (page) => set({ page }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setDevice: (device) => set({ device }),
      setUser: (user) => set({ user }),
      setActiveStoreId: (activeStoreId) => set({ activeStoreId }),

      stores: [],
      staff: [],
      settings: null,
      categories: ["All"],
      setBootstrap: ({ stores, staff, settings, categories }) =>
        set({ stores, staff, settings, categories }),
    }),
    {
      name: "dukaflow-session",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({
        page: s.page,
        sidebarCollapsed: s.sidebarCollapsed,
        device: s.device,
        user: s.user,
        activeStoreId: s.activeStoreId,
      }),
    }
  )
);

/** online/offline + unsynced sale count (single instance mounted in shell) */
interface SyncState {
  online: boolean;
  unsynced: number;
  setOnline: (v: boolean) => void;
  setUnsynced: (n: number) => void;
}
export const useSync = create<SyncState>((set) => ({
  online: true,
  unsynced: 0,
  setOnline: (online) => set({ online }),
  setUnsynced: (unsynced) => set({ unsynced }),
}));
