import { beforeEach, describe, expect, it } from 'vitest';
import { db, rtdb } from '../../src/lib/firebase';
import { setClockForTesting } from '../../src/lib/time';
import { setDriverAvailability } from '../../src/services/availability';
import type { DriverDoc, PaymentDoc, RideDoc, UserDoc } from '../../src/services/models';
import { disputePayment, recordCashPayment, resolvePayment } from '../../src/services/payments';
import { submitRating } from '../../src/services/ratings';
import { advanceRide, expireOfferIfDue } from '../../src/services/rideMatching';
import { cancelRide, completeRide, createRide, respondToOffer, updateRideProgress } from '../../src/services/rides';
import { createSupportCase, updateSupportCase } from '../../src/services/support';
import { sweepRides } from '../../src/services/sweepers';
import {
  admin,
  approvedPassenger,
  BOAC,
  expectReason,
  getDoc,
  goOnline,
  moveDriver,
  north,
  quoteFor,
  registerApprovedDriver,
  registerPassenger,
  requestId,
  resetEmulators,
  seedConfig,
  support,
} from './helpers';

beforeEach(async () => {
  await resetEmulators();
  await seedConfig();
});

async function book(p: Awaited<ReturnType<typeof approvedPassenger>>, opts: { selected?: string; allowFallback?: boolean } = {}) {
  const q = await quoteFor(p);
  return createRide(p, { requestId: requestId(), quoteId: q.quoteId, selectedDriverId: opts.selected ?? null, allowFallback: opts.allowFallback ?? false, pickupNote: null });
}

const ride = (id: string) => getDoc<RideDoc>(`rides/${id}`);
const driverDoc = (uid: string) => getDoc<DriverDoc>(`drivers/${uid}`);

describe('booking gate', () => {
  it('an unverified passenger cannot create a ride even with a valid quote and an available driver', async () => {
    const p = await registerPassenger();
    const d = await registerApprovedDriver();
    await goOnline(d);
    const q = await quoteFor(p);
    await expectReason(
      createRide(p, { requestId: requestId(), quoteId: q.quoteId, selectedDriverId: d.uid, allowFallback: false, pickupNote: null }),
      'PASSENGER_NOT_VERIFIED',
    );
    expect((await db().collection('rides').get()).size).toBe(0);
  });

  it('no eligible drivers → no ride is created', async () => {
    const p = await approvedPassenger();
    await expectReason(book(p), 'NO_DRIVERS_AVAILABLE');
    expect((await getDoc<UserDoc>(`users/${p.uid}`))?.activeRideId).toBeNull();
  });

  it('a selected driver that is no longer available is refused with an explanation', async () => {
    const p = await approvedPassenger();
    const d = await registerApprovedDriver();
    await goOnline(d);
    await setDriverAvailability(d, { online: false, location: null });
    const err = await expectReason(book(p, { selected: d.uid }), 'DRIVER_UNAVAILABLE');
    expect(err.meta.driverId).toBe(d.uid);
  });

  it('stale driver locations are not matched', async () => {
    const p = await approvedPassenger();
    const d = await registerApprovedDriver();
    await goOnline(d);
    await moveDriver(d.uid, north(BOAC, 200), { ageMs: 45_000 });
    await expectReason(book(p), 'NO_DRIVERS_AVAILABLE');
  });

  it('booking is idempotent per request id and one active ride per passenger', async () => {
    const p = await approvedPassenger();
    const d1 = await registerApprovedDriver();
    const d2 = await registerApprovedDriver();
    await goOnline(d1);
    await goOnline(d2, north(BOAC, 500));
    const q = await quoteFor(p);
    const rid = requestId();
    const first = await createRide(p, { requestId: rid, quoteId: q.quoteId, selectedDriverId: null, allowFallback: false, pickupNote: null });
    const retry = await createRide(p, { requestId: rid, quoteId: q.quoteId, selectedDriverId: null, allowFallback: false, pickupNote: null });
    expect(retry.rideId).toBe(first.rideId);
    expect((await db().collection('rides').get()).size).toBe(1);
    await expectReason(
      createRide(p, { requestId: requestId(), quoteId: q.quoteId, selectedDriverId: null, allowFallback: false, pickupNote: null }),
      'ACTIVE_RIDE_EXISTS',
    );
  });
});

describe('matching and offers', () => {
  it('offers to the nearest driver first, then falls back after a decline and a timeout', async () => {
    const p = await approvedPassenger();
    const near = await registerApprovedDriver();
    const mid = await registerApprovedDriver();
    const far = await registerApprovedDriver();
    await goOnline(near, north(BOAC, 200));
    await goOnline(mid, north(BOAC, 800));
    await goOnline(far, north(BOAC, 1500));

    const booked = await book(p);
    let r = await ride(booked.rideId);
    expect(r?.status).toBe('SEARCHING');
    expect(r?.offer?.driverId).toBe(near.uid);
    expect((await driverDoc(near.uid))?.availability).toBe('OFFERED');

    // A driver who was not offered the ride cannot accept it.
    await expectReason(respondToOffer(far, { rideId: booked.rideId, accept: true, declineReason: null }), 'OFFER_NOT_FOUND');

    await respondToOffer(near, { rideId: booked.rideId, accept: false, declineReason: 'TOO_FAR' });
    r = await ride(booked.rideId);
    expect(r?.offer?.driverId).toBe(mid.uid);
    expect((await driverDoc(near.uid))?.availability).toBe('ONLINE');

    // The acceptance window is enforced by the server.
    setClockForTesting(() => Date.now() + 21_000);
    await expectReason(respondToOffer(mid, { rideId: booked.rideId, accept: true, declineReason: null }), 'OFFER_EXPIRED');
    r = await ride(booked.rideId);
    expect(r?.offer?.driverId).toBe(far.uid);
    expect((await driverDoc(mid.uid))?.missedOffers).toBe(1);
    setClockForTesting(null);

    await respondToOffer(far, { rideId: booked.rideId, accept: true, declineReason: null });
    r = await ride(booked.rideId);
    expect(r?.status).toBe('ACCEPTED');
    expect(r?.driverUid).toBe(far.uid);
    expect(r?.driver?.plateNumber).toBe('123ABC');
    expect((await driverDoc(far.uid))?.availability).toBe('ON_TRIP');
    // The passenger may now track this driver only.
    expect((await rtdb().ref(`presence/${far.uid}/trackingPassengerUid`).once('value')).val()).toBe(p.uid);
  });

  it('a selected driver who declines ends the request (no silent reassignment) unless fallback was allowed', async () => {
    const p = await approvedPassenger();
    const d = await registerApprovedDriver();
    const other = await registerApprovedDriver();
    await goOnline(d);
    await goOnline(other, north(BOAC, 300));
    const booked = await book(p, { selected: d.uid });
    expect((await ride(booked.rideId))?.offer?.driverId).toBe(d.uid);
    await respondToOffer(d, { rideId: booked.rideId, accept: false, declineReason: 'BUSY' });
    const r = await ride(booked.rideId);
    expect(r?.status).toBe('NO_DRIVER_FOUND');
    expect(r?.statusReason).toBe('SELECTED_DRIVER_DECLINED');
    expect((await getDoc<UserDoc>(`users/${p.uid}`))?.activeRideId).toBeNull();

    const p2 = await approvedPassenger('Ana Reyes');
    const withFallback = await book(p2, { selected: d.uid, allowFallback: true });
    await respondToOffer(d, { rideId: withFallback.rideId, accept: false, declineReason: 'BUSY' });
    expect((await ride(withFallback.rideId))?.offer?.driverId).toBe(other.uid);
  });

  it('the sweeper and passenger polling expire offers and enforce the search deadline', async () => {
    const p = await approvedPassenger();
    const d = await registerApprovedDriver();
    await goOnline(d);
    const booked = await book(p);
    setClockForTesting(() => Date.now() + 25_000);
    expect(await sweepRides()).toBe(1);
    let r = await ride(booked.rideId);
    // Only candidate timed out and no one else is around.
    expect(r?.status).toBe('NO_DRIVER_FOUND');
    expect((await driverDoc(d.uid))?.availability).toBe('ONLINE');
    setClockForTesting(null);

    const p2 = await approvedPassenger('Ana Reyes');
    const second = await book(p2);
    setClockForTesting(() => Date.now() + 10 * 60_000);
    await advanceRide(second.rideId);
    r = await ride(second.rideId);
    expect(r?.status).toBe('EXPIRED');
    expect(await expireOfferIfDue(second.rideId)).toBe(false);
  });

  it('drivers who ignore repeated offers are taken offline', async () => {
    const d = await registerApprovedDriver();
    await goOnline(d);
    for (let i = 0; i < 3; i++) {
      const p = await approvedPassenger(`Passenger ${String.fromCharCode(65 + i)}`);
      setClockForTesting(null);
      const booked = await book(p);
      setClockForTesting(() => Date.now() + 21_000);
      await expireOfferIfDue(booked.rideId);
      setClockForTesting(null);
    }
    const driver = await driverDoc(d.uid);
    expect(driver?.availability).toBe('OFFLINE');
    expect((await rtdb().ref(`presence/${d.uid}/canPublish`).once('value')).val()).toBe(false);
  });

  it('going offline with a pending offer passes the ride on; going offline mid-trip is refused', async () => {
    const p = await approvedPassenger();
    const a = await registerApprovedDriver();
    const b = await registerApprovedDriver();
    await goOnline(a);
    await goOnline(b, north(BOAC, 700));
    const booked = await book(p);
    expect((await ride(booked.rideId))?.offer?.driverId).toBe(a.uid);
    await setDriverAvailability(a, { online: false, location: null });
    expect((await ride(booked.rideId))?.offer?.driverId).toBe(b.uid);
    await respondToOffer(b, { rideId: booked.rideId, accept: true, declineReason: null });
    await expectReason(setDriverAvailability(b, { online: false, location: null }), 'DRIVER_HAS_ACTIVE_TRIP');
  });
});

describe('trip lifecycle, payments and ratings', () => {
  async function acceptedRide() {
    const p = await approvedPassenger();
    const d = await registerApprovedDriver();
    await goOnline(d, north(BOAC, 400));
    const booked = await book(p);
    await respondToOffer(d, { rideId: booked.rideId, accept: true, declineReason: null });
    return { p, d, rideId: booked.rideId };
  }

  it('runs ACCEPTED → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED with a cash payment', async () => {
    const { p, d, rideId } = await acceptedRide();
    // Passengers can never drive the state machine.
    await expectReason(updateRideProgress(p, { rideId, action: 'START' }), 'ACCOUNT_TYPE_MISMATCH');
    await expectReason(updateRideProgress(d, { rideId, action: 'START' }), 'INVALID_STATE_TRANSITION');

    await updateRideProgress(d, { rideId, action: 'EN_ROUTE' });
    await moveDriver(d.uid, north(BOAC, 1200));
    await expectReason(updateRideProgress(d, { rideId, action: 'ARRIVED' }), 'TOO_FAR_FROM_PICKUP');
    await moveDriver(d.uid, north(BOAC, 30));
    await updateRideProgress(d, { rideId, action: 'ARRIVED' });
    expect((await ride(rideId))?.arrivalVerified).toBe(true);
    await updateRideProgress(d, { rideId, action: 'START' });
    await expectReason(cancelRide(p, { rideId, reasonCode: 'CHANGED_MIND', note: null }), 'CANCELLATION_NOT_ALLOWED');

    const total = (await ride(rideId))!.quote.total;
    const done = await completeRide(d, { rideId, cashCollected: total, adjustments: [] });
    expect(done.status).toBe('COMPLETED');
    const r = await ride(rideId);
    expect(r?.status).toBe('COMPLETED');
    expect(r?.finalFare?.total).toBe(total);
    expect(r?.payment.status).toBe('PAID');
    const payment = await getDoc<PaymentDoc>(`payments/${rideId}`);
    expect(payment?.status).toBe('PAID');
    expect(payment?.amountCollected).toBe(total);

    // Idempotent completion: no second payment or state change.
    const again = await completeRide(d, { rideId, cashCollected: 1, adjustments: [] });
    expect(again.alreadyCompleted).toBe(true);
    expect((await getDoc<PaymentDoc>(`payments/${rideId}`))?.amountCollected).toBe(total);

    expect((await driverDoc(d.uid))?.availability).toBe('ONLINE');
    expect((await driverDoc(d.uid))?.stats.completedTrips).toBe(1);
    expect((await getDoc<UserDoc>(`users/${p.uid}`))?.activeRideId).toBeNull();
    expect((await rtdb().ref(`presence/${d.uid}/trackingPassengerUid`).once('value')).val()).toBeNull();
    expect((await db().doc(`rides/${rideId}/contact/info`).get()).exists).toBe(false);

    const events = await db().collection(`rides/${rideId}/events`).orderBy('at').get();
    expect(events.docs.map((e) => e.get('type'))).toEqual(
      expect.arrayContaining(['REQUESTED', 'OFFER_SENT', 'ACCEPTED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED']),
    );

    // Ratings: once per party, participants only.
    await submitRating(p, { rideId, stars: 5, comment: 'Salamat po!', tags: [] });
    await expectReason(submitRating(p, { rideId, stars: 1, comment: null, tags: [] }), 'RATING_ALREADY_SUBMITTED');
    await submitRating(d, { rideId, stars: 4, comment: null, tags: [] });
    const outsider = await registerPassenger('Outside Person');
    await expectReason(submitRating(outsider, { rideId, stars: 1, comment: null, tags: [] }), 'NOT_FOUND');
    expect((await driverDoc(d.uid))?.ratingSummary).toEqual({ count: 1, sum: 5 });
    expect((await getDoc<UserDoc>(`users/${p.uid}`))?.ratingSummary).toEqual({ count: 1, sum: 4 });
  });

  it('cash shortfalls are flagged as PENDING, can be disputed and resolved by staff', async () => {
    const { p, d, rideId } = await acceptedRide();
    await updateRideProgress(d, { rideId, action: 'ARRIVED' });
    await updateRideProgress(d, { rideId, action: 'START' });
    await completeRide(d, { rideId, cashCollected: null, adjustments: [] });
    expect((await getDoc<PaymentDoc>(`payments/${rideId}`))?.status).toBe('UNPAID');
    await expectReason(recordCashPayment(p, { rideId, amountCollected: 100 }), 'NOT_FOUND');
    await recordCashPayment(d, { rideId, amountCollected: 100 });
    expect((await getDoc<PaymentDoc>(`payments/${rideId}`))?.status).toBe('PENDING');
    await expectReason(recordCashPayment(d, { rideId, amountCollected: 100_000 }), 'PAYMENT_ALREADY_RECORDED');

    const { caseId } = await disputePayment(p, { rideId, description: 'I paid the full amount in cash.' });
    expect(caseId).toBeTruthy();
    expect((await ride(rideId))?.payment.status).toBe('DISPUTED');
    await expectReason(resolvePayment(support, { rideId, status: 'PAID', note: 'Checked' }), 'PERMISSION_DENIED');
    await resolvePayment(admin, { rideId, status: 'PAID', note: 'Confirmed with driver' });
    expect((await getDoc<PaymentDoc>(`payments/${rideId}`))?.status).toBe('PAID');
  });

  it('a driver whose document expired mid-trip finishes the trip and then goes offline', async () => {
    const { d, rideId } = await acceptedRide();
    await updateRideProgress(d, { rideId, action: 'ARRIVED' });
    await updateRideProgress(d, { rideId, action: 'START' });
    await db().doc(`drivers/${d.uid}`).update({ 'eligibility.validUntil': Date.now() - 1000 });
    await completeRide(d, { rideId, cashCollected: null, adjustments: [] });
    expect((await driverDoc(d.uid))?.availability).toBe('OFFLINE');
  });

  it('cancellation rules: passenger cancel releases the driver; driver no-show needs the wait period', async () => {
    const first = await acceptedRide();
    await cancelRide(first.p, { rideId: first.rideId, reasonCode: 'CHANGED_MIND', note: null });
    expect((await ride(first.rideId))?.status).toBe('CANCELLED_BY_PASSENGER');
    expect((await driverDoc(first.d.uid))?.availability).toBe('ONLINE');
    expect((await getDoc<UserDoc>(`users/${first.p.uid}`))?.activeRideId).toBeNull();

    const p2 = await approvedPassenger('Ana Reyes');
    const booked = await book(p2);
    await respondToOffer(first.d, { rideId: booked.rideId, accept: true, declineReason: null });
    await updateRideProgress(first.d, { rideId: booked.rideId, action: 'ARRIVED' });
    await expectReason(cancelRide(first.d, { rideId: booked.rideId, reasonCode: 'PASSENGER_NO_SHOW', note: null }), 'CANCELLATION_NOT_ALLOWED');
    setClockForTesting(() => Date.now() + 6 * 60_000);
    await cancelRide(first.d, { rideId: booked.rideId, reasonCode: 'PASSENGER_NO_SHOW', note: null });
    expect((await ride(booked.rideId))?.status).toBe('CANCELLED_BY_DRIVER');
    expect((await driverDoc(first.d.uid))?.stats.cancelledByDriver).toBe(1);
  });

  it('admins can intervene; unrelated users cannot touch the ride', async () => {
    const { rideId } = await acceptedRide();
    const outsider = await approvedPassenger('Outside Person');
    await expectReason(cancelRide(outsider, { rideId, reasonCode: 'CHANGED_MIND', note: null }), 'NOT_FOUND');
    await expectReason(cancelRide(support, { rideId, reasonCode: 'OTHER', note: null }), 'NOT_FOUND');
    await cancelRide(admin, { rideId, reasonCode: 'SAFETY_CONCERN', note: 'Reported by passenger' });
    expect((await ride(rideId))?.status).toBe('CANCELLED_BY_ADMIN');
    const audit = await db().collection('auditLogs').where('action', '==', 'RIDE_CANCELLED_BY_ADMIN').get();
    expect(audit.size).toBe(1);
  });

  it('support cases are tied to participants and handled by support staff', async () => {
    const { p, rideId } = await acceptedRide();
    const outsider = await registerPassenger('Outside Person');
    await expectReason(createSupportCase(outsider, { rideId, category: 'SAFETY', description: 'Something happened here.' }), 'NOT_FOUND');
    const { caseId, priority } = await createSupportCase(p, { rideId, category: 'SAFETY', description: 'Driver was speeding a lot.' });
    expect(priority).toBe('URGENT');
    await updateSupportCase(support, { caseId, status: 'IN_PROGRESS', publicResponse: 'We are looking into this.', internalNote: 'Call driver', assignToMe: true });
    const c = await getDoc<{ status: string; publicResponse: string }>(`supportCases/${caseId}`);
    expect(c?.status).toBe('IN_PROGRESS');
    expect(JSON.stringify(c)).not.toContain('Call driver');
  });
});
