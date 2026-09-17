"use client";

import { cn } from "@/lib/utils";
import { Tier } from "@/types";

/** Gold / Silver / Bronze tier badge. */
export function TierBadge({ tier, className }: { tier?: string | null; className?: string }) {
  if (!tier) return null;
  const map: Record<string, string> = {
    Gold: "bg-[#FFF8E1] text-[#B8860B] border-[#FFD54F]",
    Silver: "bg-[#ECEFF1] text-[#546E7A] border-[#B0BEC5]",
    Bronze: "bg-[#EFEBE9] text-[#8D6E63] border-[#BCAAA4]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        map[tier] ?? map.Bronze,
        className
      )}
    >
      {tier === "Gold" ? "★" : tier === "Silver" ? "✦" : "●"} {tier}
    </span>
  );
}

/** Stock level badge for product grids. */
export function StockBadge({ qty, className }: { qty: number; className?: string }) {
  const label = qty <= 0 ? "Out of stock" : qty <= 10 ? `Only ${qty} left` : `${qty} in stock`;
  const cls =
    qty <= 0
      ? "bg-[#FFEBEE] text-[#FF5630] border-[#FFCDD2]"
      : qty <= 10
        ? "bg-[#FFF8E1] text-[#B8860B] border-[#FFD54F]"
        : "bg-[#E8F5E9] text-[#1B7A2E] border-[#C8E6C9]";
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", cls, className)}>
      {label}
    </span>
  );
}

/** KRA eTIMS verification pill. */
export function KraBadge({ status, className }: { status: string; className?: string }) {
  const ok = status === "Verified";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
        ok ? "bg-[#E8F5E9] text-[#1B7A2E]" : "bg-[#FFF8E1] text-[#B8860B]",
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-[#00C853]" : "bg-[#FFAB00]")} />
      {ok ? "KRA Verified" : `KRA ${status}`}
    </span>
  );
}

/** Generic red/green delta pill used on KPI cards. */
export function DeltaPill({ value, className }: { value: string; className?: string }) {
  const positive = !value.trim().startsWith("-");
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-bold",
        positive ? "bg-[#E8F5E9] text-[#1B7A2E]" : "bg-[#FFEBEE] text-[#FF5630]",
        className
      )}
    >
      {positive ? "▲" : "▼"} {value}
    </span>
  );
}

/** Overdue badge (red variants by severity). */
export function OverdueBadge({ days, className }: { days: number; className?: string }) {
  if (days <= 0) {
    return (
      <span className={cn("rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[10px] font-bold text-[#1B7A2E]", className)}>
        On time
      </span>
    );
  }
  const severe = days > 7;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-bold",
        severe ? "bg-[#FF5630] text-white" : "bg-[#FFF0E5] text-[#D04A1E]",
        className
      )}
    >
      {days}d overdue{severe ? " • POS blocked" : ""}
    </span>
  );
}
