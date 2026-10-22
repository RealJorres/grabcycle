import type { Timestamp } from 'firebase/firestore';

export const SERVICE_TZ = 'Asia/Manila';

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });

/** Money is stored as integer centavos everywhere. */
export function formatCentavos(centavos: number | null | undefined): string {
  if (centavos == null || !Number.isFinite(centavos)) return '—';
  return peso.format(centavos / 100);
}

type TimeLike = Timestamp | Date | number | null | undefined;

export function toMillis(t: TimeLike): number | null {
  if (t == null) return null;
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  if (typeof (t as Timestamp).toMillis === 'function') return (t as Timestamp).toMillis();
  return null;
}

const dateTime = new Intl.DateTimeFormat('en-PH', { timeZone: SERVICE_TZ, dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('en-PH', { timeZone: SERVICE_TZ, dateStyle: 'medium' });

/** All times are shown in Philippine time regardless of the reviewer's device. */
export function formatDateTime(t: TimeLike): string {
  const ms = toMillis(t);
  return ms == null ? '—' : dateTime.format(ms);
}

export function formatDate(t: TimeLike): string {
  const ms = toMillis(t);
  return ms == null ? '—' : dateOnly.format(ms);
}

/** "YYYY-MM-DD" calendar dates (document expiry) are shown without timezone shifts. */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—';
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', dateStyle: 'medium' }).format(Date.UTC(y, m - 1, d));
}

export function relativeAge(t: TimeLike, now = Date.now()): string {
  const ms = toMillis(t);
  if (ms == null) return '—';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8).toUpperCase() : '—';
}

/** "+639171234567" → "+63 917 ••• 4567" (staff lists avoid full numbers). */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164 || e164.length < 8) return '—';
  return `${e164.slice(0, 3)} ${e164.slice(3, 6)} ••• ${e164.slice(-4)}`;
}

export function humanize(code: string | null | undefined): string {
  if (!code) return '—';
  const s = code.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
