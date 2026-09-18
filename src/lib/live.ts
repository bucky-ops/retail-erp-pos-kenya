"use client";

/**
 * DukaFlow live feed client - a singleton socket.io connection to the
 * live-feed mini-service (port 3003, reached through the Caddy gateway as
 * "/?XTransformPort=3003") shared by every screen that wants real-time
 * events: dashboard feed, Raven chat, low-stock toasts.
 *
 * Usage:
 *   const status = useLive((event, payload) => { ... });
 *   status: "connecting" | "live" | "down"
 */

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export type LiveEventName = "sale:new" | "stock:low" | "chat:new" | "till:z";

/** Payload broadcast with sale:new - mirrors the committed Sale row. */
export interface LiveSale {
  receiptNo: string;
  storeName: string;
  customerName: string;
  customerTier: string | null;
  total: number;
  paymentMethod: string;
  kraStatus: string;
  staffName: string;
  offlineCreated?: boolean;
  createdAt: string;
}

/** Payload broadcast with stock:low - a product crossed its reorder point. */
export interface LiveLowStock {
  productName: string;
  emoji: string;
  storeName: string;
  qty: number;
  reorderPoint: number;
}

/** Payload broadcast with chat:new - a Raven message was posted. */
export interface LiveChatMessage {
  channelId: number;
  channelName: string;
  id: number;
  author: string;
  initials: string;
  content: string;
  docLink?: string | null;
  createdAt: string;
}

type Listener = (event: LiveEventName, payload: unknown) => void;

const listeners = new Set<Listener>();
let socket: Socket | null = null;

/** Lazily create the shared socket (client-side only). */
function ensureSocket(): Socket {
  if (!socket) {
    socket = io("/?XTransformPort=3003", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 8000,
      timeout: 10000,
    });

    // Forward only known business events to subscribers.
    const forward = (event: LiveEventName) => (payload: unknown) => {
      listeners.forEach((l) => l(event, payload));
    };
    const onSale = forward("sale:new");
    const onStock = forward("stock:low");
    const onChat = forward("chat:new");
    const onTill = forward("till:z");
    socket.on("sale:new", onSale);
    socket.on("stock:low", onStock);
    socket.on("chat:new", onChat);
    socket.on("till:z", onTill);

    // Replay buffer from the service (after a reload) - delivered as one batch.
    socket.on("recent", (items: { event: string; payload: unknown }[]) => {
      if (!Array.isArray(items)) return;
      for (const item of items.slice().reverse()) {
        if (["sale:new", "stock:low", "chat:new", "till:z"].includes(item.event)) {
          listeners.forEach((l) => l(item.event as LiveEventName, item.payload));
        }
      }
    });
  }
  return socket;
}

export type LiveStatus = "connecting" | "live" | "down";

/**
 * Subscribe to live events. The handler is kept in a ref so the socket is
 * created only once no matter how often the callback identity changes.
 */
export function useLive(onEvent?: Listener): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const handlerRef = useRef<Listener | undefined>(undefined);
  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const s = ensureSocket();
    const onConnect = () => setStatus("live");
    const onDisconnect = () => setStatus("down");
    const onError = () => setStatus("down");
    // Already connected (e.g. remount) - sync status off the render path.
    if (s.connected) queueMicrotask(() => setStatus("live"));
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("connect_error", onError);

    const listener: Listener = (event, payload) => handlerRef.current?.(event, payload);
    listeners.add(listener);

    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("connect_error", onError);
      listeners.delete(listener);
    };
  }, []);

  return status;
}
