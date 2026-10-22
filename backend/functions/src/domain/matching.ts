import type { MatchingConfig } from './config';
import { distanceMeters, isValidLatLng } from './geo';
import type { AccountStatus, Availability, DriverStatus, LatLng } from './types';

/**
 * Pure candidate filtering and ranking for nearby-driver discovery and
 * automatic matching. The service layer supplies raw location records and
 * authoritative driver documents; nothing here trusts client-side flags.
 */

/** Current driver location as stored in RTDB `/locations/{uid}`. */
export interface LocationRecord {
  lat: number;
  lng: number;
  /** Horizontal accuracy radius, meters. */
  acc: number;
  /** Server timestamp (enforced by RTDB rules), epoch millis. */
  ts: number;
  /** Client capture time (server-time corrected); rules reject values far from server time. */
  cts?: number;
  /** Presence session id the location was published under. */
  sid: string;
  g: string;
  hdg?: number;
  spd?: number;
  mock?: boolean;
}

/** Authoritative fields from Firestore `drivers/{uid}` needed for matching. */
export interface MatchableDriver {
  uid: string;
  status: DriverStatus;
  accountStatus: AccountStatus;
  availability: Availability;
  currentOfferRideId: string | null;
  currentRideId: string | null;
  presenceSessionId: string | null;
  eligibility: { eligible: boolean; validUntil: number | null } | null;
}

export type LocationProblem = 'MISSING' | 'MALFORMED' | 'STALE' | 'INACCURATE' | 'MOCK';

export function locationProblem(
  loc: Partial<LocationRecord> | null | undefined,
  cfg: Pick<MatchingConfig, 'locationFreshnessSec' | 'maxLocationAccuracyM' | 'rejectMockLocations'>,
  nowMs: number,
): LocationProblem | null {
  if (!loc) return 'MISSING';
  if (!isValidLatLng({ lat: loc.lat, lng: loc.lng }) || typeof loc.ts !== 'number' || typeof loc.acc !== 'number') {
    return 'MALFORMED';
  }
  // Timestamps from the future (clock skew beyond 5 s) are treated as malformed.
  if (loc.ts > nowMs + 5_000) return 'MALFORMED';
  if (nowMs - loc.ts > cfg.locationFreshnessSec * 1000) return 'STALE';
  if (loc.acc > cfg.maxLocationAccuracyM) return 'INACCURATE';
  if (cfg.rejectMockLocations && loc.mock === true) return 'MOCK';
  return null;
}

/** Whether a driver may receive a NEW offer right now (location checked separately). */
export function isReservable(driver: MatchableDriver, nowMs: number): boolean {
  return (
    driver.accountStatus === 'ACTIVE' &&
    driver.status === 'APPROVED' &&
    driver.availability === 'ONLINE' &&
    driver.currentOfferRideId == null &&
    driver.currentRideId == null &&
    driver.eligibility?.eligible === true &&
    (driver.eligibility.validUntil == null || driver.eligibility.validUntil > nowMs)
  );
}

export interface RankedCandidate {
  uid: string;
  distanceM: number;
  locationAgeSec: number;
  location: LatLng;
  accuracyM: number;
}

export function rankCandidates(
  pickup: LatLng,
  locations: ReadonlyArray<{ uid: string; loc: LocationRecord }>,
  drivers: ReadonlyMap<string, MatchableDriver>,
  cfg: Pick<MatchingConfig, 'locationFreshnessSec' | 'maxLocationAccuracyM' | 'rejectMockLocations'>,
  radiusM: number,
  nowMs: number,
  exclude: ReadonlySet<string> = new Set(),
): RankedCandidate[] {
  const seen = new Set<string>();
  const out: RankedCandidate[] = [];
  for (const { uid, loc } of locations) {
    if (seen.has(uid) || exclude.has(uid)) continue;
    seen.add(uid);
    if (locationProblem(loc, cfg, nowMs)) continue;
    const driver = drivers.get(uid);
    if (!driver || !isReservable(driver, nowMs)) continue;
    // A location left over from an earlier online session is not trusted.
    if (!driver.presenceSessionId || loc.sid !== driver.presenceSessionId) continue;
    const d = distanceMeters(pickup, loc);
    // Geohash ranges over-select; filter false positives by true distance.
    if (d > radiusM) continue;
    out.push({
      uid,
      distanceM: d,
      locationAgeSec: Math.max(0, Math.round((nowMs - loc.ts) / 1000)),
      location: { lat: loc.lat, lng: loc.lng },
      accuracyM: loc.acc,
    });
  }
  // Documented ranking policy: nearest first, then freshest location, then uid for determinism.
  out.sort((a, b) => a.distanceM - b.distanceM || a.locationAgeSec - b.locationAgeSec || a.uid.localeCompare(b.uid));
  return out;
}

/** Radius schedule for controlled expansion: initial, +step, ... up to max. */
export function radiusSchedule(cfg: Pick<MatchingConfig, 'initialRadiusM' | 'radiusStepM' | 'maxRadiusM'>): number[] {
  const radii: number[] = [];
  for (let r = cfg.initialRadiusM; r < cfg.maxRadiusM; r += cfg.radiusStepM) radii.push(r);
  radii.push(cfg.maxRadiusM);
  return radii;
}
