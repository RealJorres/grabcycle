import { computeWaitingFee, validateAdjustments, type FareAdjustmentInput, type FareLine } from '../domain/fare';
import { fail } from '../domain/errors';
import { distanceMeters } from '../domain/geo';
import { isReservable, locationProblem } from '../domain/matching';
import { isPassengerApprovedForBooking } from '../domain/passengerVerification';
import { cashOutcome } from '../domain/payment';
import { assertRideTransition, isAssignedRideStatus, isTerminalRideStatus } from '../domain/rideStateMachine';
import { isInServiceArea, isWithinOperatingHours } from '../domain/serviceArea';
import type { Actor, RideStatus } from '../domain/types';
import { writeAudit } from '../lib/audit';
import { getConfig, getFareConfigVersion } from '../lib/configStore';
import type { CallerContext } from '../lib/context';
import { db } from '../lib/firebase';
import { rideIdFor } from '../lib/ids';
import { hasPermission } from '../lib/permissions';
import { enforceRateLimit } from '../lib/rateLimit';
import { millis, now, ts } from '../lib/time';
import { assertActive, requireActiveUser, usersCol } from './accounts';
import { findCandidates, loadDrivers, ratingAverage } from './discovery';
import { maps } from './maps';
import type { PaymentDoc, RideDoc, UserDoc } from './models';
import { notifyUser } from './notifications';
import { revokePresence, setTrackingPassenger } from './presence';
import { loadValidQuote } from './quotes';
import {
  addRideEvent,
  arrayUnion,
  clearPassengerActiveRide,
  increment,
  matchingRef,
  readDriver,
  readRide,
  releaseDriverUpdates,
  rideRef,
  statusUpdate,
  traceRef,
  driverStillEligible,
} from './rideCommon';
import { advanceRide, declineOffer, expireOfferIfDue, offerToNextCandidate, readLocation } from './rideMatching';

/**
 * Ride lifecycle. The backend is authoritative for every transition; the
 * Android app only requests actions and renders the resulting state.
 */

export const paymentsCol = () => db().collection('payments');

export function rideSummary(ride: RideDoc) {
  return {
    rideId: ride.rideId,
    status: ride.status,
    statusReason: ride.statusReason,
    offerExpiresAt: ride.offer ? millis(ride.offer.expiresAt) : null,
    driver: ride.driver,
    quoteTotal: ride.quote.total,
    finalTotal: ride.finalFare?.total ?? null,
    paymentStatus: ride.payment.status,
  };
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export interface CreateRideInput {
  requestId: string;
  quoteId: string;
  selectedDriverId: string | null;
  allowFallback: boolean;
  pickupNote: string | null;
}

export async function createRide(ctx: CallerContext, input: CreateRideInput) {
  const rideId = rideIdFor(ctx.uid, input.requestId);
  // Idempotency: a retried request returns the ride it already created.
  const existing = await rideRef(rideId).get();
  if (existing.exists) return rideSummary(existing.data() as RideDoc);

  const user = await requireActiveUser(ctx.uid, 'PASSENGER');
  if (!isPassengerApprovedForBooking(user.passengerVerification, now())) {
    throw fail.precondition('PASSENGER_NOT_VERIFIED', 'Your identity verification must be approved before you can book a ride.', {
      verificationStatus: user.passengerVerification?.status ?? 'NOT_SUBMITTED',
    });
  }
  await enforceRateLimit(ctx.uid, 'createRide');
  const [area, cfg, policies] = await Promise.all([getConfig('serviceArea'), getConfig('matching'), getConfig('policies')]);
  const quote = await loadValidQuote(ctx.uid, input.quoteId);
  if (!isInServiceArea(area, quote.pickup) || !isInServiceArea(area, quote.destination)) {
    throw fail.precondition('OUTSIDE_SERVICE_AREA', 'This trip is outside the GrabCycle service area.');
  }
  if (!isWithinOperatingHours(area, now())) throw fail.precondition('SERVICE_CLOSED', 'GrabCycle is closed at this hour.');

  // Candidate selection happens before the booking transaction; every
  // candidate is re-validated inside its own reservation transaction.
  let candidates: string[];
  let radiusM = cfg.maxRadiusM;
  const nowMs = now();
  if (input.selectedDriverId) {
    const sel = input.selectedDriverId;
    const [drivers, loc] = await Promise.all([loadDrivers([sel]), readLocation(sel)]);
    const d = drivers.get(sel);
    const usable =
      d && isReservable(d, nowMs) && !locationProblem(loc, cfg, nowMs) && loc!.sid === d.presenceSessionId && distanceMeters(quote.pickup, loc!) <= cfg.maxRadiusM;
    if (!usable) {
      throw fail.precondition('DRIVER_UNAVAILABLE', 'That driver is no longer available. Please choose another driver.', { driverId: sel });
    }
    candidates = [sel];
    if (input.allowFallback) {
      const search = await findCandidates(quote.pickup, cfg, { exclude: new Set([sel]) });
      candidates.push(...search.candidates.map((c) => c.uid).slice(0, cfg.maxCandidates - 1));
    }
  } else {
    const search = await findCandidates(quote.pickup, cfg);
    if (search.candidates.length === 0) {
      throw fail.precondition('NO_DRIVERS_AVAILABLE', 'No drivers are available near your pickup point right now.', {
        radiusMeters: search.radiusM,
      });
    }
    candidates = search.candidates.slice(0, cfg.maxCandidates).map((c) => c.uid);
    radiusM = search.radiusM;
  }

  const created = await db().runTransaction(async (tx) => {
    const ref = rideRef(rideId);
    if ((await tx.get(ref)).exists) return false;
    const fresh = assertActive(((await tx.get(usersCol().doc(ctx.uid))).data() as UserDoc | undefined) ?? null, 'PASSENGER');
    const t = now();
    if (!isPassengerApprovedForBooking(fresh.passengerVerification, t)) {
      throw fail.precondition('PASSENGER_NOT_VERIFIED', 'Your identity verification must be approved before you can book a ride.');
    }
    if (fresh.activeRideId) {
      const active = (await tx.get(rideRef(fresh.activeRideId))).data() as RideDoc | undefined;
      if (active && !isTerminalRideStatus(active.status)) {
        throw fail.precondition('ACTIVE_RIDE_EXISTS', 'You already have an active ride.', { rideId: fresh.activeRideId });
      }
    }
    const ride: RideDoc = {
      rideId,
      requestId: input.requestId,
      passengerUid: ctx.uid,
      driverUid: null,
      status: 'REQUESTED',
      statusReason: null,
      mode: input.selectedDriverId ? 'SELECTED' : 'AUTO',
      allowFallback: input.selectedDriverId ? input.allowFallback : true,
      selectedDriverId: input.selectedDriverId,
      pickup: { ...quote.pickup, ...(input.pickupNote ? { note: input.pickupNote } : {}) },
      destination: quote.destination,
      quote: {
        quoteId: quote.quoteId,
        total: quote.total,
        currency: quote.currency,
        lines: quote.lines,
        fareVersion: quote.fareVersion,
        fareIsSample: quote.fareIsSample,
        distanceMeters: quote.distanceMeters,
        distanceSource: quote.distanceSource,
        durationSeconds: quote.durationSeconds,
        passengers: quote.passengers,
      },
      offer: null,
      searchDeadline: ts(t + cfg.searchTimeoutSec * 1000),
      passenger: { firstName: fresh.firstName, ratingAvg: ratingAverage(fresh.ratingSummary, policies.ratings.minRatingsToDisplay) },
      driver: null,
      driverEtaSeconds: null,
      finalFare: null,
      payment: { method: 'CASH', status: 'UNPAID' },
      cancellation: null,
      rated: { byPassenger: false, byDriver: false },
      requestedAt: ts(t),
      updatedAt: ts(t),
    };
    tx.set(ref, ride);
    tx.set(matchingRef(rideId), { candidates, tried: [], declined: [], timedOut: [], refreshes: 0, radiusM });
    tx.update(usersCol().doc(ctx.uid), { activeRideId: rideId, updatedAt: ts(t) });
    addRideEvent(tx, rideId, { type: 'REQUESTED', from: null, to: 'REQUESTED', actor: 'PASSENGER', actorUid: ctx.uid, details: { mode: ride.mode } }, t);
    return true;
  });

  if (created) await offerToNextCandidate(rideId);
  return rideSummary((await rideRef(rideId).get()).data() as RideDoc);
}

/** Passenger/driver polling hook: advances expired offers and stale searches. */
export async function refreshRide(ctx: CallerContext, input: { rideId: string }) {
  const snap = await rideRef(input.rideId).get();
  const ride = snap.data() as RideDoc | undefined;
  if (!ride) throw fail.notFound('Ride');
  const isParticipant = ride.passengerUid === ctx.uid || ride.driverUid === ctx.uid || ride.offer?.driverId === ctx.uid;
  if (!isParticipant && !hasPermission(ctx.staffRole, 'rides.read')) throw fail.forbidden();
  await advanceRide(input.rideId);
  return rideSummary((await rideRef(input.rideId).get()).data() as RideDoc);
}

// ---------------------------------------------------------------------------
// Driver responses
// ---------------------------------------------------------------------------

export async function respondToOffer(ctx: CallerContext, input: { rideId: string; accept: boolean; declineReason: string | null }) {
  await requireActiveUser(ctx.uid, 'DRIVER');
  if (!input.accept) {
    const ok = await declineOffer(ctx.uid, input.rideId, input.declineReason ?? 'DECLINED');
    if (!ok) throw fail.precondition('OFFER_NOT_FOUND', 'This ride request is no longer available.');
    return { status: 'DECLINED' as const };
  }

  const policies = await getConfig('policies');
  let expired = false;
  let accepted: RideDoc;
  try {
    accepted = await db().runTransaction(async (tx) => {
      const r = await readRide(tx, input.rideId);
      const { ref: driverRef, driver } = await readDriver(tx, ctx.uid);
      if (!r || r.ride.status !== 'SEARCHING' || r.ride.offer?.driverId !== ctx.uid) {
        throw fail.precondition('OFFER_NOT_FOUND', 'This ride request is no longer available.');
      }
      const driverUser = (await tx.get(usersCol().doc(ctx.uid))).data() as UserDoc | undefined;
      const passenger = (await tx.get(usersCol().doc(r.ride.passengerUid))).data() as UserDoc | undefined;
      const nowMs = now();
      if (nowMs >= millis(r.ride.offer.expiresAt)!) {
        expired = true;
        throw fail.precondition('OFFER_EXPIRED', 'This ride request has expired.');
      }
      if (!driver || driver.currentOfferRideId !== input.rideId || !driverStillEligible(driver, nowMs)) {
        throw fail.precondition('DRIVER_NOT_ELIGIBLE', 'You cannot accept rides right now. Check your account status.');
      }
      assertRideTransition('SEARCHING', 'ACCEPTED', 'DRIVER');
      const vehicle = driver.vehicle!;
      const snapshot = {
        displayName: driver.publicProfile.displayName,
        photoPath: driver.publicProfile.photoPath,
        plateNumber: vehicle.plateNumber,
        bodyNumber: vehicle.bodyNumber,
        vehicleDescription: `${vehicle.color} ${vehicle.make} ${vehicle.model}`.trim(),
        ratingAvg: ratingAverage(driver.ratingSummary, policies.ratings.minRatingsToDisplay),
      };
      tx.update(r.ref, statusUpdate('ACCEPTED', nowMs, { driverUid: ctx.uid, offer: null, driver: snapshot }));
      tx.update(driverRef, {
        availability: 'ON_TRIP',
        currentRideId: input.rideId,
        currentOfferRideId: null,
        missedOffers: 0,
        availabilityChangedAt: ts(nowMs),
        updatedAt: ts(nowMs),
      });
      // Contact details are readable by participants only while the trip is active.
      tx.set(rideRef(input.rideId).collection('contact').doc('info'), {
        passengerFirstName: passenger?.firstName ?? null,
        passengerPhone: passenger?.phoneNumber ?? null,
        driverName: snapshot.displayName,
        driverPhone: driverUser?.phoneNumber ?? null,
      });
      addRideEvent(tx, input.rideId, { type: 'ACCEPTED', from: 'SEARCHING', to: 'ACCEPTED', actor: 'DRIVER', actorUid: ctx.uid }, nowMs);
      return { ...r.ride, driverUid: ctx.uid, status: 'ACCEPTED' as RideStatus, driver: snapshot };
    });
  } catch (err) {
    if (expired) await expireOfferIfDue(input.rideId);
    throw err;
  }

  const ride = accepted;
  await setTrackingPassenger(ctx.uid, ride.passengerUid);
  // Real ETA only when a route provider is available; otherwise left null.
  const loc = await readLocation(ctx.uid);
  if (loc) {
    const etas = await maps().durationsTo([loc], ride.pickup);
    if (etas?.[0] != null) await rideRef(ride.rideId).update({ driverEtaSeconds: etas[0] });
  }
  await notifyUser(ride.passengerUid, {
    type: 'RIDE_ACCEPTED',
    title: 'Driver found!',
    body: `${ride.driver?.displayName ?? 'Your driver'} accepted your ride.`,
    rideId: ride.rideId,
  });
  return { status: 'ACCEPTED' as const, rideId: ride.rideId };
}

const PROGRESS_TARGET = { EN_ROUTE: 'DRIVER_EN_ROUTE', ARRIVED: 'DRIVER_ARRIVED', START: 'IN_PROGRESS' } as const;

export async function updateRideProgress(ctx: CallerContext, input: { rideId: string; action: keyof typeof PROGRESS_TARGET }) {
  await requireActiveUser(ctx.uid, 'DRIVER');
  const cfg = await getConfig('matching');
  const target = PROGRESS_TARGET[input.action];
  const loc = await readLocation(ctx.uid);
  const nowMsOuter = now();
  const freshLoc = loc && !locationProblem(loc, cfg, nowMsOuter) ? loc : null;

  const result = await db().runTransaction(async (tx) => {
    const r = await readRide(tx, input.rideId);
    if (!r || r.ride.driverUid !== ctx.uid) throw fail.notFound('Ride');
    if (r.ride.status === target) return { changed: false, ride: r.ride };
    const nowMs = now();
    assertRideTransition(r.ride.status, target, 'DRIVER');
    const extra: Record<string, unknown> = {};
    if (target === 'DRIVER_ARRIVED') {
      if (freshLoc) {
        const d = distanceMeters(r.ride.pickup, freshLoc);
        if (d > cfg.arrivalMaxDistanceM) {
          throw fail.precondition('TOO_FAR_FROM_PICKUP', 'You appear to be too far from the pickup point.', { distanceMeters: Math.round(d) });
        }
        extra.arrivalVerified = true;
      } else {
        // GPS unavailable: allowed, but recorded as unverified for dispute handling.
        extra.arrivalVerified = false;
      }
    }
    tx.update(r.ref, statusUpdate(target, nowMs, extra));
    if (freshLoc) {
      tx.set(traceRef(input.rideId), { points: arrayUnion({ type: target, lat: freshLoc.lat, lng: freshLoc.lng, acc: freshLoc.acc, at: nowMs }) }, { merge: true });
    }
    addRideEvent(tx, input.rideId, { type: target, from: r.ride.status, to: target, actor: 'DRIVER', actorUid: ctx.uid, details: extra }, nowMs);
    return { changed: true, ride: r.ride };
  });

  if (result.changed) {
    const messages = {
      DRIVER_EN_ROUTE: { type: 'DRIVER_EN_ROUTE', title: 'Driver on the way', body: 'Your driver is heading to your pickup point.' },
      DRIVER_ARRIVED: { type: 'DRIVER_ARRIVED', title: 'Your driver has arrived', body: 'Please meet your driver at the pickup point.' },
      IN_PROGRESS: { type: 'TRIP_STARTED', title: 'Trip started', body: 'Enjoy your ride. Your trip is now in progress.' },
    } as const;
    const m = messages[target];
    await notifyUser(result.ride.passengerUid, { ...m, rideId: input.rideId });
  }
  return { status: target };
}

// ---------------------------------------------------------------------------
// Completion & payment
// ---------------------------------------------------------------------------

export interface CompleteRideInput {
  rideId: string;
  /** Cash actually collected, in centavos. Null when not yet collected. */
  cashCollected: number | null;
  adjustments: FareAdjustmentInput[];
}

export async function completeRide(ctx: CallerContext, input: CompleteRideInput) {
  const asAdmin = hasPermission(ctx.staffRole, 'rides.intervene');
  if (!asAdmin) await requireActiveUser(ctx.uid, 'DRIVER');
  const actor: Actor = asAdmin ? 'ADMIN' : 'DRIVER';
  const pre = (await rideRef(input.rideId).get()).data() as RideDoc | undefined;
  if (!pre || (!asAdmin && pre.driverUid !== ctx.uid)) throw fail.notFound('Ride');
  // Final fares follow the fare version the passenger was quoted.
  const [fareCfg, paymentsCfg] = await Promise.all([getFareConfigVersion(pre.quote.fareVersion), getConfig('payments')]);

  let revokeDriver: string | null = null;
  const result = await db().runTransaction(async (tx) => {
    const r = await readRide(tx, input.rideId);
    if (!r || (!asAdmin && r.ride.driverUid !== ctx.uid)) throw fail.notFound('Ride');
    const payRef = paymentsCol().doc(input.rideId);
    if (r.ride.status === 'COMPLETED') {
      return { ride: r.ride, alreadyCompleted: true };
    }
    assertRideTransition(r.ride.status, 'COMPLETED', actor);
    const { ref: driverRef, driver } = await readDriver(tx, r.ride.driverUid!);
    const passenger = (await tx.get(usersCol().doc(r.ride.passengerUid))).data() as UserDoc | undefined;
    const paySnap = await tx.get(payRef);
    const nowMs = now();

    const waiting = computeWaitingFee(fareCfg, millis(r.ride.arrivedAt), millis(r.ride.startedAt));
    const adjustmentLines = validateAdjustments(fareCfg, input.adjustments);
    const lines: FareLine[] = [...r.ride.quote.lines];
    if (waiting.amount > 0) lines.push({ code: 'WAITING_FEE', label: `Waiting time (${waiting.minutes} min)`, amount: waiting.amount });
    lines.push(...adjustmentLines);
    const total = r.ride.quote.total + waiting.amount + adjustmentLines.reduce((s, l) => s + l.amount, 0);

    let paymentStatus: PaymentDoc['status'] = 'UNPAID';
    let discrepancy = 0;
    if (input.cashCollected != null) {
      const outcome = cashOutcome(total, input.cashCollected, paymentsCfg.cashDiscrepancyTolerance);
      paymentStatus = outcome.status;
      discrepancy = outcome.discrepancy;
    }
    if (!paySnap.exists) {
      const payment: PaymentDoc = {
        rideId: input.rideId,
        passengerUid: r.ride.passengerUid,
        driverUid: r.ride.driverUid!,
        method: 'CASH',
        status: paymentStatus,
        currency: 'PHP',
        amountDue: total,
        amountCollected: input.cashCollected,
        discrepancy,
        recordedBy: input.cashCollected != null ? ctx.uid : null,
        recordedAt: input.cashCollected != null ? ts(nowMs) : null,
        history: [{ status: paymentStatus, by: ctx.uid, at: ts(nowMs), note: discrepancy > 0 ? `Shortfall ${discrepancy}` : null }],
        createdAt: ts(nowMs),
        updatedAt: ts(nowMs),
      };
      tx.set(payRef, payment);
    }

    tx.update(
      r.ref,
      statusUpdate('COMPLETED', nowMs, {
        finalFare: { total, lines, waitingMinutes: waiting.minutes },
        payment: { method: 'CASH', status: paymentStatus },
      }),
    );
    if (driver) {
      const { updates, offline } = releaseDriverUpdates(driver, nowMs, { 'stats.completedTrips': increment(1) });
      tx.update(driverRef, updates);
      if (offline) revokeDriver = r.ride.driverUid;
    }
    clearPassengerActiveRide(tx, r.ride.passengerUid, input.rideId, passenger?.activeRideId, nowMs);
    tx.delete(rideRef(input.rideId).collection('contact').doc('info'));
    addRideEvent(tx, input.rideId, { type: 'COMPLETED', from: r.ride.status, to: 'COMPLETED', actor, actorUid: ctx.uid, details: { total, paymentStatus } }, nowMs);
    if (asAdmin) {
      writeAudit(tx, {
        category: 'OPERATIONS',
        action: 'RIDE_COMPLETED_BY_ADMIN',
        actorUid: ctx.uid,
        actorRole: ctx.staffRole!,
        targetType: 'ride',
        targetId: input.rideId,
        targetUid: r.ride.passengerUid,
      });
    }
    return { ride: { ...r.ride, status: 'COMPLETED' as RideStatus, finalFare: { total, lines, waitingMinutes: waiting.minutes } }, alreadyCompleted: false };
  });

  if (!result.alreadyCompleted) {
    await setTrackingPassenger(result.ride.driverUid!, null);
    if (revokeDriver) await revokePresence(revokeDriver);
    await notifyUser(result.ride.passengerUid, {
      type: 'TRIP_COMPLETED',
      title: 'Trip completed',
      body: `Total fare: ₱${((result.ride.finalFare?.total ?? 0) / 100).toFixed(2)}. Thank you for riding with GrabCycle!`,
      rideId: input.rideId,
    });
  }
  return { status: 'COMPLETED' as const, total: result.ride.finalFare?.total ?? null, alreadyCompleted: result.alreadyCompleted };
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export const PASSENGER_CANCEL_REASONS = ['CHANGED_MIND', 'WAIT_TOO_LONG', 'WRONG_PICKUP', 'DRIVER_ASKED_TO_CANCEL', 'FOUND_OTHER_RIDE', 'SAFETY', 'OTHER'] as const;
export const DRIVER_CANCEL_REASONS = ['PASSENGER_NO_SHOW', 'VEHICLE_PROBLEM', 'UNSAFE_PICKUP', 'PASSENGER_ASKED', 'SAFETY', 'OTHER'] as const;

export async function cancelRide(ctx: CallerContext, input: { rideId: string; reasonCode: string; note: string | null }) {
  await enforceRateLimit(ctx.uid, 'cancelRide');
  const asAdmin = hasPermission(ctx.staffRole, 'rides.intervene');
  const policies = await getConfig('policies');
  let revokeDriver: string | null = null;
  let notify: { uid: string; actor: Actor } | null = null;

  const result = await db().runTransaction(async (tx) => {
    const r = await readRide(tx, input.rideId);
    if (!r) throw fail.notFound('Ride');
    const ride = r.ride;
    let actor: Actor;
    if (ride.passengerUid === ctx.uid) actor = 'PASSENGER';
    else if (ride.driverUid === ctx.uid) actor = 'DRIVER';
    else if (asAdmin) actor = 'ADMIN';
    else throw fail.notFound('Ride');

    const target: RideStatus = actor === 'PASSENGER' ? 'CANCELLED_BY_PASSENGER' : actor === 'DRIVER' ? 'CANCELLED_BY_DRIVER' : 'CANCELLED_BY_ADMIN';
    if (isTerminalRideStatus(ride.status)) {
      if (ride.status === target) return { status: ride.status, alreadyCancelled: true };
      throw fail.precondition('RIDE_NOT_ACTIVE', 'This ride has already ended.');
    }
    if (actor === 'PASSENGER' && !(PASSENGER_CANCEL_REASONS as readonly string[]).includes(input.reasonCode)) throw fail.invalid('Invalid reason.');
    if (actor === 'DRIVER' && !(DRIVER_CANCEL_REASONS as readonly string[]).includes(input.reasonCode)) throw fail.invalid('Invalid reason.');
    try {
      assertRideTransition(ride.status, target, actor);
    } catch {
      throw fail.precondition('CANCELLATION_NOT_ALLOWED', 'This ride can no longer be cancelled. Use “Report an issue” if you need help.');
    }

    const nowMs = now();
    if (actor === 'DRIVER' && input.reasonCode === 'PASSENGER_NO_SHOW') {
      const arrivedAt = millis(ride.arrivedAt);
      const waitMs = policies.cancellation.driverNoShowWaitMinutes * 60_000;
      if (ride.status !== 'DRIVER_ARRIVED' || arrivedAt == null || nowMs - arrivedAt < waitMs) {
        throw fail.precondition('CANCELLATION_NOT_ALLOWED', `Please wait at least ${policies.cancellation.driverNoShowWaitMinutes} minutes after arriving before reporting a no-show.`);
      }
    }

    // Reads first: involved driver and passenger.
    const driverUid = ride.driverUid ?? ride.offer?.driverId ?? null;
    const driverRead = driverUid ? await readDriver(tx, driverUid) : null;
    const passenger = (await tx.get(usersCol().doc(ride.passengerUid))).data() as UserDoc | undefined;

    let feeApplied = 0;
    const acceptedAt = millis(ride.acceptedAt);
    if (
      actor === 'PASSENGER' &&
      policies.cancellation.passengerFeeEnabled &&
      isAssignedRideStatus(ride.status) &&
      acceptedAt != null &&
      nowMs - acceptedAt >= policies.cancellation.passengerFeeAfterAcceptMinutes * 60_000
    ) {
      feeApplied = policies.cancellation.passengerFee;
    }

    tx.update(
      r.ref,
      statusUpdate(target, nowMs, {
        offer: null,
        statusReason: input.reasonCode,
        cancellation: { by: actor, reasonCode: input.reasonCode, note: input.note, feeApplied },
      }),
    );
    if (driverRead?.driver && (driverRead.driver.currentRideId === ride.rideId || driverRead.driver.currentOfferRideId === ride.rideId)) {
      const extra = actor === 'DRIVER' ? { 'stats.cancelledByDriver': increment(1) } : {};
      const { updates, offline } = releaseDriverUpdates(driverRead.driver, nowMs, extra);
      tx.update(driverRead.ref, updates);
      if (offline) revokeDriver = driverUid;
    }
    clearPassengerActiveRide(tx, ride.passengerUid, ride.rideId, passenger?.activeRideId, nowMs);
    tx.delete(rideRef(ride.rideId).collection('contact').doc('info'));
    addRideEvent(tx, ride.rideId, { type: target, from: ride.status, to: target, actor, actorUid: ctx.uid, details: { reasonCode: input.reasonCode, feeApplied } }, nowMs);
    if (actor === 'ADMIN') {
      writeAudit(tx, {
        category: 'OPERATIONS',
        action: 'RIDE_CANCELLED_BY_ADMIN',
        actorUid: ctx.uid,
        actorRole: ctx.staffRole!,
        targetType: 'ride',
        targetId: ride.rideId,
        targetUid: ride.passengerUid,
        reasonCode: input.reasonCode,
      });
    }
    if (actor !== 'PASSENGER') notify = { uid: ride.passengerUid, actor };
    else if (ride.driverUid) notify = { uid: ride.driverUid, actor };
    return { status: target, alreadyCancelled: false, wasAssigned: isAssignedRideStatus(ride.status), driverUid: ride.driverUid };
  });

  if (!result.alreadyCancelled) {
    if (result.driverUid) await setTrackingPassenger(result.driverUid, null);
    if (revokeDriver) await revokePresence(revokeDriver);
    const n = notify as { uid: string; actor: Actor } | null;
    if (n) {
      await notifyUser(n.uid, {
        type: 'RIDE_CANCELLED',
        title: 'Ride cancelled',
        body: n.actor === 'PASSENGER' ? 'The passenger cancelled the ride.' : n.actor === 'DRIVER' ? 'Your driver cancelled the ride. You can book again.' : 'Your ride was cancelled by GrabCycle support.',
        rideId: input.rideId,
      });
    }
  }
  return { status: result.status };
}

