/**
 * Structured application errors.
 *
 * Every rejection carries a stable machine-readable `reason` that the Android
 * app and admin dashboard map to localized, user-friendly messages. The
 * `status` follows the gRPC/Firebase canonical codes so the callable wrapper
 * can translate it into an HttpsError without leaking internals.
 */

export type ErrorStatus =
  | 'invalid-argument'
  | 'failed-precondition'
  | 'not-found'
  | 'already-exists'
  | 'permission-denied'
  | 'unauthenticated'
  | 'resource-exhausted'
  | 'aborted'
  | 'unavailable'
  | 'deadline-exceeded'
  | 'internal';

export type ErrorReason =
  // Generic
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'SERVICE_UNAVAILABLE'
  | 'INVALID_STATE_TRANSITION'
  // Accounts
  | 'ACCOUNT_NOT_REGISTERED'
  | 'ACCOUNT_ALREADY_REGISTERED'
  | 'ACCOUNT_TYPE_MISMATCH'
  | 'ACCOUNT_SUSPENDED'
  | 'PHONE_NOT_VERIFIED'
  | 'CONSENT_REQUIRED'
  // Verification / documents
  | 'PASSENGER_NOT_VERIFIED'
  | 'VERIFICATION_ALREADY_PENDING'
  | 'VERIFICATION_NOT_ALLOWED'
  | 'UNSUPPORTED_DOCUMENT_TYPE'
  | 'UPLOAD_NOT_FOUND'
  | 'UPLOAD_INVALID'
  | 'DOCUMENT_REQUIREMENTS_INCOMPLETE'
  | 'DOCUMENT_EXPIRED'
  // Drivers
  | 'DRIVER_NOT_ELIGIBLE'
  | 'DRIVER_PROFILE_INCOMPLETE'
  | 'DRIVER_HAS_ACTIVE_TRIP'
  | 'DRIVER_UNAVAILABLE'
  | 'LOCATION_REQUIRED'
  // Geography / fares
  | 'OUTSIDE_SERVICE_AREA'
  | 'OUTSIDE_FARE_ZONES'
  | 'PICKUP_EQUALS_DESTINATION'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_MISMATCH'
  | 'FARE_ADJUSTMENT_NOT_ALLOWED'
  | 'SERVICE_CLOSED'
  // Rides
  | 'ACTIVE_RIDE_EXISTS'
  | 'NO_DRIVERS_AVAILABLE'
  | 'OFFER_EXPIRED'
  | 'OFFER_NOT_FOUND'
  | 'RIDE_NOT_ACTIVE'
  | 'TOO_FAR_FROM_PICKUP'
  | 'CANCELLATION_NOT_ALLOWED'
  // Payments / ratings / support
  | 'PAYMENT_ALREADY_RECORDED'
  | 'PAYMENT_INVALID_AMOUNT'
  | 'RATING_NOT_ALLOWED'
  | 'RATING_ALREADY_SUBMITTED'
  | 'PAYMENT_METHOD_UNAVAILABLE';

export class AppError extends Error {
  constructor(
    readonly status: ErrorStatus,
    readonly reason: ErrorReason,
    message: string,
    readonly meta: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const fail = {
  invalid: (message: string, meta?: Record<string, unknown>) =>
    new AppError('invalid-argument', 'INVALID_ARGUMENT', message, meta),
  unauthenticated: () => new AppError('unauthenticated', 'UNAUTHENTICATED', 'Sign in required.'),
  forbidden: (message = 'You do not have permission to perform this action.') =>
    new AppError('permission-denied', 'PERMISSION_DENIED', message),
  notFound: (what: string) => new AppError('not-found', 'NOT_FOUND', `${what} not found.`),
  precondition: (reason: ErrorReason, message: string, meta?: Record<string, unknown>) =>
    new AppError('failed-precondition', reason, message, meta),
  transition: (from: string, to: string) =>
    new AppError('failed-precondition', 'INVALID_STATE_TRANSITION', `Cannot change status from ${from} to ${to}.`, {
      from,
      to,
    }),
  rateLimited: (retryAfterSec: number) =>
    new AppError('resource-exhausted', 'RATE_LIMITED', 'Too many requests. Please wait and try again.', {
      retryAfterSec,
    }),
};
