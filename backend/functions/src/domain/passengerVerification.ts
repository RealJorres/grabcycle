import { fail } from './errors';
import type { PassengerVerificationStatus } from './types';

/**
 * Passenger identity verification state machine.
 *
 * Uploading documents never approves anyone: only an authorized reviewer's
 * explicit decision moves a passenger to APPROVED.
 */

export type VerificationActor = 'PASSENGER' | 'REVIEWER' | 'ADMIN' | 'SYSTEM';

interface Rule {
  from: readonly PassengerVerificationStatus[];
  to: PassengerVerificationStatus;
  actors: readonly VerificationActor[];
}

export const PASSENGER_VERIFICATION_TRANSITIONS: readonly Rule[] = [
  { from: ['NOT_SUBMITTED', 'NEEDS_RESUBMISSION'], to: 'SUBMITTED', actors: ['PASSENGER'] },
  { from: ['SUBMITTED'], to: 'UNDER_REVIEW', actors: ['REVIEWER', 'ADMIN'] },
  { from: ['SUBMITTED', 'UNDER_REVIEW'], to: 'APPROVED', actors: ['REVIEWER', 'ADMIN'] },
  { from: ['SUBMITTED', 'UNDER_REVIEW'], to: 'REJECTED', actors: ['REVIEWER', 'ADMIN'] },
  { from: ['SUBMITTED', 'UNDER_REVIEW'], to: 'NEEDS_RESUBMISSION', actors: ['REVIEWER', 'ADMIN'] },
  // Revocation (e.g. ID expired or approval validity ended).
  { from: ['APPROVED'], to: 'NEEDS_RESUBMISSION', actors: ['ADMIN', 'SYSTEM'] },
  { from: ['APPROVED'], to: 'SUSPENDED', actors: ['ADMIN'] },
  { from: ['SUSPENDED'], to: 'APPROVED', actors: ['ADMIN'] },
  { from: ['SUSPENDED'], to: 'NEEDS_RESUBMISSION', actors: ['ADMIN'] },
  // Reopen a rejected case so the passenger may resubmit.
  { from: ['REJECTED'], to: 'NEEDS_RESUBMISSION', actors: ['ADMIN'] },
];

export function canTransitionVerification(
  from: PassengerVerificationStatus,
  to: PassengerVerificationStatus,
  actor: VerificationActor,
): boolean {
  return PASSENGER_VERIFICATION_TRANSITIONS.some(
    (r) => r.to === to && r.from.includes(from) && r.actors.includes(actor),
  );
}

export function assertVerificationTransition(
  from: PassengerVerificationStatus,
  to: PassengerVerificationStatus,
  actor: VerificationActor,
): void {
  if (!canTransitionVerification(from, to, actor)) {
    throw fail.transition(from, to);
  }
}

export interface PassengerVerificationSummary {
  status: PassengerVerificationStatus;
  /** Epoch millis after which the approval is no longer valid; null = no expiry. */
  validUntil: number | null;
}

/**
 * Booking gate. A passenger may request a ride only while APPROVED and the
 * approval has not lapsed under the configured validity policy.
 */
export function isPassengerApprovedForBooking(summary: PassengerVerificationSummary | null | undefined, nowMs: number): boolean {
  if (!summary || summary.status !== 'APPROVED') return false;
  return summary.validUntil == null || summary.validUntil > nowMs;
}

/**
 * Status as it applies right now: an approval whose validity has lapsed acts
 * as NEEDS_RESUBMISSION even before the daily expiry job records it, so the
 * passenger can submit a current ID immediately instead of being stuck.
 */
export function effectiveVerificationStatus(
  summary: PassengerVerificationSummary | null | undefined,
  nowMs: number,
): PassengerVerificationStatus {
  const status = summary?.status ?? 'NOT_SUBMITTED';
  if (status === 'APPROVED' && summary!.validUntil != null && summary!.validUntil <= nowMs) return 'NEEDS_RESUBMISSION';
  return status;
}
