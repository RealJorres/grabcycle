import { ServerValue } from 'firebase-admin/database';
import { geohashForLocation } from 'geofire-common';
import { AppError, fail } from '../domain/errors';
import { boundsOf } from '../domain/geo';
import { isInServiceArea, isWithinOperatingHours } from '../domain/serviceArea';
import { writeAudit } from '../lib/audit';
import { getConfig } from '../lib/configStore';
import type { CallerContext } from '../lib/context';
import { db, rtdb } from '../lib/firebase';
import { randomId } from '../lib/ids';
import { log } from '../lib/log';
import { enforceRateLimit } from '../lib/rateLimit';
import { millis, now, nowTs, ts } from '../lib/time';
import { driversCol, requireActiveUser } from './accounts';
import { evaluateDriver, loadDriverState, writeEvaluation } from './drivers';
import type { DriverDoc } from './models';
import { notifyUser } from './notifications';
import { revokePresence, setPresence } from './presence';
import { declineOffer, readLocation } from './rideMatching';

/**
 * Driver online/offline transitions. The app's switch only REQUESTS a change;
 * the backend decides after re-checking account standing, accreditation,
 * document validity, vehicle approval, active trips and an initial location
 * fix inside the service area.
 */

export interface GoOnlineLocation {
  lat: number;
  lng: number;
  accuracy: number;
  mock: boolean;
}

export async function setDriverAvailability(ctx: CallerContext, input: { online: boolean; location: GoOnlineLocation | null }) {
  await requireActiveUser(ctx.uid, 'DRIVER');
  await enforceRateLimit(ctx.uid, 'availability');
  return input.online ? goOnline(ctx, input.location) : goOffline(ctx);
}

async function goOnline(ctx: CallerContext, location: GoOnlineLocation | null) {
  const [policy, cfg, area] = await Promise.all([getConfig('documentPolicy'), getConfig('matching'), getConfig('serviceArea')]);
  if (!location) throw fail.precondition('LOCATION_REQUIRED', 'Turn on location so passengers can find you.');
  if (location.mock && cfg.rejectMockLocations) {
    throw fail.precondition('LOCATION_REQUIRED', 'Mock locations are not allowed. Disable location-spoofing apps to go online.');
  }
  if (location.accuracy > cfg.maxLocationAccuracyM) {
    throw fail.precondition('LOCATION_REQUIRED', 'Your location is not accurate enough yet. Move to an open area and try again.', {
      accuracy: location.accuracy,
      required: cfg.maxLocationAccuracyM,
    });
  }
  if (!isInServiceArea(area, location)) {
    throw fail.precondition('OUTSIDE_SERVICE_AREA', 'You must be inside the GrabCycle service area to go online.');
  }
  if (!isWithinOperatingHours(area, now())) throw fail.precondition('SERVICE_CLOSED', 'GrabCycle is closed at this hour.');

  let ineligible: { reasons: string[] } | null = null;
  const result = await db().runTransaction(async (tx) => {
    const state = await loadDriverState(tx, ctx.uid);
    const evaluation = evaluateDriver(state, policy.driverRequirements, now());
    if (!evaluation.eligibility?.eligible) {
      writeEvaluation(tx, state, evaluation);
      ineligible = { reasons: evaluation.eligibility?.reasons ?? [] };
      return null;
    }
    const d = state.driver;
    if (d.availability !== 'OFFLINE' && d.presenceSessionId) {
      // Already online (or mid-offer / trip): idempotent.
      writeEvaluation(tx, state, evaluation);
      return { availability: d.availability, sessionId: d.presenceSessionId, resumed: true };
    }
    if (d.currentRideId) throw fail.precondition('DRIVER_HAS_ACTIVE_TRIP', 'Finish your current trip first.');
    const sessionId = randomId(12);
    writeEvaluation(tx, state, evaluation, {
      availability: 'ONLINE',
      presenceSessionId: sessionId,
      currentOfferRideId: null,
      missedOffers: 0,
      availabilityChangedAt: nowTs(),
      lastOnlineAt: nowTs(),
    });
    writeAudit(tx, {
      category: 'OPERATIONS',
      action: 'DRIVER_ONLINE',
      actorUid: ctx.uid,
      actorRole: 'DRIVER',
      targetType: 'driver',
      targetId: ctx.uid,
      targetUid: ctx.uid,
    });
    return { availability: 'ONLINE' as const, sessionId, resumed: false };
  });

  if (!result) {
    throw new AppError('failed-precondition', 'DRIVER_NOT_ELIGIBLE', 'You cannot go online yet.', {
      reasons: (ineligible as { reasons: string[] } | null)?.reasons ?? [],
    });
  }

  try {
    const driver = (await driversCol().doc(ctx.uid).get()).data() as DriverDoc;
    await setPresence(ctx.uid, {
      canPublish: true,
      sessionId: result.sessionId,
      trackingPassengerUid: driver.currentRideId ? ((await db().collection('rides').doc(driver.currentRideId).get()).get('passengerUid') ?? null) : null,
    });
    // Seed the live location with a server timestamp so freshness starts now.
    await rtdb()
      .ref(`locations/${ctx.uid}`)
      .set({
        lat: location.lat,
        lng: location.lng,
        acc: Math.round(location.accuracy),
        g: geohashForLocation([location.lat, location.lng], 10),
        ts: ServerValue.TIMESTAMP,
        sid: result.sessionId,
        mock: location.mock,
      });
  } catch (err) {
    // Without presence the driver could not publish locations: roll back to OFFLINE.
    log.error('availability.presence_failed', { message: err instanceof Error ? err.message : String(err) });
    await driversCol().doc(ctx.uid).update({ availability: 'OFFLINE', presenceSessionId: null, availabilityChangedAt: nowTs() });
    throw new AppError('unavailable', 'SERVICE_UNAVAILABLE', 'Could not go online. Please try again.');
  }

  return {
    availability: result.availability,
    sessionId: result.sessionId,
    locationUpdateIntervalSec: cfg.locationUpdateIntervalSec,
    locationFreshnessSec: cfg.locationFreshnessSec,
    maxLocationAccuracyM: cfg.maxLocationAccuracyM,
    bounds: boundsOf(area.polygons.map((p) => p.points), area.boundsMarginDeg),
  };
}

async function goOffline(ctx: CallerContext) {
  const snap = await driversCol().doc(ctx.uid).get();
  const driver = snap.data() as DriverDoc | undefined;
  if (!driver) throw fail.precondition('ACCOUNT_NOT_REGISTERED', 'Driver profile not found.');
  if (driver.currentRideId) {
    throw fail.precondition('DRIVER_HAS_ACTIVE_TRIP', 'You have an active trip. Complete or cancel it before going offline.', {
      rideId: driver.currentRideId,
    });
  }
  if (driver.currentOfferRideId) await declineOffer(ctx.uid, driver.currentOfferRideId, 'DRIVER_WENT_OFFLINE');

  await db().runTransaction(async (tx) => {
    const ref = driversCol().doc(ctx.uid);
    const d = (await tx.get(ref)).data() as DriverDoc;
    if (d.currentRideId) throw fail.precondition('DRIVER_HAS_ACTIVE_TRIP', 'You have an active trip.');
    if (d.availability === 'OFFLINE' && !d.presenceSessionId) return;
    tx.update(ref, { availability: 'OFFLINE', presenceSessionId: null, currentOfferRideId: null, availabilityChangedAt: nowTs(), updatedAt: nowTs() });
    writeAudit(tx, {
      category: 'OPERATIONS',
      action: 'DRIVER_OFFLINE',
      actorUid: ctx.uid,
      actorRole: 'DRIVER',
      targetType: 'driver',
      targetId: ctx.uid,
      targetUid: ctx.uid,
    });
  });
  await revokePresence(ctx.uid);
  return { availability: 'OFFLINE' as const };
}

/**
 * Scheduled reconciliation:
 *  - ONLINE drivers whose location has been stale for too long go OFFLINE
 *    (they are already excluded from matching as soon as it is stale);
 *  - RTDB publishing rights are revoked for drivers Firestore says are offline.
 */
export async function sweepStaleDrivers(): Promise<{ offline: number; revoked: number }> {
  const cfg = await getConfig('matching');
  const nowMs = now();
  const staleMs = cfg.staleDriverAutoOfflineMin * 60_000;
  let offline = 0;
  const online = await driversCol().where('availability', '==', 'ONLINE').limit(1000).get();
  for (const doc of online.docs) {
    const d = doc.data() as DriverDoc;
    const loc = await readLocation(doc.id);
    const lastSeen = loc?.sid === d.presenceSessionId ? loc.ts : (millis(d.lastOnlineAt) ?? 0);
    if (nowMs - lastSeen < staleMs) continue;
    const changed = await db().runTransaction(async (tx) => {
      const fresh = (await tx.get(doc.ref)).data() as DriverDoc;
      if (fresh.availability !== 'ONLINE' || fresh.presenceSessionId !== d.presenceSessionId) return false;
      tx.update(doc.ref, { availability: 'OFFLINE', presenceSessionId: null, availabilityChangedAt: ts(nowMs), updatedAt: ts(nowMs) });
      return true;
    });
    if (changed) {
      offline++;
      await revokePresence(doc.id);
      await notifyUser(doc.id, {
        type: 'ACCOUNT_UPDATE',
        title: 'You are now offline',
        body: 'We stopped receiving your location, so you were set offline. Go online again when you are ready.',
      });
    }
  }

  let revoked = 0;
  const presence = await rtdb().ref('presence').orderByChild('canPublish').equalTo(true).once('value');
  const uids: string[] = [];
  presence.forEach((child) => {
    uids.push(child.key!);
    return false;
  });
  for (const uid of uids) {
    const d = (await driversCol().doc(uid).get()).data() as DriverDoc | undefined;
    if (!d || d.availability === 'OFFLINE' || !d.presenceSessionId) {
      await revokePresence(uid);
      revoked++;
    }
  }
  return { offline, revoked };
}
