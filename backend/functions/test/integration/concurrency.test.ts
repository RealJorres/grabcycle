import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/lib/firebase';
import type { DriverDoc, PaymentDoc, RideDoc } from '../../src/services/models';
import { completeRide, createRide, respondToOffer, updateRideProgress } from '../../src/services/rides';
import {
  approvedPassenger,
  BOAC,
  getDoc,
  goOnline,
  north,
  quoteFor,
  registerApprovedDriver,
  requestId,
  resetEmulators,
  seedConfig,
} from './helpers';

/**
 * Concurrency invariants (docs/ride-assignment-invariants.md):
 *  - two concurrent requests can never reserve the same driver;
 *  - a ride has at most one assigned driver;
 *  - retries never create duplicate rides, completions or payments.
 */

beforeEach(async () => {
  await resetEmulators();
  await seedConfig();
});

describe('concurrent booking', () => {
  it('many passengers selecting the same driver at the same time: exactly one reservation succeeds', async () => {
    const driver = await registerApprovedDriver();
    await goOnline(driver);
    const passengers = await Promise.all(Array.from({ length: 6 }, (_, i) => approvedPassenger(`Passenger ${String.fromCharCode(65 + i)}`)));
    const quotes = await Promise.all(passengers.map((p) => quoteFor(p)));

    const results = await Promise.allSettled(
      passengers.map((p, i) =>
        createRide(p, { requestId: requestId(), quoteId: quotes[i]!.quoteId, selectedDriverId: driver.uid, allowFallback: false, pickupNote: null }),
      ),
    );

    const rides = (await db().collection('rides').get()).docs.map((d) => d.data() as RideDoc);
    const holding = rides.filter((r) => r.offer?.driverId === driver.uid || r.driverUid === driver.uid);
    expect(holding).toHaveLength(1);
    const d = await getDoc<DriverDoc>(`drivers/${driver.uid}`);
    expect(d?.availability).toBe('OFFERED');
    expect(d?.currentOfferRideId).toBe(holding[0]!.rideId);
    // Every other request ended cleanly (refused up front or NO_DRIVER_FOUND), never double-booked.
    for (const r of rides.filter((x) => x.rideId !== holding[0]!.rideId)) {
      expect(r.status).toBe('NO_DRIVER_FOUND');
    }
    const refused = results.filter((r) => r.status === 'rejected');
    expect(refused.length + rides.length).toBe(passengers.length);
  });

  it('concurrent automatic matching distributes drivers without double-booking', async () => {
    const drivers = await Promise.all([0, 1, 2].map((i) => registerApprovedDriver(`Driver ${String.fromCharCode(65 + i)}`)));
    for (const [i, d] of drivers.entries()) await goOnline(d, north(BOAC, 200 + i * 150));
    const passengers = await Promise.all(Array.from({ length: 5 }, (_, i) => approvedPassenger(`Rider ${String.fromCharCode(65 + i)}`)));
    const quotes = await Promise.all(passengers.map((p) => quoteFor(p)));
    await Promise.allSettled(
      passengers.map((p, i) => createRide(p, { requestId: requestId(), quoteId: quotes[i]!.quoteId, selectedDriverId: null, allowFallback: false, pickupNote: null })),
    );
    const rides = (await db().collection('rides').get()).docs.map((d) => d.data() as RideDoc);
    const offered = rides.filter((r) => r.offer).map((r) => r.offer!.driverId);
    expect(new Set(offered).size).toBe(offered.length);
    expect(offered.length).toBeLessThanOrEqual(drivers.length);
    for (const d of drivers) {
      const doc = await getDoc<DriverDoc>(`drivers/${d.uid}`);
      const holders = rides.filter((r) => r.offer?.driverId === d.uid);
      expect(holders.length).toBeLessThanOrEqual(1);
      if (holders.length === 1) expect(doc?.currentOfferRideId).toBe(holders[0]!.rideId);
    }
  });

  it('duplicate concurrent submissions of the same request create one ride', async () => {
    const driver = await registerApprovedDriver();
    await goOnline(driver);
    const p = await approvedPassenger();
    const q = await quoteFor(p);
    const rid = requestId();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => createRide(p, { requestId: rid, quoteId: q.quoteId, selectedDriverId: null, allowFallback: false, pickupNote: null })),
    );
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createRide>>> => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThan(0);
    expect(new Set(ok.map((r) => r.value.rideId)).size).toBe(1);
    expect((await db().collection('rides').get()).size).toBe(1);
  });

  it('concurrent accept taps, completions and payments are applied exactly once', async () => {
    const driver = await registerApprovedDriver();
    await goOnline(driver);
    const p = await approvedPassenger();
    const q = await quoteFor(p);
    const { rideId } = await createRide(p, { requestId: requestId(), quoteId: q.quoteId, selectedDriverId: null, allowFallback: false, pickupNote: null });

    const accepts = await Promise.allSettled(Array.from({ length: 4 }, () => respondToOffer(driver, { rideId, accept: true, declineReason: null })));
    expect(accepts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    const acceptedEvents = await db().collection(`rides/${rideId}/events`).where('type', '==', 'ACCEPTED').get();
    expect(acceptedEvents.size).toBe(1);

    await updateRideProgress(driver, { rideId, action: 'ARRIVED' });
    await updateRideProgress(driver, { rideId, action: 'START' });
    const total = (await getDoc<RideDoc>(`rides/${rideId}`))!.quote.total;
    const completions = await Promise.allSettled(Array.from({ length: 4 }, () => completeRide(driver, { rideId, cashCollected: total, adjustments: [] })));
    expect(completions.every((c) => c.status === 'fulfilled')).toBe(true);
    const completedEvents = await db().collection(`rides/${rideId}/events`).where('type', '==', 'COMPLETED').get();
    expect(completedEvents.size).toBe(1);
    const payment = await getDoc<PaymentDoc>(`payments/${rideId}`);
    expect(payment?.history).toHaveLength(1);
    expect((await getDoc<DriverDoc>(`drivers/${driver.uid}`))?.stats.completedTrips).toBe(1);
  });
});
