/**
 * Canonical enumerations shared by every GrabCycle backend module.
 *
 * These string values are persisted in Firestore and consumed by the Android
 * app and admin dashboard, so they must stay stable. Add new values; never
 * rename existing ones without a data migration.
 */

export const ACCOUNT_TYPES = ['PASSENGER', 'DRIVER'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const STAFF_ROLES = ['superadmin', 'admin', 'reviewer', 'support'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PASSENGER_VERIFICATION_STATUSES = [
  'NOT_SUBMITTED',
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_RESUBMISSION',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
] as const;
export type PassengerVerificationStatus = (typeof PASSENGER_VERIFICATION_STATUSES)[number];

export const DRIVER_STATUSES = [
  'PROFILE_INCOMPLETE',
  'DOCUMENTS_PENDING',
  'UNDER_REVIEW',
  'NEEDS_RESUBMISSION',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
  'EXPIRED',
] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const DOCUMENT_STATUSES = [
  'NOT_SUBMITTED',
  'PENDING_REVIEW',
  'APPROVED',
  'NEEDS_RESUBMISSION',
  'REJECTED',
  'EXPIRED',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const VEHICLE_STATUSES = ['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'NEEDS_RESUBMISSION', 'REJECTED'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const AVAILABILITY_STATES = ['OFFLINE', 'ONLINE', 'OFFERED', 'ON_TRIP'] as const;
export type Availability = (typeof AVAILABILITY_STATES)[number];

export const RIDE_STATUSES = [
  'REQUESTED',
  'SEARCHING',
  'ACCEPTED',
  'DRIVER_EN_ROUTE',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED_BY_PASSENGER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_ADMIN',
  'NO_DRIVER_FOUND',
  'EXPIRED',
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

export const PAYMENT_METHODS = ['CASH'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['UNPAID', 'PENDING', 'PAID', 'FAILED', 'REFUNDED', 'DISPUTED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const DOCUMENT_SIDES = ['FRONT', 'BACK', 'PHOTO'] as const;
export type DocumentSide = (typeof DOCUMENT_SIDES)[number];

export const SUPPORT_CATEGORIES = [
  'SAFETY',
  'DRIVER_BEHAVIOR',
  'PASSENGER_BEHAVIOR',
  'FARE_OR_PAYMENT',
  'LOST_ITEM',
  'APP_PROBLEM',
  'ACCOUNT',
  'OTHER',
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** Who triggered a state change. */
export type Actor = 'PASSENGER' | 'DRIVER' | 'ADMIN' | 'SYSTEM';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place extends LatLng {
  address: string;
  /** Optional curated landmark / provider place id. */
  placeId?: string | null;
}
