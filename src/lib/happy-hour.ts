/**
 * Happy Hour auto-pricing — shared window logic (client + server).
 * The window supports overnight spans (e.g. 22:00 → 02:00) and is evaluated
 * in the till's local time (the server and tills run on the same clock in a
 * single-shop deployment; multi-timezone shops would send the offset along).
 */

export interface HappyHourConfig {
  happyHourEnabled: boolean;
  happyHourStart: string; // "HH:mm"
  happyHourEnd: string; // "HH:mm"
  happyHourPercent: number;
  happyHourCategory: string; // "All" | category name
}

/** Parse "HH:mm" → minutes-of-day, or null when malformed. */
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm?.trim() ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function isHappyHourActive(cfg: HappyHourConfig | null | undefined, at: Date = new Date()): boolean {
  if (!cfg?.happyHourEnabled || !(cfg.happyHourPercent > 0)) return false;
  const start = toMinutes(cfg.happyHourStart);
  const end = toMinutes(cfg.happyHourEnd);
  if (start === null || end === null) return false;
  const now = at.getHours() * 60 + at.getMinutes();
  // Overnight window (start > end) wraps past midnight.
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

/** Does a product category qualify for the active happy hour? */
export function happyHourMatchesCategory(cfg: HappyHourConfig, category: string): boolean {
  const c = cfg.happyHourCategory?.trim();
  return !c || c === "All" || c.toLowerCase() === (category ?? "").toLowerCase();
}

/** Human label like "14:00–16:00" for banners and receipts. */
export function happyHourLabel(cfg: HappyHourConfig): string {
  return `${cfg.happyHourStart}–${cfg.happyHourEnd}`;
}
