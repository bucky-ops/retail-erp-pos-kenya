/**
 * Server-side bridge to the live-feed mini-service (mini-services/live-feed).
 * Fire-and-forget POST to the bridge port (3004, localhost only) — a missed
 * realtime push must NEVER fail the business operation, so every error is
 * swallowed on purpose.
 */

const BRIDGE_URL = "http://127.0.0.1:3004/emit";

export function emitLive(event: string, payload: unknown): void {
  try {
    fetch(BRIDGE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, payload }),
      signal: AbortSignal.timeout(1500),
    }).catch(() => {
      /* live feed is best-effort */
    });
  } catch {
    /* never let realtime push break the request */
  }
}
