import { fail } from './errors';
import type { Actor, RideStatus } from './types';

/**
 * Ride lifecycle state machine.
 *
 *   REQUESTED ─▶ SEARCHING ─▶ ACCEPTED ─▶ DRIVER_EN_ROUTE ─▶ DRIVER_ARRIVED ─▶ IN_PROGRESS ─▶ COMPLETED
 *       │            │            │               │                  │
 *       │            │            └───────────────┴──────────────────┴─▶ CANCELLED_BY_PASSENGER / CANCELLED_BY_DRIVER
 *       └────────────┴─▶ NO_DRIVER_FOUND / EXPIRED / CANCELLED_BY_PASSENGER
 *   Any non-terminal ─▶ CANCELLED_BY_ADMIN
 *
 * The table below is the single source of truth for which actor may trigger
 * which transition. The backend calls `assertRideTransition` inside the same
 * Firestore transaction that performs the write.
 */

export const TERMINAL_RIDE_STATUSES: readonly RideStatus[] = [
  'COMPLETED',
  'CANCELLED_BY_PASSENGER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_ADMIN',
  'NO_DRIVER_FOUND',
  'EXPIRED',
];

/** Statuses during which a driver is committed to the ride. */
export const ASSIGNED_RIDE_STATUSES: readonly RideStatus[] = [
  'ACCEPTED',
  'DRIVER_EN_ROUTE',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
];

/** Statuses during which the ride is still looking for a driver. */
export const SEARCH_RIDE_STATUSES: readonly RideStatus[] = ['REQUESTED', 'SEARCHING'];

interface TransitionRule {
  from: readonly RideStatus[];
  to: RideStatus;
  actors: readonly Actor[];
}

const NON_TERMINAL: readonly RideStatus[] = [...SEARCH_RIDE_STATUSES, ...ASSIGNED_RIDE_STATUSES];

export const RIDE_TRANSITIONS: readonly TransitionRule[] = [
  { from: ['REQUESTED'], to: 'SEARCHING', actors: ['SYSTEM'] },
  { from: ['SEARCHING'], to: 'ACCEPTED', actors: ['DRIVER'] },
  { from: ['ACCEPTED'], to: 'DRIVER_EN_ROUTE', actors: ['DRIVER'] },
  { from: ['ACCEPTED', 'DRIVER_EN_ROUTE'], to: 'DRIVER_ARRIVED', actors: ['DRIVER'] },
  { from: ['DRIVER_ARRIVED'], to: 'IN_PROGRESS', actors: ['DRIVER'] },
  // ADMIN may complete on the driver's behalf (e.g. driver's phone died), which is audited.
  { from: ['IN_PROGRESS'], to: 'COMPLETED', actors: ['DRIVER', 'ADMIN'] },
  {
    from: ['REQUESTED', 'SEARCHING', 'ACCEPTED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED'],
    to: 'CANCELLED_BY_PASSENGER',
    actors: ['PASSENGER'],
  },
  { from: ['ACCEPTED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED'], to: 'CANCELLED_BY_DRIVER', actors: ['DRIVER'] },
  { from: NON_TERMINAL, to: 'CANCELLED_BY_ADMIN', actors: ['ADMIN'] },
  { from: SEARCH_RIDE_STATUSES, to: 'NO_DRIVER_FOUND', actors: ['SYSTEM'] },
  { from: SEARCH_RIDE_STATUSES, to: 'EXPIRED', actors: ['SYSTEM'] },
];

export function isTerminalRideStatus(status: RideStatus): boolean {
  return TERMINAL_RIDE_STATUSES.includes(status);
}

export function isAssignedRideStatus(status: RideStatus): boolean {
  return ASSIGNED_RIDE_STATUSES.includes(status);
}

export function canTransitionRide(from: RideStatus, to: RideStatus, actor: Actor): boolean {
  return RIDE_TRANSITIONS.some((rule) => rule.to === to && rule.from.includes(from) && rule.actors.includes(actor));
}

export function assertRideTransition(from: RideStatus, to: RideStatus, actor: Actor): void {
  if (!canTransitionRide(from, to, actor)) {
    throw fail.transition(from, to);
  }
}

/** Timestamp field recorded when a ride enters a status. */
export const RIDE_STATUS_TIMESTAMP_FIELD: Partial<Record<RideStatus, string>> = {
  REQUESTED: 'requestedAt',
  SEARCHING: 'searchingAt',
  ACCEPTED: 'acceptedAt',
  DRIVER_EN_ROUTE: 'enRouteAt',
  DRIVER_ARRIVED: 'arrivedAt',
  IN_PROGRESS: 'startedAt',
  COMPLETED: 'completedAt',
  CANCELLED_BY_PASSENGER: 'cancelledAt',
  CANCELLED_BY_DRIVER: 'cancelledAt',
  CANCELLED_BY_ADMIN: 'cancelledAt',
  NO_DRIVER_FOUND: 'endedAt',
  EXPIRED: 'endedAt',
};
