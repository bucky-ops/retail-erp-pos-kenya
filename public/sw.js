/**
 * DukaFlow service worker — the offline shell for the offline-first POS.
 *
 * Strategy:
 *  - Navigations (the single `/` route): network-first, fall back to the cached
 *    shell so the app still boots with zero connectivity (IndexedDB queue takes
 *    over for sales — see src/lib/offline.ts).
 *  - Static assets (`/_next/static`, `/icons`, fonts): cache-first — they are
 *    content-hashed in production, so cache hits are always correct.
 *  - `/api/*`: NEVER cached. POS data must be live; offline sales are queued
 *    client-side and replayed by the sync engine.
 */

const VERSION = "dukaflow-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([SHELL_URL, "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Same-origin only; never touch API traffic.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // App navigations → network-first, cached shell as the offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(SHELL_URL, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.open(SHELL_CACHE).then((c) => c.match(SHELL_URL)))
    );
    return;
  }

  // Immutable-ish assets → cache-first.
  const cacheable =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.svg" ||
    url.pathname === "/logo.svg" ||
    url.pathname === "/manifest.webmanifest";

  if (cacheable && (req.destination === "style" || req.destination === "script" || req.destination === "image" || req.destination === "font" || req.destination === "")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return hit ?? Response.error();
        }
      })
    );
  }
});
