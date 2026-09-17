"use client";

import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { DeltaPill } from "@/components/df/badges";

/** Standard KPI card — icon tile, label, value, delta/sub text, optional inline chart. */
export function KpiCard({
  icon,
  label,
  value,
  delta,
  sub,
  iconBg = "#E9F2FF",
  iconColor = "#0052CC",
  loading,
  chart,
  className,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  delta?: string;
  sub?: string;
  iconBg?: string;
  iconColor?: string;
  loading?: boolean;
  chart?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group rounded-2xl border border-[#DFE1E6] bg-white p-4 shadow-sm transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-[#C9CFDA] hover:shadow-md",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110"
          style={{ background: iconBg, color: iconColor }}
        >
          {icon}
        </div>
        {delta && <DeltaPill value={delta} />}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-28" />
      ) : (
        <p className="font-display mt-3 text-xl font-bold text-[#172B4D]">{value}</p>
      )}
      <p className="mt-0.5 text-[12px] text-[#6B778C]">{label}</p>
      {chart && <div className="mt-2">{chart}</div>}
      {sub && <p className="mt-1 text-[11px] font-medium text-[#6B778C]">{sub}</p>}
    </div>
  );
}

/** Screen-level header (title + optional right actions). */
export function ScreenHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-display text-xl font-bold text-[#172B4D] md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-[#6B778C]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Panel card wrapper. */
export function Panel({
  children,
  className,
  padding = true,
}: {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}) {
  return (
    <div className={cn("rounded-2xl border border-[#DFE1E6] bg-white shadow-sm", padding && "p-4 md:p-6", className)}>
      {children}
    </div>
  );
}

/** Empty state block. */
export function EmptyState({
  icon,
  title,
  sub,
  action,
}: {
  icon: ReactNode;
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#DFE1E6] bg-white/60 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F4F5F7] text-[#6B778C]">
        {icon}
      </div>
      <p className="font-display text-[15px] font-semibold text-[#172B4D]">{title}</p>
      {sub && <p className="mt-1 max-w-sm text-[12px] text-[#6B778C]">{sub}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Shimmer rows for list loading. */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-9 flex-1 rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}
