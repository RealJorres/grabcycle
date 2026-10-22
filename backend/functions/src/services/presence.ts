import { boundsOf } from '../domain/geo';
import { getConfig } from '../lib/configStore';
import { rtdb } from '../lib/firebase';
import { log } from '../lib/log';

/**
 * Realtime Database presence mirror.
 *
 * Firestore `drivers/{uid}.availability` is authoritative. RTDB
 * `/presence/{uid}` is derived from it and gates location publishing via
 * security rules (`canPublish` + `sessionId`). `trackingPassengerUid` grants
 * exactly one passenger read access to the driver's live location during an
 * active trip.
 */

export interface PresenceState {
  canPublish: boolean;
  sessionId: string | null;
  trackingPassengerUid: string | null;
}

export async function setPresence(uid: string, state: PresenceState): Promise<void> {
  await rtdb().ref(`presence/${uid}`).set({ ...state, updatedAt: Date.now() });
}

export async function setTrackingPassenger(driverUid: string, passengerUid: string | null): Promise<void> {
  try {
    await rtdb().ref(`presence/${driverUid}/trackingPassengerUid`).set(passengerUid);
  } catch (err) {
    log.warn('presence.tracking_failed', { message: err instanceof Error ? err.message : String(err) });
  }
}

/** Revokes publishing rights and removes the live location (best effort; reconciled by a sweeper). */
export async function revokePresence(uid: string): Promise<void> {
  try {
    await rtdb().ref().update({
      [`presence/${uid}`]: { canPublish: false, sessionId: null, trackingPassengerUid: null, updatedAt: Date.now() },
      [`locations/${uid}`]: null,
    });
  } catch (err) {
    log.warn('presence.revoke_failed', { message: err instanceof Error ? err.message : String(err) });
  }
}

/** Writes the service-area bounding box used by RTDB rules to validate coordinates. */
export async function syncServiceBounds(): Promise<void> {
  const area = await getConfig('serviceArea');
  await rtdb().ref('config/bounds').set(boundsOf(area.polygons.map((p) => p.points), area.boundsMarginDeg));
}
