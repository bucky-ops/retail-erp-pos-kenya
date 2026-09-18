"use client";

import { cn } from "@/lib/utils";

/** DukaFlow "D" mark - shopping bag + upward arrow + barcode lines + location pin dot. */
export function DukaMark({
  color = "#0052CC",
  accent = "#00C853",
  white = false,
  className,
}: {
  color?: string;
  accent?: string;
  white?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("h-full w-full", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M7 5.5C7 4.67157 7.67157 4 8.5 4H16.2C22.5 4 27 8.8 27 16C27 23.2 22.5 28 16.2 28H8.5C7.67157 28 7 27.3284 7 26.5V5.5Z"
        fill={white ? "white" : color}
        stroke={white ? "white" : color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <g opacity={white ? 0.28 : 1}>
        <rect x="12.5" y="9.5" width="1.8" height="13" rx="0.9" fill="white" opacity={0.9} />
        <rect x="15.2" y="9.5" width="1.8" height="13" rx="0.9" fill="white" opacity={0.6} />
        <rect x="17.9" y="9.5" width="1.8" height="8" rx="0.9" fill={accent} />
      </g>
      <path d="M13 7.2L16 4L19 7.2" stroke={white ? "white" : accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 4V11.5" stroke={white ? "white" : accent} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16.5" cy="22.2" r="1.8" fill={white ? "#0052CC" : "white"} opacity={0.95} />
    </svg>
  );
}

/** Logo lockup with variants used across sidebar, login, POS dock and receipts. */
export function Logo({
  variant = "full",
  size,
  className,
}: {
  variant?: "full" | "icon" | "white" | "favicon";
  size?: number;
  className?: string;
}) {
  if (variant === "icon") {
    return (
      <div
        className={cn("flex items-center justify-center rounded-[14px] shadow-sm", className)}
        style={{ width: size || 56, height: size || 56, background: "#0052CC" }}
      >
        <div className="h-[62%] w-[62%]">
          <DukaMark white />
        </div>
      </div>
    );
  }
  if (variant === "favicon") {
    return (
      <div
        className={cn("flex items-center justify-center rounded-[7px]", className)}
        style={{ width: 32, height: 32, background: "#0052CC" }}
      >
        <div className="h-[68%] w-[68%]">
          <DukaMark white />
        </div>
      </div>
    );
  }
  if (variant === "white") {
    return (
      <div className={cn("flex items-center gap-[10px]", className)}>
        <div style={{ width: size ? size * 0.9 : 34, height: size ? size * 0.9 : 34 }}>
          <DukaMark white color="white" accent="white" />
        </div>
        <span className="font-display tracking-tight" style={{ fontSize: size ? size * 0.62 : 20 }}>
          <span className="font-bold text-white">Duka</span>
          <span className="font-normal text-white/90">Flow</span>
        </span>
      </div>
    );
  }
  return (
    <div className={cn("flex items-center gap-[11px]", className)}>
      <div style={{ width: size ? size * 0.92 : 36, height: size ? size * 0.92 : 36 }}>
        <DukaMark />
      </div>
      <span className="font-display tracking-tight" style={{ fontSize: size ? size * 0.64 : 22 }}>
        <span className="font-extrabold" style={{ color: "#172B4D" }}>
          Duka
        </span>
        <span className="font-normal" style={{ color: "#0052CC" }}>
          Flow
        </span>
      </span>
    </div>
  );
}
