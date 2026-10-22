import { Timestamp } from 'firebase-admin/firestore';

/**
 * Server clock. Business logic reads time only through `now()` so tests can
 * simulate expiry windows deterministically. Production always uses the
 * trusted server clock; clients never supply authoritative timestamps.
 */
let clock: () => number = () => Date.now();

export function now(): number {
  return clock();
}

export function nowTs(): Timestamp {
  return Timestamp.fromMillis(clock());
}

export function ts(millis: number): Timestamp {
  return Timestamp.fromMillis(millis);
}

export function millis(value: Timestamp | number | null | undefined): number | null {
  if (value == null) return null;
  return typeof value === 'number' ? value : value.toMillis();
}

/** Test hook. Never called from production code paths. */
export function setClockForTesting(fn: (() => number) | null): void {
  clock = fn ?? (() => Date.now());
}
