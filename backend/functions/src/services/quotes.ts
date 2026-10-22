import type { Timestamp } from 'firebase-admin/firestore';
import { billableDistance, computeFare } from '../domain/fare';
import { fail } from '../domain/errors';
import { distanceMeters } from '../domain/geo';
import { isInServiceArea, isWithinOperatingHours } from '../domain/serviceArea';
import type { Place } from '../domain/types';
import { getActiveFareConfig, getConfig } from '../lib/configStore';
import type { CallerContext } from '../lib/context';
import { db } from '../lib/firebase';
import { enforceRateLimit } from '../lib/rateLimit';
import { millis, now, ts } from '../lib/time';
import { requireActiveUser } from './accounts';
import { maps } from './maps';
import type { RideQuoteSnapshot, UserDoc } from './models';

/**
 * Fare quotes. The server computes every amount from the active, versioned
 * fare rules; the client only displays it. Quotes are stored so a booking
 * references exactly what the passenger saw, and expire after a short TTL.
 */

export const MIN_TRIP_METERS = 100;
export const quotesCol = () => db().collection('fareQuotes');

export interface QuoteDoc extends Omit<RideQuoteSnapshot, 'quoteId'> {
  passengerUid: string;
  pickup: Place;
  destination: Place;
  fareLabel: string;
  zoneFrom: string | null;
  zoneTo: string | null;
  polyline: string | null;
  discountCode: string | null;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

function activeDiscount(user: UserDoc, nowMs: number): string | null {
  const d = user.fareDiscount;
  if (!d) return null;
  if (d.expiresAt && millis(d.expiresAt)! <= nowMs) return null;
  return d.code;
}

export async function getFareQuote(ctx: CallerContext, input: { pickup: Place; destination: Place; passengers: number }) {
  const user = await requireActiveUser(ctx.uid, 'PASSENGER');
  await enforceRateLimit(ctx.uid, 'fareQuote');
  const [area, cfg, fare] = await Promise.all([getConfig('serviceArea'), getConfig('matching'), getActiveFareConfig()]);
  if (!isInServiceArea(area, input.pickup)) {
    throw fail.precondition('OUTSIDE_SERVICE_AREA', 'The pickup point is outside the GrabCycle service area.', { which: 'PICKUP' });
  }
  if (!isInServiceArea(area, input.destination)) {
    throw fail.precondition('OUTSIDE_SERVICE_AREA', 'The destination is outside the GrabCycle service area.', { which: 'DESTINATION' });
  }
  const nowMs = now();
  if (!isWithinOperatingHours(area, nowMs)) throw fail.precondition('SERVICE_CLOSED', 'GrabCycle is closed at this hour.');

  const straight = distanceMeters(input.pickup, input.destination);
  if (straight < MIN_TRIP_METERS) {
    throw fail.precondition('PICKUP_EQUALS_DESTINATION', 'The destination is too close to the pickup point.');
  }

  const route = await maps().computeRoute(input.pickup, input.destination);
  const { distanceMeters: billable, source } = billableDistance(fare.config, route?.distanceMeters ?? null, straight);
  const discountCode = activeDiscount(user, nowMs);
  const result = computeFare(fare.config, {
    distanceMeters: billable,
    pickup: input.pickup,
    destination: input.destination,
    passengers: input.passengers,
    atMillis: nowMs,
    discountCode,
  });

  const ref = quotesCol().doc();
  const doc: QuoteDoc = {
    passengerUid: ctx.uid,
    pickup: input.pickup,
    destination: input.destination,
    passengers: input.passengers,
    total: result.total,
    currency: result.currency,
    lines: result.lines,
    fareVersion: fare.version,
    fareIsSample: fare.config.isSample,
    fareLabel: fare.config.label,
    zoneFrom: result.zoneFrom,
    zoneTo: result.zoneTo,
    distanceMeters: billable,
    distanceSource: source,
    // ETAs are only reported when a real route was computed.
    durationSeconds: source === 'ROUTE' ? (route?.durationSeconds ?? null) : null,
    polyline: source === 'ROUTE' ? (route?.polyline ?? null) : null,
    discountCode,
    createdAt: ts(nowMs),
    expiresAt: ts(nowMs + cfg.quoteTtlSec * 1000),
  };
  await ref.set(doc);

  return {
    quoteId: ref.id,
    total: doc.total,
    currency: doc.currency,
    lines: doc.lines,
    fareVersion: doc.fareVersion,
    fareLabel: doc.fareLabel,
    fareIsSample: doc.fareIsSample,
    distanceMeters: doc.distanceMeters,
    distanceSource: doc.distanceSource,
    durationSeconds: doc.durationSeconds,
    polyline: doc.polyline,
    passengers: doc.passengers,
    expiresAt: nowMs + cfg.quoteTtlSec * 1000,
    notice:
      source === 'STRAIGHT_LINE_ESTIMATE'
        ? 'Road distance is unavailable right now. This estimate is based on straight-line distance and may differ from the actual route.'
        : null,
  };
}

/** Loads a quote for booking, enforcing ownership and expiry. */
export async function loadValidQuote(passengerUid: string, quoteId: string): Promise<QuoteDoc & { quoteId: string }> {
  const snap = await quotesCol().doc(quoteId).get();
  const q = snap.data() as QuoteDoc | undefined;
  if (!q || q.passengerUid !== passengerUid) throw fail.precondition('QUOTE_MISMATCH', 'This fare estimate is not valid. Please refresh it.');
  if (millis(q.expiresAt)! <= now()) throw fail.precondition('QUOTE_EXPIRED', 'This fare estimate has expired. Please refresh it.');
  return { ...q, quoteId };
}
