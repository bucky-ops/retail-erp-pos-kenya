"use client";

/**
 * Customer-facing DISPLAY POLE - the second screen customers watch while the
 * cashier rings up the basket. Listens on BroadcastChannel("dukaflow-display")
 * for {type:"cart", total, itemCount, points, storeName, customerName,
 * lastItem} pushed by the POS (Task 2-a). Dark kiosk, no auth, no app shell.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { MonitorSpeaker, ShoppingBasket } from "lucide-react";
import { DukaMark } from "@/components/df/logo";
import { kes } from "@/lib/receipt";

interface DisplayMessage {
  type: string;
  total?: number;
  itemCount?: number;
  points?: number;
  storeName?: string;
  customerName?: string | null;
  customerTier?: string | null;
  lastItem?: string | { name?: string; emoji?: string; qty?: number; price?: number } | null;
}

interface CartState {
  total: number;
  itemCount: number;
  points: number;
  storeName?: string;
  customerName?: string | null;
  customerTier?: string | null;
  lastItem: string | null;
}

const TIER_STYLE: Record<string, string> = {
  Gold: "bg-[#FFD54F] text-[#5D4200]",
  Silver: "bg-[#CFD8DC] text-[#37474F]",
  Bronze: "bg-[#D7CCC8] text-[#4E342E]",
};

function lastItemText(lastItem: DisplayMessage["lastItem"]): string | null {
  if (!lastItem) return null;
  if (typeof lastItem === "string") return lastItem;
  const qty = lastItem.qty ? `${lastItem.qty} x ` : "";
  const price = lastItem.price ? ` - ${kes(lastItem.price)}` : "";
  return `${lastItem.emoji ? `${lastItem.emoji} ` : ""}${qty}${lastItem.name ?? ""}${price}`.trim() || null;
}

/** Static browser capability - server snapshot is always false (no hydration flash). */
const CHANNEL_OK = typeof BroadcastChannel === "function";
const emptySubscribe = () => () => {};

export default function DisplayPolePage() {
  const [cart, setCart] = useState<CartState | null>(null);
  const connected = useSyncExternalStore(emptySubscribe, () => CHANNEL_OK, () => false);

  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel("dukaflow-display");
      ch.onmessage = (e: MessageEvent) => {
        const msg = e.data as DisplayMessage | undefined;
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "cart") {
          setCart({
            total: typeof msg.total === "number" ? msg.total : 0,
            itemCount: typeof msg.itemCount === "number" ? msg.itemCount : 0,
            points: typeof msg.points === "number" ? msg.points : 0,
            storeName: msg.storeName ?? undefined,
            customerName: msg.customerName ?? null,
            customerTier: msg.customerTier ?? null,
            lastItem: lastItemText(msg.lastItem),
          });
        } else if (msg.type === "idle") {
          setCart(null);
        }
      };
    } catch {
      /* very old browser - the page still shows the idle welcome */
    }
    return () => {
      ch?.close();
    };
  }, []);

  const storeName = cart?.storeName ?? "DukaFlow";
  const tier = cart?.customerTier ?? null;

  return (
    <div className="df-kiosk flex min-h-screen flex-col">
      {/* top strip */}
      <header className="flex items-center justify-between px-6 py-4 sm:px-10">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-[#00C853] p-2">
            <DukaMark white />
          </div>
          <div>
            <p className="font-display text-lg font-bold tracking-[0.2em] text-white">DUKAFLOW</p>
            <p className="text-[12px] font-semibold uppercase tracking-widest text-white/40">{storeName}</p>
          </div>
        </div>
        <span
          aria-label="Display connection status"
          className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-white/50"
        >
          <span className={connected ? "h-1.5 w-1.5 animate-pulse rounded-full bg-[#00C853]" : "h-1.5 w-1.5 rounded-full bg-[#FFAB00]"} />
          {connected ? "Display ready" : "Waiting for POS"}
        </span>
      </header>

      {/* stage */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-10 text-center sm:px-10">
        {cart && cart.itemCount > 0 ? (
          <div className="flex w-full flex-col items-center gap-5">
            <p className="text-lg font-semibold uppercase tracking-[0.4em] text-white/45">
              {cart.itemCount} {cart.itemCount === 1 ? "item" : "items"} in your basket
            </p>
            <p className="font-display text-[26vw] font-black leading-none tabular-nums text-white sm:text-9xl">
              {kes(cart.total)}
            </p>
            {cart.points > 0 && (
              <p className="rounded-2xl bg-[#00C853]/15 px-8 py-3 font-display text-2xl font-bold text-[#00E676] sm:text-4xl">
                You will earn {cart.points} pts
              </p>
            )}
            {cart.lastItem && (
              <p className="flex items-center gap-2 text-xl font-medium text-white/55 sm:text-2xl">
                <ShoppingBasket size={22} className="text-[#00C853]" />
                <span className="max-w-[80vw] truncate">{cart.lastItem}</span>
              </p>
            )}
            {cart.customerName && (
              <div className="mt-2 flex items-center gap-3">
                <p className="text-2xl font-bold text-white sm:text-3xl">{cart.customerName}</p>
                {tier && (
                  <span
                    className={`rounded-full px-4 py-1 text-[12px] font-black uppercase tracking-widest ${TIER_STYLE[tier] ?? "bg-white/10 text-white/70"}`}
                  >
                    {tier}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-5 text-white">
            <MonitorSpeaker size={64} strokeWidth={1.3} className="text-white/25" />
            <p className="font-display text-6xl font-black tracking-tight sm:text-8xl">Karibu DukaFlow!</p>
            <p className="text-2xl font-medium text-white/45 sm:text-3xl">Cashier will serve you shortly</p>
          </div>
        )}
      </main>

      <footer className="pb-6 text-center text-[11px] font-semibold uppercase tracking-[0.35em] text-white/20">
        Asante for shopping with us
      </footer>
    </div>
  );
}
