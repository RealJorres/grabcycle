import { FieldValue } from 'firebase-admin/firestore';
import { fail } from '../domain/errors';
import { db } from './firebase';
import { now, ts } from './time';

/**
 * Fixed-window rate limiter backed by Firestore so limits hold across all
 * function instances. Documents carry `expiresAt` for a Firestore TTL policy.
 */
export interface RateLimit {
  limit: number;
  windowSec: number;
}

export const RATE_LIMITS = {
  completeRegistration: { limit: 10, windowSec: 3600 },
  submitVerification: { limit: 10, windowSec: 86_400 },
  submitDriverDocument: { limit: 40, windowSec: 86_400 },
  saveDriverProfile: { limit: 30, windowSec: 3600 },
  availability: { limit: 60, windowSec: 3600 },
  fareQuote: { limit: 60, windowSec: 600 },
  discovery: { limit: 120, windowSec: 600 },
  placesSearch: { limit: 60, windowSec: 600 },
  createRide: { limit: 10, windowSec: 600 },
  cancelRide: { limit: 20, windowSec: 3600 },
  supportCase: { limit: 10, windowSec: 86_400 },
  rating: { limit: 30, windowSec: 3600 },
  registerDevice: { limit: 30, windowSec: 3600 },
  documentView: { limit: 600, windowSec: 3600 },
  dataRequest: { limit: 3, windowSec: 86_400 },
} satisfies Record<string, RateLimit>;

export type RateLimitKey = keyof typeof RATE_LIMITS;

export async function enforceRateLimit(uid: string, key: RateLimitKey): Promise<void> {
  const { limit, windowSec } = RATE_LIMITS[key];
  const ref = db().collection('rateLimits').doc(`${key}:${uid}`);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const nowMs = now();
    const data = snap.data() as { windowStart: number; count: number } | undefined;
    const windowMs = windowSec * 1000;
    if (!data || nowMs - data.windowStart >= windowMs) {
      tx.set(ref, { windowStart: nowMs, count: 1, expiresAt: ts(nowMs + windowMs) });
      return;
    }
    if (data.count >= limit) {
      throw fail.rateLimited(Math.max(1, Math.ceil((data.windowStart + windowMs - nowMs) / 1000)));
    }
    tx.update(ref, { count: FieldValue.increment(1) });
  });
}
