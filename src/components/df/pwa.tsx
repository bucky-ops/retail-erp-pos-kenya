"use client";

/**
 * PWA plumbing: service-worker registration (with update toast) and the
 * A2HS "install app" prompt hook used by the Settings › Device panel.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Registers /sw.js once and toasts when a new version is waiting. */
export function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "development" && !window.location.search.includes("sw=1")) {
      // Keep dev hot-reload sane: register only when explicitly requested.
      return;
    }
    let reg: ServiceWorkerRegistration | null = null;
    navigator.serviceWorker
      .register("/sw.js")
      .then((r) => {
        reg = r;
        // Poll for a waiting worker → new build is ready to activate.
        r.addEventListener("updatefound", () => {
          const nw = r.installing;
          nw?.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              toast({
                title: "DukaFlow updated 🎉",
                description: "A new version is ready - reload to switch.",
                duration: 8000,
              });
            }
          });
        });
      })
      .catch(() => {
        /* SW is a progressive enhancement - never block the app. */
      });

    const onControllerChange = () => reg?.active?.postMessage("SKIP_WAITING");
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);
  return null;
}

/** Install-prompt state + handler for the A2HS button. */
export function usePwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [swActive, setSwActive] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      toast({ title: "DukaFlow installed 📱", description: "Launch it from your home screen - works offline." });
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    const mq = window.matchMedia("(display-mode: standalone)");
    const syncMode = () => setStandalone(mq.matches);
    syncMode();
    mq.addEventListener?.("change", syncMode);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then(() => setSwActive(true)).catch(() => {});
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      mq.removeEventListener?.("change", syncMode);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "dismissed") setDeferred(null);
    return outcome === "accepted";
  }, [deferred]);

  return { canInstall: !!deferred && !standalone, installed, standalone, swActive, promptInstall };
}
