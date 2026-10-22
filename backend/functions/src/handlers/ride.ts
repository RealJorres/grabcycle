import { z } from 'zod';
import { SUPPORT_CATEGORIES } from '../domain/types';
import { callable } from '../lib/callable';
import { MAPS_SERVER_KEY } from '../lib/params';
import { docId, idempotencyKey, latLngSchema, longText, placeSchema, reasonCode, text } from '../lib/validation';
import { findNearbyDrivers } from '../services/discovery';
import { disputePayment, recordCashPayment } from '../services/payments';
import { reverseGeocode, searchPlaces } from '../services/places';
import { getFareQuote } from '../services/quotes';
import { submitRating } from '../services/ratings';
import { cancelRide, completeRide, createRide, refreshRide, respondToOffer, updateRideProgress } from '../services/rides';
import { createSupportCase } from '../services/support';

const rideId = z.string().regex(/^[a-f0-9]{32}$/, 'Invalid ride id.');
const centavos = z.number().int().min(0).max(10_000_000);

export const searchPlacesFn = callable(
  'searchPlaces',
  z.strictObject({ query: text(2, 120), near: latLngSchema.nullable().default(null) }),
  searchPlaces,
  { secrets: [MAPS_SERVER_KEY] },
);

export const reverseGeocodeFn = callable('reverseGeocode', latLngSchema, reverseGeocode, { secrets: [MAPS_SERVER_KEY] });

export const getFareQuoteFn = callable(
  'getFareQuote',
  z.strictObject({ pickup: placeSchema, destination: placeSchema, passengers: z.number().int().min(1).max(8).default(1) }),
  getFareQuote,
  { secrets: [MAPS_SERVER_KEY] },
);

export const findNearbyDriversFn = callable(
  'findNearbyDrivers',
  z.strictObject({ pickup: latLngSchema, expand: z.boolean().default(false) }),
  findNearbyDrivers,
);

export const createRideFn = callable(
  'createRide',
  z.strictObject({
    requestId: idempotencyKey,
    quoteId: docId,
    selectedDriverId: z.string().min(6).max(128).nullable().default(null),
    allowFallback: z.boolean().default(false),
    pickupNote: text(1, 200).nullable().default(null),
  }),
  createRide,
  { timeoutSeconds: 60 },
);

export const refreshRideFn = callable('refreshRide', z.strictObject({ rideId }), refreshRide);

export const cancelRideFn = callable(
  'cancelRide',
  z.strictObject({ rideId, reasonCode, note: text(1, 300).nullable().default(null) }),
  cancelRide,
);

export const respondToOfferFn = callable(
  'respondToOffer',
  z.strictObject({ rideId, accept: z.boolean(), declineReason: reasonCode.nullable().default(null) }),
  respondToOffer,
  { secrets: [MAPS_SERVER_KEY] },
);

export const updateRideProgressFn = callable(
  'updateRideProgress',
  z.strictObject({ rideId, action: z.enum(['EN_ROUTE', 'ARRIVED', 'START']) }),
  updateRideProgress,
);

export const completeRideFn = callable(
  'completeRide',
  z.strictObject({
    rideId,
    cashCollected: centavos.nullable().default(null),
    adjustments: z.array(z.strictObject({ code: reasonCode, amount: centavos, note: text(1, 200).optional() })).max(5).default([]),
  }),
  completeRide,
);

export const recordCashPaymentFn = callable('recordCashPayment', z.strictObject({ rideId, amountCollected: centavos }), recordCashPayment);

export const disputePaymentFn = callable('disputePayment', z.strictObject({ rideId, description: longText(10, 2000) }), disputePayment);

export const submitRatingFn = callable(
  'submitRating',
  z.strictObject({
    rideId,
    stars: z.number().int().min(1).max(5),
    comment: longText(1, 500).nullable().default(null),
    tags: z.array(z.string().regex(/^[A-Z_]{2,30}$/)).max(6).default([]),
  }),
  submitRating,
);

export const createSupportCaseFn = callable(
  'createSupportCase',
  z.strictObject({ rideId: rideId.nullable().default(null), category: z.enum(SUPPORT_CATEGORIES), description: longText(10, 2000) }),
  createSupportCase,
);
