import { FieldValue, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { isReservable, type MatchableDriver } from '../domain/matching';
import { RIDE_STATUS_TIMESTAMP_FIELD } from '../domain/rideStateMachine';
import type { Actor, RideStatus } from '../domain/types';
import { db } from '../lib/firebase';
import { ts } from '../lib/time';
import { driversCol, usersCol } from './accounts';
import type { DriverDoc, RideDoc } from './models';

export const ridesCol = () => db().collection('rides');
export const rideRef = (rideId: string) => ridesCol().doc(rideId);
export const matchingRef = (rideId: string) => rideRef(rideId).collection('private').doc('matching');
export const traceRef = (rideId: string) => rideRef(rideId).collection('private').doc('trace');

export interface MatchingDoc {
  candidates: string[];
  tried: string[];
  declined: string[];
  timedOut: string[];
  refreshes: number;
  radiusM: number;
}

export function asMatchable(uid: string, d: DriverDoc): MatchableDriver {
  return {
    uid,
    status: d.status,
    accountStatus: d.accountStatus,
    availability: d.availability,
    currentOfferRideId: d.currentOfferRideId,
    currentRideId: d.currentRideId,
    presenceSessionId: d.presenceSessionId,
    eligibility: d.eligibility ? { eligible: d.eligibility.eligible, validUntil: d.eligibility.validUntil } : null,
  };
}

export function driverReservable(uid: string, d: DriverDoc | undefined, nowMs: number): boolean {
  return !!d && isReservable(asMatchable(uid, d), nowMs);
}

/** Whether a driver may keep (or return to) ONLINE after a trip or offer ends. */
export function driverStillEligible(d: DriverDoc, nowMs: number): boolean {
  return (
    d.accountStatus === 'ACTIVE' &&
    d.status === 'APPROVED' &&
    d.eligibility?.eligible === true &&
    (d.eligibility.validUntil == null || d.eligibility.validUntil > nowMs)
  );
}

/** Appends an immutable entry to the ride's status timeline (inside a transaction). */
export function addRideEvent(
  tx: Transaction,
  rideId: string,
  event: { type: string; from: RideStatus | null; to: RideStatus | null; actor: Actor; actorUid: string | null; details?: Record<string, unknown> },
  nowMs: number,
): void {
  tx.set(rideRef(rideId).collection('events').doc(), {
    type: event.type,
    from: event.from,
    to: event.to,
    actor: event.actor,
    actorUid: event.actorUid,
    details: event.details ?? {},
    at: ts(nowMs),
  });
}

/** Ride field updates for entering `status`, including its timestamp field. */
export function statusUpdate(status: RideStatus, nowMs: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const field = RIDE_STATUS_TIMESTAMP_FIELD[status];
  return { status, ...(field ? { [field]: ts(nowMs) } : {}), updatedAt: ts(nowMs), ...extra };
}

/**
 * Driver document updates when an offer or trip ends. Drivers who lost
 * eligibility meanwhile (expired document, suspension) go OFFLINE instead
 * of back into the matching pool. Returns whether presence must be revoked.
 */
export function releaseDriverUpdates(d: DriverDoc, nowMs: number, extra: Record<string, unknown> = {}): { updates: Record<string, unknown>; offline: boolean } {
  const stay = driverStillEligible(d, nowMs);
  return {
    offline: !stay,
    updates: {
      availability: stay ? 'ONLINE' : 'OFFLINE',
      currentOfferRideId: null,
      currentRideId: null,
      ...(stay ? {} : { presenceSessionId: null }),
      availabilityChangedAt: ts(nowMs),
      updatedAt: ts(nowMs),
      ...extra,
    },
  };
}

export function clearPassengerActiveRide(tx: Transaction, passengerUid: string, rideId: string, current: string | null | undefined, nowMs: number) {
  if (current === rideId) tx.update(usersCol().doc(passengerUid), { activeRideId: null, updatedAt: ts(nowMs) });
}

export async function readRide(tx: Transaction, rideId: string): Promise<{ ref: DocumentReference; ride: RideDoc } | null> {
  const ref = rideRef(rideId);
  const snap = await tx.get(ref);
  return snap.exists ? { ref, ride: snap.data() as RideDoc } : null;
}

export async function readDriver(tx: Transaction, uid: string): Promise<{ ref: DocumentReference; driver: DriverDoc | undefined }> {
  const ref = driversCol().doc(uid);
  const snap = await tx.get(ref);
  return { ref, driver: snap.data() as DriverDoc | undefined };
}

export const arrayUnion = FieldValue.arrayUnion;
export const increment = FieldValue.increment;
