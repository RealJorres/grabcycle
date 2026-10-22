import { distanceMeters } from '../domain/geo';
import { locationProblem, type LocationRecord } from '../domain/matching';
import { assertRideTransition, SEARCH_RIDE_STATUSES } from '../domain/rideStateMachine';
import type { RideStatus } from '../domain/types';
import { getConfig } from '../lib/configStore';
import { db, rtdb } from '../lib/firebase';
import { log } from '../lib/log';
import { millis, now, ts } from '../lib/time';
import { usersCol } from './accounts';
import { findCandidates } from './discovery';
import type { RideDoc, UserDoc } from './models';
import { notifyUser } from './notifications';
import { revokePresence } from './presence';
import {
  addRideEvent,
  arrayUnion,
  clearPassengerActiveRide,
  driverReservable,
  increment,
  matchingRef,
  readDriver,
  readRide,
  releaseDriverUpdates,
  statusUpdate,
  type MatchingDoc,
} from './rideCommon';

/**
 * Driver matching engine.
 *
 * Concurrency model (see docs/ride-assignment-invariants.md):
 *  - A driver is reserved by a Firestore transaction that reads the ride and
 *    the driver document and writes both. Firestore serializes conflicting
 *    transactions, so two rides can never hold the same driver: the loser
 *    re-reads `currentOfferRideId != null` and skips that driver.
 *  - Every step re-validates current state inside its transaction, so
 *    duplicate triggers (sweeper, passenger refresh, decline) are harmless.
 */

const MAX_ATTEMPTS_PER_CALL = 15;

export async function readLocation(uid: string): Promise<LocationRecord | null> {
  const snap = await rtdb().ref(`locations/${uid}`).once('value');
  return (snap.val() as LocationRecord | null) ?? null;
}

type OfferOutcome = 'OFFERED' | 'SKIPPED' | 'NOT_SEARCHING' | 'EXPIRED';

/**
 * Offers the ride to the next untried candidate. Refreshes the candidate list
 * once it is exhausted (drivers may have come online) and ends the search
 * with NO_DRIVER_FOUND when nobody is left.
 */
export async function offerToNextCandidate(rideId: string): Promise<void> {
  const cfg = await getConfig('matching');
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_CALL; attempt++) {
    const [rideSnap, matchSnap] = await Promise.all([db().collection('rides').doc(rideId).get(), matchingRef(rideId).get()]);
    const ride = rideSnap.data() as RideDoc | undefined;
    if (!ride || !SEARCH_RIDE_STATUSES.includes(ride.status) || ride.offer) return;
    const nowMs = now();
    if (nowMs >= millis(ride.searchDeadline)!) {
      await finishSearch(rideId, 'EXPIRED', 'SEARCH_TIMEOUT');
      return;
    }
    const matching = (matchSnap.data() as MatchingDoc | undefined) ?? { candidates: [], tried: [], declined: [], timedOut: [], refreshes: 0, radiusM: 0 };
    const tried = new Set(matching.tried);
    const next = matching.candidates.find((c) => !tried.has(c));

    if (!next) {
      const fallbackAllowed = ride.mode === 'AUTO' || ride.allowFallback;
      if (fallbackAllowed && matching.refreshes < 3) {
        const search = await findCandidates(ride.pickup, cfg, { exclude: tried });
        const fresh = search.candidates.map((c) => c.uid).filter((uid) => !matching.candidates.includes(uid)).slice(0, cfg.maxCandidates);
        await matchingRef(rideId).set(
          { candidates: [...matching.candidates, ...fresh], refreshes: matching.refreshes + 1, radiusM: search.radiusM },
          { merge: true },
        );
        if (fresh.length > 0) continue;
      }
      const reason = ride.mode === 'SELECTED' && !ride.allowFallback ? 'SELECTED_DRIVER_UNAVAILABLE' : 'NO_ELIGIBLE_DRIVERS';
      await finishSearch(rideId, 'NO_DRIVER_FOUND', reason);
      return;
    }

    // Location freshness is re-checked right before reserving.
    const loc = await readLocation(next);
    const problem = locationProblem(loc, cfg, nowMs);
    const tooFar = !problem && loc ? distanceMeters(ride.pickup, loc) > cfg.maxRadiusM : false;
    if (problem || tooFar) {
      await matchingRef(rideId).set({ tried: arrayUnion(next) }, { merge: true });
      continue;
    }

    const outcome = await tryReserve(rideId, next, cfg.offerTimeoutSec, loc!.sid);
    if (outcome === 'OFFERED') {
      await notifyUser(next, {
        type: 'RIDE_OFFER',
        title: 'New ride request',
        body: 'A passenger nearby is requesting a ride. Open GrabCycle to respond.',
        rideId,
        urgent: true,
        ttlSeconds: cfg.offerTimeoutSec,
      });
      return;
    }
    if (outcome === 'NOT_SEARCHING' || outcome === 'EXPIRED') return;
  }
  log.warn('matching.attempts_exhausted', { rideId });
}

async function tryReserve(rideId: string, driverUid: string, offerTimeoutSec: number, locationSid: string): Promise<OfferOutcome> {
  return db().runTransaction(async (tx) => {
    const r = await readRide(tx, rideId);
    const { ref: driverRef, driver } = await readDriver(tx, driverUid);
    const match = await tx.get(matchingRef(rideId));
    if (!r || !SEARCH_RIDE_STATUSES.includes(r.ride.status) || r.ride.offer) return 'NOT_SEARCHING';
    const nowMs = now();
    if (nowMs >= millis(r.ride.searchDeadline)!) return 'EXPIRED';

    // The reservation check that makes double-booking impossible.
    if (!driverReservable(driverUid, driver, nowMs) || driver!.presenceSessionId !== locationSid) {
      tx.set(matchingRef(rideId), { tried: arrayUnion(driverUid) }, { merge: true });
      return 'SKIPPED';
    }

    const attempt = ((match.data() as MatchingDoc | undefined)?.tried.length ?? 0) + 1;
    if (r.ride.status === 'REQUESTED') assertRideTransition('REQUESTED', 'SEARCHING', 'SYSTEM');
    const offer = { driverId: driverUid, offeredAt: ts(nowMs), expiresAt: ts(nowMs + offerTimeoutSec * 1000), attempt };
    tx.update(r.ref, r.ride.status === 'REQUESTED' ? statusUpdate('SEARCHING', nowMs, { offer }) : { offer, updatedAt: ts(nowMs) });
    tx.update(driverRef, { availability: 'OFFERED', currentOfferRideId: rideId, updatedAt: ts(nowMs) });
    tx.set(matchingRef(rideId), { tried: arrayUnion(driverUid) }, { merge: true });
    addRideEvent(tx, rideId, { type: 'OFFER_SENT', from: r.ride.status, to: 'SEARCHING', actor: 'SYSTEM', actorUid: null, details: { attempt } }, nowMs);
    return 'OFFERED';
  });
}

/** Ends an unsuccessful search, releasing any outstanding offer. */
export async function finishSearch(rideId: string, status: Extract<RideStatus, 'NO_DRIVER_FOUND' | 'EXPIRED'>, reason: string): Promise<boolean> {
  let passengerUid: string | null = null;
  let revokeDriver: string | null = null;
  const done = await db().runTransaction(async (tx) => {
    const r = await readRide(tx, rideId);
    if (!r || !SEARCH_RIDE_STATUSES.includes(r.ride.status)) return false;
    const offered = r.ride.offer?.driverId ?? null;
    const driverRead = offered ? await readDriver(tx, offered) : null;
    const user = (await tx.get(usersCol().doc(r.ride.passengerUid))).data() as UserDoc | undefined;
    const nowMs = now();
    assertRideTransition(r.ride.status, status, 'SYSTEM');
    tx.update(r.ref, statusUpdate(status, nowMs, { offer: null, statusReason: reason }));
    if (driverRead?.driver?.currentOfferRideId === rideId) {
      const { updates, offline } = releaseDriverUpdates(driverRead.driver, nowMs);
      tx.update(driverRead.ref, updates);
      if (offline) revokeDriver = offered;
    }
    clearPassengerActiveRide(tx, r.ride.passengerUid, rideId, user?.activeRideId, nowMs);
    addRideEvent(tx, rideId, { type: status, from: r.ride.status, to: status, actor: 'SYSTEM', actorUid: null, details: { reason } }, nowMs);
    passengerUid = r.ride.passengerUid;
    return true;
  });
  if (revokeDriver) await revokePresence(revokeDriver);
  if (done && passengerUid) {
    await notifyUser(passengerUid, {
      type: 'NO_DRIVER_FOUND',
      title: 'No driver available',
      body: 'We could not find a driver for your request. Please try again.',
      rideId,
    });
  }
  return done;
}

/**
 * Expires an unanswered offer (server-enforced acceptance window) and moves
 * on. Drivers who repeatedly ignore offers are taken offline so passengers
 * are not kept waiting on unresponsive devices.
 */
export async function expireOfferIfDue(rideId: string): Promise<boolean> {
  const cfg = await getConfig('matching');
  let expiredDriver: string | null = null;
  let wentOffline = false;
  let ride: RideDoc | null = null;
  const expired = await db().runTransaction(async (tx) => {
    const r = await readRide(tx, rideId);
    if (!r || r.ride.status !== 'SEARCHING' || !r.ride.offer) return false;
    const nowMs = now();
    if (nowMs < millis(r.ride.offer.expiresAt)!) return false;
    const { ref: driverRef, driver } = await readDriver(tx, r.ride.offer.driverId);
    if (driver?.currentOfferRideId === rideId) {
      const missed = (driver.missedOffers ?? 0) + 1;
      const tooMany = missed >= cfg.missedOffersBeforeOffline;
      const { updates, offline } = releaseDriverUpdates(driver, nowMs, { missedOffers: tooMany ? 0 : missed });
      if (tooMany) Object.assign(updates, { availability: 'OFFLINE', presenceSessionId: null });
      tx.update(driverRef, updates);
      wentOffline = tooMany || offline;
    }
    tx.update(r.ref, { offer: null, updatedAt: ts(nowMs) });
    tx.set(matchingRef(rideId), { timedOut: arrayUnion(r.ride.offer.driverId) }, { merge: true });
    addRideEvent(tx, rideId, { type: 'OFFER_EXPIRED', from: 'SEARCHING', to: 'SEARCHING', actor: 'SYSTEM', actorUid: null, details: { attempt: r.ride.offer.attempt } }, nowMs);
    expiredDriver = r.ride.offer.driverId;
    ride = r.ride;
    return true;
  });
  if (!expired) return false;
  if (expiredDriver) {
    if (wentOffline) await revokePresence(expiredDriver);
    await notifyUser(expiredDriver, {
      type: 'OFFER_EXPIRED',
      title: wentOffline ? 'You are now offline' : 'Ride request expired',
      body: wentOffline ? 'You missed several ride requests, so we set you offline. Go online again when ready.' : 'The ride request was passed to another driver.',
      rideId,
    });
  }
  await continueAfterRelease(rideId, ride!, 'SELECTED_DRIVER_DID_NOT_RESPOND');
  return true;
}

/** A driver declines (or goes offline with) an outstanding offer. */
export async function declineOffer(driverUid: string, rideId: string, reason: string): Promise<boolean> {
  let ride: RideDoc | null = null;
  let revoke = false;
  const declined = await db().runTransaction(async (tx) => {
    const r = await readRide(tx, rideId);
    const { ref: driverRef, driver } = await readDriver(tx, driverUid);
    if (!r || r.ride.status !== 'SEARCHING' || r.ride.offer?.driverId !== driverUid) return false;
    const nowMs = now();
    tx.update(r.ref, { offer: null, updatedAt: ts(nowMs) });
    if (driver?.currentOfferRideId === rideId) {
      const goingOffline = reason === 'DRIVER_WENT_OFFLINE';
      const { updates, offline } = releaseDriverUpdates(driver, nowMs, { missedOffers: 0, 'stats.declinedOffers': increment(1) });
      if (goingOffline) Object.assign(updates, { availability: 'OFFLINE', presenceSessionId: null });
      tx.update(driverRef, updates);
      revoke = offline || goingOffline;
    }
    tx.set(matchingRef(rideId), { declined: arrayUnion(driverUid) }, { merge: true });
    addRideEvent(tx, rideId, { type: 'OFFER_DECLINED', from: 'SEARCHING', to: 'SEARCHING', actor: 'DRIVER', actorUid: driverUid, details: { reason } }, nowMs);
    ride = r.ride;
    return true;
  });
  if (!declined) return false;
  if (revoke) await revokePresence(driverUid);
  await continueAfterRelease(rideId, ride!, 'SELECTED_DRIVER_DECLINED');
  return true;
}

async function continueAfterRelease(rideId: string, ride: RideDoc, selectedReason: string): Promise<void> {
  if (ride.mode === 'SELECTED' && !ride.allowFallback) {
    await finishSearch(rideId, 'NO_DRIVER_FOUND', selectedReason);
  } else {
    await offerToNextCandidate(rideId);
  }
}

/**
 * Idempotent progress check used by the passenger's polling, the scheduled
 * sweeper and notification handlers: expires due offers, enforces the search
 * deadline and resumes a stalled search.
 */
export async function advanceRide(rideId: string): Promise<void> {
  const snap = await db().collection('rides').doc(rideId).get();
  const ride = snap.data() as RideDoc | undefined;
  if (!ride || !SEARCH_RIDE_STATUSES.includes(ride.status)) return;
  const nowMs = now();
  if (nowMs >= millis(ride.searchDeadline)!) {
    await finishSearch(rideId, 'EXPIRED', 'SEARCH_TIMEOUT');
    return;
  }
  if (ride.offer) {
    if (nowMs >= millis(ride.offer.expiresAt)!) await expireOfferIfDue(rideId);
    return;
  }
  // No outstanding offer: resume matching if it stalled (e.g. instance crash).
  if (nowMs - (millis(ride.updatedAt) ?? 0) > 5_000) await offerToNextCandidate(rideId);
}

