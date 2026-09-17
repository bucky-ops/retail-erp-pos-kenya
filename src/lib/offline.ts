"use client";

/**
 * Offline-first engine for the POS.
 * Sales are written to IndexedDB first (instant, survives refresh/crash),
 * then synced to the server. Failed/unsynced sales retry automatically
 * when connectivity returns.
 */

export interface QueuedSale {
  clientId: string;
  payload: unknown;
  status: "pending" | "synced" | "failed";
  receiptNo?: string;
  createdAt: number;
  syncedAt?: number;
  error?: string;
}

const DB_NAME = "dukaflow-pos";
const STORE = "sale-queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const os = database.createObjectStore(STORE, { keyPath: "clientId" });
        os.createIndex("status", "status");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const database = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = database.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => database.close();
  });
}

export const offlineQueue = {
  /** Persist a sale locally before attempting server sync. */
  async enqueue(sale: QueuedSale): Promise<void> {
    await tx("readwrite", (store) => store.put(sale));
  },

  async all(): Promise<QueuedSale[]> {
    return tx("readonly", (store) => store.getAll());
  },

  async pending(): Promise<QueuedSale[]> {
    const all = await offlineQueue.all();
    return all.filter((s) => s.status === "pending" || s.status === "failed");
  },

  async update(sale: QueuedSale): Promise<void> {
    await tx("readwrite", (store) => store.put(sale));
  },

  async clearSynced(): Promise<void> {
    const all = await offlineQueue.all();
    for (const s of all) {
      if (s.status === "synced") await tx("readwrite", (store) => store.delete(s.clientId));
    }
  },

  async count(): Promise<{ total: number; unsynced: number }> {
    const all = await offlineQueue.all();
    return {
      total: all.length,
      unsynced: all.filter((s) => s.status !== "synced").length,
    };
  },
};

/** Push all pending sales to /api/sales/sync. Returns number synced. */
export async function syncPendingSales(): Promise<{ synced: number; failed: number }> {
  const pending = await offlineQueue.pending();
  if (pending.length === 0) return { synced: 0, failed: 0 };

  try {
    const res = await fetch("/api/sales/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sales: pending.map((p) => ({ ...(p.payload as Record<string, unknown>), clientId: p.clientId })) }),
    });
    const data = await res.json();
    let synced = 0;
    let failed = 0;
    for (const r of data.results ?? []) {
      const item = pending.find((p) => p.clientId === r.clientId);
      if (!item) continue;
      if (r.ok) {
        synced++;
        await offlineQueue.update({
          ...item, status: "synced", receiptNo: r.receiptNo, syncedAt: Date.now(),
        });
      } else {
        failed++;
        await offlineQueue.update({ ...item, status: "failed", error: r.error });
      }
    }
    await offlineQueue.clearSynced();
    return { synced, failed };
  } catch {
    return { synced: 0, failed: pending.length };
  }
}
