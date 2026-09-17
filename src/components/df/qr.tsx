"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Renders a real QR code (server-generated PNG data URL). */
export function QrImage({
  text,
  size = 120,
  className,
  alt = "QR code",
}: {
  text: string;
  size?: number;
  className?: string;
  alt?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<{ dataUrl: string }>(`/api/qr?text=${encodeURIComponent(text)}&width=${size * 2}`)
      .then((d) => alive && setSrc(d.dataUrl))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [text, size]);

  if (!src) {
    return <Skeleton className={cn("rounded-lg", className)} style={{ width: size, height: size }} />;
  }
  return <img src={src} alt={alt} width={size} height={size} className={cn("rounded-lg", className)} />;
}
