import { describe, expect, it } from 'vitest';
import {
  assertVerificationTransition,
  canTransitionVerification,
  effectiveVerificationStatus,
  isPassengerApprovedForBooking,
} from '../../src/domain/passengerVerification';
import { assertPaymentTransition, canTransitionPayment, cashOutcome } from '../../src/domain/payment';
import {
  assertRideTransition,
  canTransitionRide,
  isTerminalRideStatus,
  RIDE_TRANSITIONS,
  TERMINAL_RIDE_STATUSES,
} from '../../src/domain/rideStateMachine';
import { RIDE_STATUSES } from '../../src/domain/types';

describe('ride state machine', () => {
  it('allows the happy path only for the right actors', () => {
    expect(canTransitionRide('REQUESTED', 'SEARCHING', 'SYSTEM')).toBe(true);
    expect(canTransitionRide('SEARCHING', 'ACCEPTED', 'DRIVER')).toBe(true);
    expect(canTransitionRide('ACCEPTED', 'DRIVER_EN_ROUTE', 'DRIVER')).toBe(true);
    expect(canTransitionRide('DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'DRIVER')).toBe(true);
    expect(canTransitionRide('DRIVER_ARRIVED', 'IN_PROGRESS', 'DRIVER')).toBe(true);
    expect(canTransitionRide('IN_PROGRESS', 'COMPLETED', 'DRIVER')).toBe(true);
  });

  it('forbids passengers from accepting, starting or completing rides', () => {
    expect(canTransitionRide('SEARCHING', 'ACCEPTED', 'PASSENGER')).toBe(false);
    expect(canTransitionRide('DRIVER_ARRIVED', 'IN_PROGRESS', 'PASSENGER')).toBe(false);
    expect(canTransitionRide('IN_PROGRESS', 'COMPLETED', 'PASSENGER')).toBe(false);
  });

  it('forbids skipping states', () => {
    expect(canTransitionRide('SEARCHING', 'IN_PROGRESS', 'DRIVER')).toBe(false);
    expect(canTransitionRide('ACCEPTED', 'COMPLETED', 'DRIVER')).toBe(false);
    expect(canTransitionRide('REQUESTED', 'ACCEPTED', 'DRIVER')).toBe(false);
  });

  it('passengers cannot cancel once the trip is in progress', () => {
    expect(canTransitionRide('DRIVER_ARRIVED', 'CANCELLED_BY_PASSENGER', 'PASSENGER')).toBe(true);
    expect(canTransitionRide('IN_PROGRESS', 'CANCELLED_BY_PASSENGER', 'PASSENGER')).toBe(false);
  });

  it('terminal states have no outgoing transitions', () => {
    for (const terminal of TERMINAL_RIDE_STATUSES) {
      for (const rule of RIDE_TRANSITIONS) {
        expect(rule.from.includes(terminal)).toBe(false);
      }
      expect(isTerminalRideStatus(terminal)).toBe(true);
    }
  });

  it('every non-terminal status can be cancelled by an admin', () => {
    for (const s of RIDE_STATUSES.filter((x) => !isTerminalRideStatus(x))) {
      expect(canTransitionRide(s, 'CANCELLED_BY_ADMIN', 'ADMIN')).toBe(true);
    }
  });

  it('assertRideTransition throws a structured error', () => {
    expect(() => assertRideTransition('COMPLETED', 'IN_PROGRESS', 'DRIVER')).toThrow(/Cannot change status/);
  });
});

describe('passenger verification state machine', () => {
  it('uploading only moves to SUBMITTED; only reviewers approve', () => {
    expect(canTransitionVerification('NOT_SUBMITTED', 'SUBMITTED', 'PASSENGER')).toBe(true);
    expect(canTransitionVerification('NOT_SUBMITTED', 'APPROVED', 'PASSENGER')).toBe(false);
    expect(canTransitionVerification('SUBMITTED', 'APPROVED', 'PASSENGER')).toBe(false);
    expect(canTransitionVerification('SUBMITTED', 'APPROVED', 'REVIEWER')).toBe(true);
    expect(canTransitionVerification('UNDER_REVIEW', 'NEEDS_RESUBMISSION', 'REVIEWER')).toBe(true);
  });

  it('prevents resubmitting while a case is pending or after rejection', () => {
    expect(canTransitionVerification('SUBMITTED', 'SUBMITTED', 'PASSENGER')).toBe(false);
    expect(canTransitionVerification('REJECTED', 'SUBMITTED', 'PASSENGER')).toBe(false);
    expect(canTransitionVerification('REJECTED', 'NEEDS_RESUBMISSION', 'ADMIN')).toBe(true);
  });

  it('supports suspension and reinstatement by admins only', () => {
    expect(canTransitionVerification('APPROVED', 'SUSPENDED', 'ADMIN')).toBe(true);
    expect(canTransitionVerification('APPROVED', 'SUSPENDED', 'REVIEWER')).toBe(false);
    expect(canTransitionVerification('SUSPENDED', 'APPROVED', 'ADMIN')).toBe(true);
    expect(() => assertVerificationTransition('SUSPENDED', 'SUBMITTED', 'PASSENGER')).toThrow();
  });

  it('booking gate requires APPROVED and an unexpired approval', () => {
    const now = 1_000_000;
    expect(isPassengerApprovedForBooking({ status: 'APPROVED', validUntil: null }, now)).toBe(true);
    expect(isPassengerApprovedForBooking({ status: 'APPROVED', validUntil: now + 1 }, now)).toBe(true);
    expect(isPassengerApprovedForBooking({ status: 'APPROVED', validUntil: now }, now)).toBe(false);
    expect(isPassengerApprovedForBooking({ status: 'SUBMITTED', validUntil: null }, now)).toBe(false);
    expect(isPassengerApprovedForBooking({ status: 'SUSPENDED', validUntil: null }, now)).toBe(false);
    expect(isPassengerApprovedForBooking(null, now)).toBe(false);
  });

  it('a lapsed approval is effectively NEEDS_RESUBMISSION; nothing else changes', () => {
    const now = 1_000_000;
    expect(effectiveVerificationStatus({ status: 'APPROVED', validUntil: now }, now)).toBe('NEEDS_RESUBMISSION');
    expect(effectiveVerificationStatus({ status: 'APPROVED', validUntil: now + 1 }, now)).toBe('APPROVED');
    expect(effectiveVerificationStatus({ status: 'APPROVED', validUntil: null }, now)).toBe('APPROVED');
    expect(effectiveVerificationStatus({ status: 'SUSPENDED', validUntil: now - 1 }, now)).toBe('SUSPENDED');
    expect(effectiveVerificationStatus(null, now)).toBe('NOT_SUBMITTED');
  });
});

describe('payment state machine', () => {
  it('keeps payment independent and transitions guarded', () => {
    expect(canTransitionPayment('UNPAID', 'PAID', 'DRIVER')).toBe(true);
    expect(canTransitionPayment('UNPAID', 'PAID', 'PASSENGER')).toBe(false);
    expect(canTransitionPayment('PAID', 'PAID', 'DRIVER')).toBe(false);
    expect(canTransitionPayment('PAID', 'DISPUTED', 'PASSENGER')).toBe(true);
    expect(canTransitionPayment('DISPUTED', 'REFUNDED', 'ADMIN')).toBe(true);
    expect(() => assertPaymentTransition('REFUNDED', 'PAID', 'ADMIN')).toThrow();
  });

  it('flags cash shortfalls beyond tolerance as PENDING', () => {
    expect(cashOutcome(5000, 5000, 0)).toEqual({ status: 'PAID', discrepancy: 0 });
    expect(cashOutcome(5000, 6000, 0)).toEqual({ status: 'PAID', discrepancy: 0 });
    expect(cashOutcome(5000, 4900, 100)).toEqual({ status: 'PAID', discrepancy: 100 });
    expect(cashOutcome(5000, 4000, 100)).toEqual({ status: 'PENDING', discrepancy: 1000 });
  });
});
