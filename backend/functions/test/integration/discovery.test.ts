import { beforeEach, describe, expect, it } from 'vitest';
import { rtdb } from '../../src/lib/firebase';
import { setClockForTesting } from '../../src/lib/time';
import { setAccountStatus } from '../../src/services/admin';
import { setDriverAvailability } from '../../src/services/availability';
import { findNearbyDrivers } from '../../src/services/discovery';
import { decideDriver } from '../../src/services/drivers';
import { setMapsProviderForTesting, type MapsProvider } from '../../src/services/maps';
import type { DriverDoc } from '../../src/services/models';
import { getFareQuote, loadValidQuote } from '../../src/services/quotes';
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
  registerDriver,
  registerPassenger,
  resetEmulators,
  seedConfig,
  submitAllDriverDocuments,
} from './helpers';

beforeEach(async () => {
  await resetEmulators();
  await seedConfig();
  setMapsProviderForTesting(null);
});

describe('driver availability', () => {
  it('an approved driver goes online only through the backend, which issues a presence session', async () => {
    const d = await registerApprovedDriver();
    const res = await goOnline(d);
    expect(res.availability).toBe('ONLINE');
    expect(res.sessionId).toBeTruthy();
    const presence = (await rtdb().ref(`presence/${d.uid}`).once('value')).val();
    expect(presence).toMatchObject({ canPublish: true, sessionId: res.sessionId });
    const loc = (await rtdb().ref(`locations/${d.uid}`).once('value')).val();
    expect(loc.sid).toBe(res.sessionId);
    // Idempotent
    expect((await goOnline(d)).sessionId).toBe(res.sessionId);
  });

  it('unapproved drivers cannot go online, with explicit reasons', async () => {
    const d = await registerDriver();
    await submitAllDriverDocuments(d);
    const err = await expectReason(goOnline(d), 'DRIVER_NOT_ELIGIBLE');
    expect(err.meta.reasons).toContain('DRIVER_NOT_APPROVED');
    expect((await rtdb().ref(`presence/${d.uid}`).once('value')).val()).toBeNull();
  });

  it('requires an accurate, non-mock location inside the service area', async () => {
    const d = await registerApprovedDriver();
    await expectReason(setDriverAvailability(d, { online: true, location: null }), 'LOCATION_REQUIRED');
    await expectReason(setDriverAvailability(d, { online: true, location: { ...BOAC, accuracy: 500, mock: false } }), 'LOCATION_REQUIRED');
    await expectReason(setDriverAvailability(d, { online: true, location: { ...BOAC, accuracy: 10, mock: true } }), 'LOCATION_REQUIRED');
    await expectReason(
      setDriverAvailability(d, { online: true, location: { lat: 14.5995, lng: 120.9842, accuracy: 10, mock: false } }),
      'OUTSIDE_SERVICE_AREA',
    );
  });

  it('going offline revokes publishing rights and removes the live location', async () => {
    const d = await registerApprovedDriver();
    await goOnline(d);
    await setDriverAvailability(d, { online: false, location: null });
    expect((await getDoc<DriverDoc>(`drivers/${d.uid}`))?.availability).toBe('OFFLINE');
    expect((await rtdb().ref(`presence/${d.uid}/canPublish`).once('value')).val()).toBe(false);
    expect((await rtdb().ref(`locations/${d.uid}`).once('value')).val()).toBeNull();
  });

  it('suspension takes an online driver offline; reapproval does not silently restore availability', async () => {
    const d = await registerApprovedDriver();
    await goOnline(d);
    await decideDriver(admin, { driverUid: d.uid, decision: 'SUSPEND', reasonCode: 'COMPLAINT', publicMessage: 'Under review.', internalNote: null });
    expect((await getDoc<DriverDoc>(`drivers/${d.uid}`))?.availability).toBe('OFFLINE');
    expect((await rtdb().ref(`presence/${d.uid}/canPublish`).once('value')).val()).toBe(false);
    await decideDriver(admin, { driverUid: d.uid, decision: 'REINSTATE', reasonCode: null, publicMessage: null, internalNote: null });
    expect((await getDoc<DriverDoc>(`drivers/${d.uid}`))?.availability).toBe('OFFLINE');
  });
});

describe('nearby driver discovery', () => {
  it('requires an approved passenger', async () => {
    const p = await registerPassenger();
    await expectReason(findNearbyDrivers(p, { pickup: BOAC, expand: false }), 'PASSENGER_NOT_VERIFIED');
  });

  it('returns only eligible drivers with fresh locations, nearest first, with coarse positions', async () => {
    const p = await approvedPassenger();
    const near = await registerApprovedDriver('Near Driver');
    const mid = await registerApprovedDriver('Mid Driver');
    const far = await registerApprovedDriver('Far Driver');
    const stale = await registerApprovedDriver('Stale Driver');
    const offline = await registerApprovedDriver('Offline Driver');
    for (const d of [near, mid, far, stale]) await goOnline(d, north(BOAC, 100));
    await moveDriver(near.uid, north(BOAC, 300));
    await moveDriver(mid.uid, north(BOAC, 1500));
    await moveDriver(far.uid, north(BOAC, 3500));
    await moveDriver(stale.uid, north(BOAC, 200), { ageMs: 60_000 });
    // An offline driver with a leftover location record must not appear.
    await moveDriver(offline.uid, north(BOAC, 150));

    const res = await findNearbyDrivers(p, { pickup: BOAC, expand: false });
    expect(res.drivers.map((x) => x.driverId)).toEqual([near.uid, mid.uid]);
    expect(res.radiusMeters).toBe(2000);
    const first = res.drivers[0]!;
    expect(first.displayName).toBe('Near D.');
    expect(first.distanceKind).toBe('STRAIGHT_LINE');
    expect(first.approxLocation.lat.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
    expect(JSON.stringify(res)).not.toContain('123ABC'); // no plate numbers before acceptance

    const wide = await findNearbyDrivers(p, { pickup: BOAC, expand: true });
    expect(wide.drivers.map((x) => x.driverId)).toEqual([near.uid, mid.uid, far.uid]);
    expect(wide.maxRadiusReached).toBe(true);
  });

  it('expands the radius when nobody is close and reports when none are found', async () => {
    const p = await approvedPassenger();
    const d = await registerApprovedDriver();
    await goOnline(d, north(BOAC, 2600));
    const res = await findNearbyDrivers(p, { pickup: BOAC, expand: false });
    expect(res.drivers).toHaveLength(1);
    expect(res.radiusMeters).toBe(3000);

    await setDriverAvailability(d, { online: false, location: null });
    const none = await findNearbyDrivers(p, { pickup: BOAC, expand: false });
    expect(none.drivers).toEqual([]);
    expect(none.maxRadiusReached).toBe(true);
  });

  it('inaccurate locations and suspended accounts are excluded', async () => {
    const p = await approvedPassenger();
    const inaccurate = await registerApprovedDriver();
    const suspended = await registerApprovedDriver();
    await goOnline(inaccurate);
    await goOnline(suspended);
    await moveDriver(inaccurate.uid, north(BOAC, 100), { acc: 400 });
    await setAccountStatus(admin, { uid: suspended.uid, status: 'SUSPENDED', reasonCode: 'X_TEST', publicMessage: 'Suspended for testing.', internalNote: null });
    const res = await findNearbyDrivers(p, { pickup: BOAC, expand: true });
    expect(res.drivers).toEqual([]);
  });
});

describe('fare quotes', () => {
  it('uses a straight-line estimate when routing is unavailable, clearly labelled', async () => {
    const p = await registerPassenger();
    const q = await quoteFor(p);
    expect(q.distanceSource).toBe('STRAIGHT_LINE_ESTIMATE');
    expect(q.durationSeconds).toBeNull();
    expect(q.polyline).toBeNull();
    expect(q.notice).toMatch(/straight-line/);
    expect(q.fareIsSample).toBe(true);
    expect(q.lines.reduce((s, l) => s + l.amount, 0)).toBe(q.total);
  });

  it('uses road distance and duration from the route provider when available', async () => {
    const fake: MapsProvider = {
      computeRoute: async () => ({ distanceMeters: 5200, durationSeconds: 840, polyline: 'abc' }),
      durationsTo: async () => null,
      searchText: async () => null,
      reverseGeocode: async () => null,
    };
    setMapsProviderForTesting(fake);
    const p = await registerPassenger();
    const q = await quoteFor(p);
    expect(q.distanceSource).toBe('ROUTE');
    expect(q.distanceMeters).toBe(5200);
    expect(q.durationSeconds).toBe(840);
    // Sample: ₱20 base (1 km) + 5 units x ₱5 = ₱45
    expect(q.total).toBe(4500);
  });

  it('rejects trips outside the service area or too short', async () => {
    const p = await registerPassenger();
    await expectReason(quoteFor(p, BOAC, { lat: 14.5995, lng: 120.9842 }), 'OUTSIDE_SERVICE_AREA');
    await expectReason(quoteFor(p, BOAC, north(BOAC, 20)), 'PICKUP_EQUALS_DESTINATION');
  });

  it('quotes belong to one passenger and expire', async () => {
    const p = await registerPassenger();
    const other = await registerPassenger('Maria Clara');
    const q = await quoteFor(p);
    await expectReason(loadValidQuote(other.uid, q.quoteId), 'QUOTE_MISMATCH');
    setClockForTesting(() => Date.now() + 11 * 60_000);
    await expectReason(loadValidQuote(p.uid, q.quoteId), 'QUOTE_EXPIRED');
  });

  it('client-supplied fares are impossible: the quote input has no amount fields', async () => {
    const p = await registerPassenger();
    await expect(
      getFareQuote(p, { pickup: { ...BOAC, address: 'A', placeId: null }, destination: { lat: 13.475, lng: 121.8617, address: 'B', placeId: null }, passengers: 9 }),
    ).rejects.toThrow();
  });
});
