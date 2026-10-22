import type { Timestamp } from 'firebase/firestore';

/**
 * Read models for documents the dashboard subscribes to (subset of the
 * backend shapes in backend/functions/src/services/models.ts). Fields are
 * optional where older records may predate them.
 */
export interface StoredFile {
  side: 'FRONT' | 'BACK' | 'PHOTO';
  contentType?: string;
  sizeBytes?: number;
}

export interface DecisionRecord {
  decision: string;
  reasonCode: string | null;
  publicMessage: string | null;
  internalNote?: string | null;
  checklist?: Record<string, boolean>;
  reviewerUid?: string;
  decidedAt: Timestamp;
}

export interface VerificationCase {
  caseId: string;
  uid: string;
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'NEEDS_RESUBMISSION';
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
  decision: DecisionRecord | null;
}

export interface UserRecord {
  uid: string;
  accountType: 'PASSENGER' | 'DRIVER';
  status: 'ACTIVE' | 'SUSPENDED';
  displayName: string;
  firstName: string;
  phoneNumber: string | null;
  passengerVerification: { status: string; caseId?: string | null; validUntil: number | null; publicMessage?: string | null } | null;
  activeRideId: string | null;
  fareDiscount: { code: string; expiresAt: Timestamp | null } | null;
  ratingSummary?: { count: number; sum: number };
  suspension: { reasonCode: string; publicMessage: string; at: Timestamp } | null;
  createdAt: Timestamp;
}

export interface VehicleInfo {
  plateNumber: string;
  bodyNumber: string;
  make: string;
  model: string;
  color: string;
  capacity: number;
  franchiseMunicipality: string;
  status: string;
  publicMessage: string | null;
}

export interface DriverRecord {
  uid: string;
  displayName: string;
  status: string;
  everApproved: boolean;
  applicationSubmittedAt: Timestamp | null;
  accountStatus: string;
  profile: { municipality: string } | null;
  vehicle: VehicleInfo | null;
  availability: string;
  currentRideId: string | null;
  eligibility: { eligible: boolean; reasons: string[]; validUntil: number | null } | null;
  documentsSummary?: Record<string, string>;
  ratingSummary?: { count: number; sum: number };
  stats?: { completedTrips: number; cancelledByDriver: number; declinedOffers: number };
  decision: DecisionRecord | null;
  updatedAt: Timestamp;
}

export interface DocumentVersion {
  submissionId: string;
  files: StoredFile[];
  expiryDate: string | null;
  documentNumber: string | null;
  submittedAt?: Timestamp;
  approvedAt?: Timestamp;
}

export interface DriverDocumentRecord {
  driverUid: string;
  requirementCode: string;
  scope: 'DRIVER' | 'VEHICLE';
  label: string;
  status: string;
  approved: DocumentVersion | null;
  pending: DocumentVersion | null;
  lastDecision: DecisionRecord | null;
  pendingSubmittedAt: Timestamp | null;
  approvedExpiryDate: string | null;
}

export interface FareLine {
  code: string;
  label: string;
  amount: number;
}

export interface RideRecord {
  rideId: string;
  passengerUid: string;
  driverUid: string | null;
  status: string;
  statusReason: string | null;
  mode: 'SELECTED' | 'AUTO';
  pickup: { lat: number; lng: number; address: string; note?: string };
  destination: { lat: number; lng: number; address: string };
  quote: { total: number; lines: FareLine[]; fareVersion: string; fareIsSample: boolean; distanceMeters: number; distanceSource: string; passengers: number };
  passenger: { firstName: string };
  driver: { displayName: string; plateNumber: string; bodyNumber: string } | null;
  finalFare: { total: number; lines: FareLine[]; waitingMinutes: number } | null;
  payment: { method: string; status: string };
  cancellation: { by: string; reasonCode: string; note: string | null; feeApplied: number } | null;
  requestedAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RideEvent {
  type: string;
  from: string | null;
  to: string | null;
  actor?: string;
  actorUid?: string | null;
  details?: Record<string, unknown>;
  at: Timestamp;
}

export interface PaymentRecord {
  rideId: string;
  passengerUid: string;
  driverUid: string;
  method: string;
  status: string;
  amountDue: number;
  amountCollected: number | null;
  discrepancy: number;
  history: Array<{ status: string; by: string; at: Timestamp; note: string | null }>;
}

export interface SupportCase {
  caseId: string;
  reporterUid: string;
  reporterRole: string;
  rideId: string | null;
  category: string;
  description: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  priority: 'NORMAL' | 'HIGH' | 'URGENT';
  publicResponse: string | null;
  assignedTo: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AuditLog {
  category: string;
  action: string;
  actorUid: string;
  actorRole: string;
  targetType: string;
  targetId: string;
  targetUid: string | null;
  reasonCode: string | null;
  details: Record<string, unknown>;
  at: Timestamp;
}

export interface StaffRecord {
  uid: string;
  email: string;
  role: string | null;
  active: boolean;
  updatedAt: Timestamp;
}

export interface DataRequest {
  requestId: string;
  uid: string;
  type: 'ACCESS' | 'DELETION' | 'CORRECTION';
  note: string | null;
  status: 'RECEIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED';
  resolutionNote?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
