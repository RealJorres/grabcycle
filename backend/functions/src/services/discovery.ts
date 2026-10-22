import { geohashQueryBounds } from 'geofire-common';
import type { MatchingConfig } from '../domain/config';
import { fail } from '../domain/errors';
import { coarsen, roundDistanceForDisplay } from '../domain/geo';
import { radiusSchedule, rankCandidates, type LocationRecord, type MatchableDriver, type RankedCandidate } from '../domain/matching';
import { isPassengerApprovedForBooking } from '../domain/passengerVerification';
import { isInServiceArea } from '../domain/serviceArea';
import type { LatLng } from '../domain/types';
import { getConfig } from '../lib/configStore';
import type { CallerContext } from '../lib/context';
import { db, rtdb } from '../lib/firebase';
import { enforceRateLimit } from '../lib/rateLimit';
import { now } from '../lib/time';
import { driversCol, requireActiveUser } from './accounts';
import type { DriverDoc } from './models';

/**
 * Nearby-driver discovery.
 *
 * 1. Geohash range queries over RTDB `/locations` (all neighbouring ranges
 *    returned by geohashQueryBounds — a single prefix is not a circle).
 * 2. De-duplicate and drop stale / inaccurate / mock locations.
 * 3. Join with authoritative Firestore driver records (eligibility,
 *    availability, presence session) — client flags are never trusted.
 * 4. Filter false positives by true great-circle distance and rank.
 */

export async function queryLocations(center: LatLng, radiusM: number): Promise<Array<{ uid: string; loc: LocationRecord }>> {
  const bounds = geohashQueryBounds([center.lat, center.lng], radiusM);
  const snaps = await Promise.all(
    bounds.map(([start, end]) => rtdb().ref('locations').orderByChild('g').startAt(start).endAt(end).once('value')),
  );
  const out: Array<{ uid: string; loc: LocationRecord }> = [];
  for (const snap of snaps) {
    snap.forEach((child) => {
      out.push({ uid: child.key!, loc: child.val() as LocationRecord });
      return false;
    });
  }
  return out;
}

export type DriverWithDoc = MatchableDriver & { doc: DriverDoc };

export async function loadDrivers(uids: string[]): Promise<Map<string, DriverWithDoc>> {
  const map = new Map<string, DriverWithDoc>();
  const unique = [...new Set(uids)];
  for (let i = 0; i < unique.length; i += 100) {
    const refs = unique.slice(i, i + 100).map((uid) => driversCol().doc(uid));
    if (refs.length === 0) continue;
    const snaps = await db().getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const d = snap.data() as DriverDoc;
      map.set(snap.id, {
        uid: snap.id,
        status: d.status,
        accountStatus: d.accountStatus,
        availability: d.availability,
        currentOfferRideId: d.currentOfferRideId,
        currentRideId: d.currentRideId,
        presenceSessionId: d.presenceSessionId,
        eligibility: d.eligibility ? { eligible: d.eligibility.eligible, validUntil: d.eligibility.validUntil } : null,
        doc: d,
      });
    }
  }
  return map;
}

export interface CandidateSearch {
  candidates: Array<RankedCandidate & { driver: DriverWithDoc }>;
  radiusM: number;
  maxRadiusReached: boolean;
}

/**
 * Finds reservable drivers near `pickup`, expanding the radius step by step
 * (initial → +step → … → max) until at least one candidate is found.
 * One RTDB query at the largest radius serves every step.
 */
export async function findCandidates(
  pickup: LatLng,
  cfg: MatchingConfig,
  opts: { minRadiusM?: number; exclude?: ReadonlySet<string>; nowMs?: number } = {},
): Promise<CandidateSearch> {
  const nowMs = opts.nowMs ?? now();
  const schedule = radiusSchedule(cfg).filter((r) => r >= (opts.minRadiusM ?? 0));
  const maxRadius = schedule.at(-1) ?? cfg.maxRadiusM;
  const locations = await queryLocations(pickup, maxRadius);
  const drivers = await loadDrivers(locations.map((l) => l.uid));
  const ranked = rankCandidates(pickup, locations, drivers, cfg, maxRadius, nowMs, opts.exclude);
  for (const radiusM of schedule) {
    const within = ranked.filter((c) => c.distanceM <= radiusM);
    if (within.length > 0 || radiusM === maxRadius) {
      return {
        candidates: within.map((c) => ({ ...c, driver: drivers.get(c.uid)! })),
        radiusM,
        maxRadiusReached: radiusM === maxRadius,
      };
    }
  }
  return { candidates: [], radiusM: maxRadius, maxRadiusReached: true };
}

export function ratingAverage(summary: { count: number; sum: number } | undefined, minCount: number): number | null {
  if (!summary || summary.count < minCount) return null;
  return Math.round((summary.sum / summary.count) * 10) / 10;
}

/**
 * Passenger-facing discovery. Only approved passengers may look up drivers,
 * and only coarse positions are disclosed (no plate numbers, no exact
 * coordinates) until a trip is accepted.
 */
export async function findNearbyDrivers(ctx: CallerContext, input: { pickup: LatLng; expand: boolean }) {
  const user = await requireActiveUser(ctx.uid, 'PASSENGER');
  if (!isPassengerApprovedForBooking(user.passengerVerification, now())) {
    throw fail.precondition('PASSENGER_NOT_VERIFIED', 'Your identity verification must be approved before you can see nearby drivers.');
  }
  await enforceRateLimit(ctx.uid, 'discovery');
  const [area, cfg, policies] = await Promise.all([getConfig('serviceArea'), getConfig('matching'), getConfig('policies')]);
  if (!isInServiceArea(area, input.pickup)) {
    throw fail.precondition('OUTSIDE_SERVICE_AREA', 'This pickup point is outside the GrabCycle service area.', { which: 'PICKUP' });
  }

  const search = await findCandidates(input.pickup, cfg, { minRadiusM: input.expand ? cfg.maxRadiusM : 0 });
  const drivers = search.candidates.slice(0, cfg.maxDiscoveryResults).map((c) => ({
    driverId: c.uid,
    displayName: c.driver.doc.publicProfile.displayName,
    photoPath: c.driver.doc.publicProfile.photoPath,
    vehicleSummary: c.driver.doc.publicProfile.vehicleSummary,
    approxLocation: coarsen(c.location),
    distanceMeters: roundDistanceForDisplay(c.distanceM),
    distanceKind: 'STRAIGHT_LINE' as const,
    ratingAverage: ratingAverage(c.driver.doc.ratingSummary, policies.ratings.minRatingsToDisplay),
    ratingCount: c.driver.doc.ratingSummary.count >= policies.ratings.minRatingsToDisplay ? c.driver.doc.ratingSummary.count : null,
    locationAgeSec: c.locationAgeSec,
  }));
  return {
    drivers,
    radiusMeters: search.radiusM,
    maxRadiusReached: search.maxRadiusReached,
    generatedAt: now(),
    refreshAfterSec: Math.max(5, Math.floor(cfg.locationFreshnessSec / 2)),
  };
}
