/**
 * Calendar helpers anchored to the service timezone (Asia/Manila, UTC+08:00,
 * no daylight saving). Document expiry dates are stored as `YYYY-MM-DD`
 * strings and are valid through the END of that local day.
 */

export const SERVICE_UTC_OFFSET_MINUTES = 8 * 60;
const OFFSET_MS = SERVICE_UTC_OFFSET_MINUTES * 60_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDateString(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Local calendar date (YYYY-MM-DD) in the service timezone for an instant. */
export function localDateString(nowMs: number): string {
  return new Date(nowMs + OFFSET_MS).toISOString().slice(0, 10);
}

/** Local hour of day (0-23) in the service timezone. */
export function localHour(nowMs: number): number {
  return new Date(nowMs + OFFSET_MS).getUTCHours();
}

/** Epoch millis of the first instant AFTER the given local date ends. */
export function endOfLocalDayMillis(date: string): number {
  if (!isValidDateString(date)) throw new Error(`Invalid date: ${date}`);
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, mo - 1, d + 1) - OFFSET_MS;
}

/** True when a document dated `expiryDate` is still valid at `nowMs`. */
export function isDateStillValid(expiryDate: string, nowMs: number): boolean {
  return endOfLocalDayMillis(expiryDate) > nowMs;
}

/** Whole days remaining until the expiry date ends (negative when expired). */
export function daysUntilExpiry(expiryDate: string, nowMs: number): number {
  return Math.floor((endOfLocalDayMillis(expiryDate) - nowMs) / 86_400_000);
}
