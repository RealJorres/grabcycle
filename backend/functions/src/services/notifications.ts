import { db, messaging } from '../lib/firebase';
import { randomId } from '../lib/ids';
import { log } from '../lib/log';
import { now, ts } from '../lib/time';

/**
 * Push notifications (FCM). Notifications are ALERTS ONLY: the app always
 * re-reads authoritative state from Firestore when one arrives, so a lost,
 * duplicated, delayed or out-of-order message never changes business state.
 *
 * Payloads carry no addresses, names of the other party, ID data or URLs.
 */

export type NotificationType =
  | 'RIDE_OFFER'
  | 'RIDE_ACCEPTED'
  | 'DRIVER_EN_ROUTE'
  | 'DRIVER_ARRIVED'
  | 'TRIP_STARTED'
  | 'TRIP_COMPLETED'
  | 'RIDE_CANCELLED'
  | 'NO_DRIVER_FOUND'
  | 'OFFER_EXPIRED'
  | 'VERIFICATION_UPDATE'
  | 'ACCREDITATION_UPDATE'
  | 'DOCUMENT_EXPIRY'
  | 'ACCOUNT_UPDATE'
  | 'SUPPORT_UPDATE'
  | 'PAYMENT_UPDATE';

export interface PushMessage {
  type: NotificationType;
  title: string;
  body: string;
  rideId?: string;
  /** Data-only high-priority delivery (used for driver ride offers). */
  urgent?: boolean;
  /** Seconds the message stays relevant (e.g. the offer window). */
  ttlSeconds?: number;
}

type Sender = (tokens: string[], msg: PushMessage & { eventId: string; sentAt: number }) => Promise<string[]>;

/** Default sender: returns tokens that are permanently invalid. */
const fcmSender: Sender = async (tokens, msg) => {
  const response = await messaging().sendEachForMulticast({
    tokens,
    data: {
      type: msg.type,
      eventId: msg.eventId,
      sentAt: String(msg.sentAt),
      ...(msg.rideId ? { rideId: msg.rideId } : {}),
      title: msg.title,
      body: msg.body,
    },
    android: {
      priority: msg.urgent ? 'high' : 'normal',
      ttl: (msg.ttlSeconds ?? 3600) * 1000,
      collapseKey: msg.rideId ? `ride-${msg.rideId}` : msg.type,
    },
  });
  const invalid: string[] = [];
  response.responses.forEach((r, i) => {
    const code = r.error?.code ?? '';
    if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) invalid.push(tokens[i]!);
  });
  return invalid;
};

let sender: Sender = fcmSender;
const sentForTesting: Array<{ uid: string; message: PushMessage }> = [];
let captureForTesting = false;

export function useNotificationCaptureForTesting(enabled: boolean): Array<{ uid: string; message: PushMessage }> {
  captureForTesting = enabled;
  sentForTesting.length = 0;
  sender = enabled ? async () => [] : fcmSender;
  return sentForTesting;
}

export async function notifyUser(uid: string, message: PushMessage): Promise<void> {
  if (captureForTesting) sentForTesting.push({ uid, message });
  try {
    const devices = await db().collection('users').doc(uid).collection('devices').limit(10).get();
    const tokens = devices.docs.map((d) => d.get('token')).filter((t): t is string => typeof t === 'string' && t.length > 0);
    if (tokens.length === 0) return;
    const invalid = await sender(tokens, { ...message, eventId: randomId(9), sentAt: now() });
    if (invalid.length > 0) {
      const batch = db().batch();
      devices.docs.filter((d) => invalid.includes(d.get('token'))).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (err) {
    // Best effort: notification failures never fail the business operation.
    log.warn('notify.failed', { type: message.type, message: err instanceof Error ? err.message : String(err) });
  }
}

export async function registerDeviceToken(uid: string, installationId: string, token: string, platform: string): Promise<void> {
  // A token belongs to one account at a time: remove it from any other user.
  const others = await db().collectionGroup('devices').where('token', '==', token).limit(10).get();
  const batch = db().batch();
  others.docs.filter((d) => d.ref.parent.parent?.id !== uid).forEach((d) => batch.delete(d.ref));
  batch.set(db().collection('users').doc(uid).collection('devices').doc(installationId), {
    token,
    platform,
    updatedAt: ts(now()),
  });
  await batch.commit();
}
