import { defineBoolean, defineList, defineSecret, defineString } from 'firebase-functions/params';

/**
 * Deployment parameters. Values come from `.env.<projectId>` files (non-secret)
 * and Secret Manager (secrets). See backend/functions/.env.example.
 */

/** Region for every function. Must match the region configured in the clients. */
export const FUNCTIONS_REGION = defineString('FUNCTIONS_REGION', {
  default: 'asia-southeast1',
  description: 'Cloud Functions region (closest to Marinduque: asia-southeast1).',
});

/** Reject callable requests without a valid App Check token. Keep true in production. */
export const ENFORCE_APP_CHECK = defineBoolean('ENFORCE_APP_CHECK', {
  default: true,
  description: 'Require Firebase App Check tokens on callable functions.',
});

/** Browser origins allowed to call admin functions (the admin dashboard hosting domains). */
export const ADMIN_ORIGINS = defineList('ADMIN_ORIGINS', {
  default: ['http://localhost:5173'],
  description: 'Admin dashboard origins as a JSON array, e.g. ["https://example.web.app"].',
});

/** Deployment environment label used for logging and safety checks. */
export const DEPLOY_ENV = defineString('DEPLOY_ENV', {
  default: 'development',
  description: 'development | staging | production',
});

/**
 * Server-side Google Maps Platform key (Routes API + Places API (New)).
 * Restrict it to those APIs. Set the secret value to DISABLED to run without
 * road routing/geocoding (straight-line estimates are clearly labelled).
 */
export const MAPS_SERVER_KEY = defineSecret('MAPS_SERVER_KEY');
