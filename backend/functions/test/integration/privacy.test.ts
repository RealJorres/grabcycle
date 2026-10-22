import { beforeEach, describe, expect, it } from 'vitest';
import { auth, bucket, db, rtdb } from '../../src/lib/firebase';
import { requestDataAction } from '../../src/services/accounts';
import type { RideDoc } from '../../src/services/models';
import { disputePayment } from '../../src/services/payments';
import { deleteUserData, DELETED, exportUserData, resolveDataRequest } from '../../src/services/privacy';
import { submitRating } from '../../src/services/ratings';
import { completeRide, createRide, respondToOffer, updateRideProgress } from '../../src/services/rides';
import { createSupportCase } from '../../src/services/support';
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
  requestId,
  resetEmulators,
  reviewer,
  seedConfig,
  support,
} from './helpers';

beforeEach(async () => {
  await resetEmulators();
  await seedConfig();
});

/** A completed, rated trip with a support report — the realistic footprint of a passenger. */
async function passengerWithHistory() {
  const p = await approvedPassenger('Maria Clara Santos');
  const d = await registerApprovedDriver('Jose Rizal Cruz');
  await goOnline(d, north(BOAC, 300));
  const q = await quoteFor(p);
  const booked = await createRide(p, { requestId: requestId(), quoteId: q.quoteId, selectedDriverId: null, allowFallback: false, pickupNote: 'Near the blue gate' });
  await respondToOffer(d, { rideId: booked.rideId, accept: true, declineReason: null });
  await updateRideProgress(d, { rideId: booked.rideId, action: 'EN_ROUTE' });
  await moveDriver(d.uid, north(BOAC, 20));
  await updateRideProgress(d, { rideId: booked.rideId, action: 'ARRIVED' });
  await updateRideProgress(d, { rideId: booked.rideId, action: 'START' });
  const total = (await getDoc<RideDoc>(`rides/${booked.rideId}`))!.quote.total;
  await completeRide(d, { rideId: booked.rideId, cashCollected: total, adjustments: [] });
  await submitRating(p, { rideId: booked.rideId, stars: 5, comment: 'Very kind driver, thank you', tags: [] });
  await createSupportCase(p, { rideId: booked.rideId, category: 'LOST_ITEM', description: 'I left my umbrella with my name tag on it.' });
  return { p, d, rideId: booked.rideId };
}

describe('data-subject requests', () => {
  it('exports the person’s own data without staff-internal content', async () => {
    const { p, rideId } = await passengerWithHistory();
    const { requestId: reqId } = await requestDataAction(p, { type: 'ACCESS', note: null });
    await expectReason(exportUserData(support, { requestId: reqId }), 'PERMISSION_DENIED');

    const data = await exportUserData(admin, { requestId: reqId });
    expect(data.uid).toBe(p.uid);
    expect(data.account?.displayName).toBe('Maria Clara Santos');
    expect(data.ridesAsPassenger.map((r) => r?.rideId)).toEqual([rideId]);
    expect(data.supportCases).toHaveLength(1);
    expect(data.identityVerifications).toHaveLength(1);
    const text = JSON.stringify(data);
    // No storage paths, reviewer notes or other people's phone numbers.
    expect(text).not.toContain('private/identity');
    expect(text).not.toContain('internalNote');
    expect(text).not.toMatch(/"driverPhone"/);
    expect((await getDoc<{ status: string }>(`dataRequests/${reqId}`))?.status).toBe('IN_PROGRESS');

    await resolveDataRequest(admin, { requestId: reqId, status: 'COMPLETED', resolutionNote: 'Sent to the registered number.' });
    await expectReason(exportUserData(admin, { requestId: reqId }), 'INVALID_STATE_TRANSITION');
    const audit = await db().collection('auditLogs').where('targetUid', '==', p.uid).get();
    expect(audit.docs.map((x) => x.get('action'))).toEqual(expect.arrayContaining(['DATA_REQUEST_RECEIVED', 'DATA_EXPORTED', 'DATA_REQUEST_COMPLETED']));
  });

  it('deletes the account and files, and anonymises records that must be retained', async () => {
    const { p, d, rideId } = await passengerWithHistory();
    const { requestId: reqId } = await requestDataAction(p, { type: 'DELETION', note: null });
    const [idFiles] = await bucket().getFiles({ prefix: `private/identity/${p.uid}/` });
    expect(idFiles.length).toBeGreaterThan(0);

    await expectReason(deleteUserData(reviewer, { requestId: reqId, confirmUid: p.uid }), 'PERMISSION_DENIED');
    await expectReason(deleteUserData(admin, { requestId: reqId, confirmUid: 'someone-else' }), 'INVALID_ARGUMENT');

    const res = await deleteUserData(admin, { requestId: reqId, confirmUid: p.uid });
    expect(res.status).toBe('COMPLETED');

    // Gone: sign-in, profile, files.
    await expect(auth().getUser(p.uid)).rejects.toMatchObject({ code: 'auth/user-not-found' });
    expect(await getDoc(`users/${p.uid}`)).toBeUndefined();
    expect((await bucket().getFiles({ prefix: `private/identity/${p.uid}/` }))[0]).toHaveLength(0);

    // Retained but anonymised: the trip, the payment, the rating, the report, the review decision.
    const ride = await getDoc<RideDoc>(`rides/${rideId}`);
    expect(ride?.status).toBe('COMPLETED');
    expect(ride?.passenger.firstName).toBe(DELETED);
    expect(ride?.pickup.note ?? null).toBeNull();
    expect(await getDoc(`payments/${rideId}`)).toBeDefined();
    expect((await getDoc<{ comment: string | null; stars: number }>(`ratings/${rideId}_PASSENGER`))).toMatchObject({ comment: null, stars: 5 });
    const cases = await db().collection('supportCases').where('reporterUid', '==', p.uid).get();
    expect(cases.docs[0]?.get('description')).toBe(DELETED);
    const vcase = await db().collection('verificationCases').where('uid', '==', p.uid).get();
    expect(vcase.docs[0]?.get('nameOnId')).toBe(DELETED);
    expect(vcase.docs[0]?.get('files')).toEqual([]);

    // The driver's account is untouched.
    expect(await getDoc(`drivers/${d.uid}`)).toBeDefined();
    expect((await getDoc<{ status: string }>(`dataRequests/${reqId}`))?.status).toBe('COMPLETED');
    const audit = await db().collection('auditLogs').where('action', '==', 'DATA_DELETION_COMPLETED').get();
    expect(audit.size).toBe(1);
  });

  it('refuses deletion during an active trip or an open dispute, and for the wrong request type', async () => {
    const p = await approvedPassenger();
    const d = await registerApprovedDriver();
    await goOnline(d, north(BOAC, 300));
    const q = await quoteFor(p);
    const booked = await createRide(p, { requestId: requestId(), quoteId: q.quoteId, selectedDriverId: null, allowFallback: false, pickupNote: null });
    await respondToOffer(d, { rideId: booked.rideId, accept: true, declineReason: null });
    const { requestId: delId } = await requestDataAction(p, { type: 'DELETION', note: null });
    await expectReason(deleteUserData(admin, { requestId: delId, confirmUid: p.uid }), 'INVALID_STATE_TRANSITION');

    const { requestId: accessId } = await requestDataAction(p, { type: 'ACCESS', note: null });
    await expectReason(deleteUserData(admin, { requestId: accessId, confirmUid: p.uid }), 'INVALID_ARGUMENT');

    // Finish the trip, then dispute the payment: still refused until resolved.
    await updateRideProgress(d, { rideId: booked.rideId, action: 'EN_ROUTE' });
    await moveDriver(d.uid, north(BOAC, 20));
    await updateRideProgress(d, { rideId: booked.rideId, action: 'ARRIVED' });
    await updateRideProgress(d, { rideId: booked.rideId, action: 'START' });
    await completeRide(d, { rideId: booked.rideId, cashCollected: null, adjustments: [] });
    await disputePayment(p, { rideId: booked.rideId, description: 'The fare was higher than quoted.' });
    await expectReason(deleteUserData(admin, { requestId: delId, confirmUid: p.uid }), 'INVALID_STATE_TRANSITION');
    // Nothing was deleted by the refused attempts.
    expect(await getDoc(`users/${p.uid}`)).toBeDefined();
    expect((await rtdb().ref(`locations/${d.uid}`).once('value')).exists()).toBe(true);
  });
});
