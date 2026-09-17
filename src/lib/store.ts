"use client";

import { create } from "zustand";
import { SettingsDto, StoreDto, StaffDto } from "@/types";

export type ScreenId =
  | "design" | "login" | "dashboard" | "pos" | "pipeline" | "inventory"
  | "customers" | "debts" | "receipts" | "payroll" | "messages"
  | "chat" | "reports" | "settings";

export interface AuthUser {
  id: number;
  name: string;
  role: string;
  color: string;
  storeId: number | null;
  storeName?: string;
}

interface AppState {
  /* chrome */
  page: ScreenId;
  setPage: (p: ScreenId) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  device: "desktop" | "tablet" | "mobile";
  setDevice: (d: "desktop" | "tablet" | "mobile") => void;

  /* auth + store context */
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  activeStoreId: number | "all";
  setActiveStoreId: (id: number | "all") => void;

  /* bootstrap data */
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

export const useApp = create<AppState>((set) => ({
  page: "dashboard",
  setPage: (page) => set({ page }),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  device: "desktop",
  setDevice: (device) => set({ device }),

  user: null,
  setUser: (user) => {
    set({ user });
  },
  activeStoreId: "all",
  setActiveStoreId: (activeStoreId) => set({ activeStoreId }),

  stores: [],
  staff: [],
  settings: null,
  categories: ["All"],
  setBootstrap: ({ stores, staff, settings, categories }) => set({ stores, staff, settings, categories }),
}));

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
