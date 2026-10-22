import type { Timestamp } from 'firebase-admin/firestore';
import type { StoredFile } from '../domain/driverAccreditation';
import type { FareLine, DistanceSource } from '../domain/fare';
import type {
  AccountStatus,
  AccountType,
  Availability,
  DocumentStatus,
  DriverStatus,
  PassengerVerificationStatus,
  PaymentMethod,
  PaymentStatus,
  Place,
  RideStatus,
  SupportCategory,
  SupportStatus,
  VehicleStatus,
} from '../domain/types';

/**
 * Shapes of persisted Firestore documents (see docs/data-dictionary.md).
 * Instants are Firestore Timestamps unless a field name ends in `Ms`
 * or is documented as epoch millis (used directly by pure domain logic).
 */

export interface PassengerVerificationState {
  status: PassengerVerificationStatus;
  caseId: string | null;
  /** Approval validity end (epoch millis) or null for no expiry. */
  validUntil: number | null;
  /** Message shown to the passenger (never internal reviewer notes). */
  publicMessage: string | null;
  submittedAt: Timestamp | null;
  updatedAt: Timestamp;
}

export interface UserDoc {
  uid: string;
  accountType: AccountType;
  status: AccountStatus;
  displayName: string;
  firstName: string;
  phoneNumber: string | null;
  locale: 'en' | 'fil';
  passengerVerification: PassengerVerificationState | null;
  activeRideId: string | null;
  emergencyContact: { name: string; phone: string } | null;
  fareDiscount: { code: string; verifiedAt: Timestamp; expiresAt: Timestamp | null; verifiedBy: string } | null;
  consents: { termsVersion: string; privacyNoticeVersion: string; acceptedAt: Timestamp };
  ratingSummary: { count: number; sum: number };
  suspension: { reasonCode: string; publicMessage: string; at: Timestamp } | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface VehicleInfo {
  plateNumber: string;
  bodyNumber: string;
  make: string;
  model: string;
  color: string;
  capacity: number;
  franchiseMunicipality: string;
  status: VehicleStatus;
  publicMessage: string | null;
  reviewedAt: Timestamp | null;
}

export interface DriverEligibilityState {
  eligible: boolean;
  reasons: string[];
  /** Epoch millis when the earliest mandatory document expires. */
  validUntil: number | null;
  computedAt: Timestamp;
}

export interface DriverDoc {
  uid: string;
  displayName: string;
  firstName: string;
  status: DriverStatus;
  everApproved: boolean;
  applicationSubmittedAt: Timestamp | null;
  accountStatus: AccountStatus;
  profile: { municipality: string } | null;
  vehicle: VehicleInfo | null;
  availability: Availability;
  currentOfferRideId: string | null;
  currentRideId: string | null;
  presenceSessionId: string | null;
  availabilityChangedAt: Timestamp | null;
  lastOnlineAt: Timestamp | null;
  eligibility: DriverEligibilityState | null;
  documentsSummary: Record<string, DocumentStatus>;
  publicProfile: { displayName: string; photoPath: string | null; vehicleSummary: string };
  ratingSummary: { count: number; sum: number };
  missedOffers: number;
  stats: { completedTrips: number; cancelledByDriver: number; declinedOffers: number };
  decision: { decision: string; reasonCode: string | null; publicMessage: string | null; decidedAt: Timestamp } | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface StoredDocumentVersion {
  submissionId: string;
  files: StoredFile[];
  expiryDate: string | null;
  documentNumber: string | null;
}

export interface DriverDocumentDoc {
  driverUid: string;
  requirementCode: string;
  scope: 'DRIVER' | 'VEHICLE';
  label: string;
  status: DocumentStatus;
  approved: (StoredDocumentVersion & { approvedAt: Timestamp; reviewerUid: string }) | null;
  pending: (StoredDocumentVersion & { submittedAt: Timestamp }) | null;
  lastDecision: {
    decision: 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMISSION';
    reasonCode: string | null;
    publicMessage: string | null;
    decidedAt: Timestamp;
  } | null;
  /** Denormalized for queue ordering and expiry queries. */
  pendingSubmittedAt: Timestamp | null;
  approvedExpiryDate: string | null;
  updatedAt: Timestamp;
}

export type VerificationCaseStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'NEEDS_RESUBMISSION';

export interface VerificationCaseDoc {
  caseId: string;
  uid: string;
  status: VerificationCaseStatus;
  idType: string;
  idTypeLabel: string;
  nameOnId: string;
  idExpiry: string | null;
  files: StoredFile[];
  applicantName: string;
  applicantPhoneMasked: string | null;
  attempt: number;
  submittedAt: Timestamp;
  claimedBy: string | null;
  claimedAt: Timestamp | null;
  decision: {
    decision: 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMISSION';
    reasonCode: string | null;
    publicMessage: string | null;
    internalNote: string | null;
    checklist: Record<string, boolean>;
    reviewerUid: string;
    decidedAt: Timestamp;
  } | null;
  filesDeleteAfter: Timestamp | null;
  updatedAt: Timestamp;
}

export interface RideQuoteSnapshot {
  quoteId: string;
  total: number;
  currency: 'PHP';
  lines: FareLine[];
  fareVersion: string;
  fareIsSample: boolean;
  distanceMeters: number;
  distanceSource: DistanceSource;
  durationSeconds: number | null;
  passengers: number;
}

export interface RideDoc {
  rideId: string;
  requestId: string;
  passengerUid: string;
  driverUid: string | null;
  status: RideStatus;
  statusReason: string | null;
  mode: 'SELECTED' | 'AUTO';
  allowFallback: boolean;
  selectedDriverId: string | null;
  pickup: Place & { note?: string };
  destination: Place;
  quote: RideQuoteSnapshot;
  offer: { driverId: string; offeredAt: Timestamp; expiresAt: Timestamp; attempt: number } | null;
  searchDeadline: Timestamp;
  passenger: { firstName: string; ratingAvg: number | null };
  driver: {
    displayName: string;
    photoPath: string | null;
    plateNumber: string;
    bodyNumber: string;
    vehicleDescription: string;
    ratingAvg: number | null;
  } | null;
  driverEtaSeconds: number | null;
  finalFare: { total: number; lines: FareLine[]; waitingMinutes: number } | null;
  payment: { method: PaymentMethod; status: PaymentStatus };
  cancellation: { by: 'PASSENGER' | 'DRIVER' | 'ADMIN' | 'SYSTEM'; reasonCode: string; note: string | null; feeApplied: number } | null;
  rated: { byPassenger: boolean; byDriver: boolean };
  arrivalVerified?: boolean;
  requestedAt: Timestamp;
  searchingAt?: Timestamp;
  acceptedAt?: Timestamp;
  enRouteAt?: Timestamp;
  arrivedAt?: Timestamp;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  cancelledAt?: Timestamp;
  endedAt?: Timestamp;
  updatedAt: Timestamp;
}

export interface PaymentDoc {
  rideId: string;
  passengerUid: string;
  driverUid: string;
  method: PaymentMethod;
  status: PaymentStatus;
  currency: 'PHP';
  amountDue: number;
  amountCollected: number | null;
  discrepancy: number;
  recordedBy: string | null;
  recordedAt: Timestamp | null;
  history: Array<{ status: PaymentStatus; by: string; at: Timestamp; note: string | null }>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SupportCaseDoc {
  caseId: string;
  reporterUid: string;
  reporterRole: AccountType;
  rideId: string | null;
  category: SupportCategory;
  description: string;
  status: SupportStatus;
  priority: 'NORMAL' | 'HIGH' | 'URGENT';
  publicResponse: string | null;
  assignedTo: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
