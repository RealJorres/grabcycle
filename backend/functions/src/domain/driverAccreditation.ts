import type { DriverRequirement } from './config';
import { endOfLocalDayMillis, isDateStillValid } from './dates';
import type { AccountStatus, DocumentSide, DocumentStatus, DriverStatus, VehicleStatus } from './types';

/**
 * Driver accreditation rules.
 *
 * Each requirement is tracked independently. A document keeps its last
 * APPROVED version (`approved`) separately from a newer submission awaiting
 * review (`pending`), so renewing a licence never invalidates a still-valid
 * approved licence, and a rejected renewal never silently removes it.
 *
 * Eligibility is always derived from the approved versions and their expiry
 * dates at evaluation time, never from a stored boolean.
 */

export interface StoredFile {
  side: DocumentSide;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
}

export interface DocumentVersion {
  submissionId: string;
  files: StoredFile[];
  expiryDate: string | null;
  documentNumber: string | null;
}

export interface DriverDocumentRecord {
  requirementCode: string;
  approved: (DocumentVersion & { approvedAt: number; reviewerUid: string }) | null;
  pending: (DocumentVersion & { submittedAt: number }) | null;
  lastDecision: {
    decision: 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMISSION';
    reasonCode: string | null;
    publicMessage: string | null;
    decidedAt: number;
  } | null;
}

export function deriveDocumentStatus(doc: DriverDocumentRecord | undefined, nowMs: number): DocumentStatus {
  if (!doc) return 'NOT_SUBMITTED';
  if (doc.pending) return 'PENDING_REVIEW';
  if (doc.approved) {
    if (doc.approved.expiryDate && !isDateStillValid(doc.approved.expiryDate, nowMs)) return 'EXPIRED';
    // An approved version stays authoritative even if a later renewal was rejected.
    return 'APPROVED';
  }
  if (doc.lastDecision?.decision === 'REJECT') return 'REJECTED';
  if (doc.lastDecision?.decision === 'REQUEST_RESUBMISSION') return 'NEEDS_RESUBMISSION';
  return 'NOT_SUBMITTED';
}

export type EligibilityReason =
  | 'ACCOUNT_NOT_ACTIVE'
  | 'DRIVER_NOT_APPROVED'
  | 'DRIVER_SUSPENDED'
  | 'VEHICLE_NOT_APPROVED'
  | `DOCUMENT_MISSING:${string}`
  | `DOCUMENT_EXPIRED:${string}`;

export interface EligibilityInput {
  accountStatus: AccountStatus;
  driverStatus: DriverStatus;
  vehicleStatus: VehicleStatus;
  documents: Record<string, DriverDocumentRecord | undefined>;
  requirements: DriverRequirement[];
  nowMs: number;
}

export interface Eligibility {
  eligible: boolean;
  reasons: EligibilityReason[];
  /** Instant at which the earliest mandatory document expires (null = none expire). */
  validUntil: number | null;
}

export function mandatoryRequirements(requirements: DriverRequirement[]): DriverRequirement[] {
  return requirements.filter((r) => r.active && r.mandatory);
}

/** Checks every mandatory document has an approved, unexpired version. */
export function documentReadiness(
  documents: Record<string, DriverDocumentRecord | undefined>,
  requirements: DriverRequirement[],
  nowMs: number,
): { reasons: EligibilityReason[]; validUntil: number | null } {
  const reasons: EligibilityReason[] = [];
  let validUntil: number | null = null;
  for (const req of mandatoryRequirements(requirements)) {
    const approved = documents[req.code]?.approved;
    if (!approved) {
      reasons.push(`DOCUMENT_MISSING:${req.code}`);
      continue;
    }
    if (req.hasExpiry) {
      if (!approved.expiryDate || !isDateStillValid(approved.expiryDate, nowMs)) {
        reasons.push(`DOCUMENT_EXPIRED:${req.code}`);
        continue;
      }
      const end = endOfLocalDayMillis(approved.expiryDate);
      validUntil = validUntil == null ? end : Math.min(validUntil, end);
    }
  }
  return { reasons, validUntil };
}

export function computeEligibility(input: EligibilityInput): Eligibility {
  const reasons: EligibilityReason[] = [];
  if (input.accountStatus !== 'ACTIVE') reasons.push('ACCOUNT_NOT_ACTIVE');
  if (input.driverStatus === 'SUSPENDED') reasons.push('DRIVER_SUSPENDED');
  // EXPIRED drivers fail via the document checks below; other non-approved states fail here.
  else if (input.driverStatus !== 'APPROVED' && input.driverStatus !== 'EXPIRED') reasons.push('DRIVER_NOT_APPROVED');
  if (input.vehicleStatus !== 'APPROVED') reasons.push('VEHICLE_NOT_APPROVED');
  const docs = documentReadiness(input.documents, input.requirements, input.nowMs);
  reasons.push(...docs.reasons);
  return { eligible: reasons.length === 0, reasons, validUntil: docs.validUntil };
}

export interface DriverStatusInput {
  current: DriverStatus;
  /** Whether the driver has ever been explicitly approved by a reviewer. */
  everApproved: boolean;
  profileComplete: boolean;
  applicationSubmitted: boolean;
  vehicleStatus: VehicleStatus;
  documents: Record<string, DriverDocumentRecord | undefined>;
  requirements: DriverRequirement[];
  nowMs: number;
}

/**
 * Derives the automatic part of the accreditation status after any document,
 * vehicle or profile change. Explicit reviewer decisions (initial APPROVE,
 * REJECT, SUSPEND) are applied separately; this function never leaves
 * REJECTED or SUSPENDED and never grants first-time approval.
 */
export function deriveDriverStatus(input: DriverStatusInput): DriverStatus {
  if (input.current === 'REJECTED' || input.current === 'SUSPENDED') return input.current;
  if (!input.profileComplete) return 'PROFILE_INCOMPLETE';

  const mandatory = mandatoryRequirements(input.requirements);
  const statuses = mandatory.map((r) => deriveDocumentStatus(input.documents[r.code], input.nowMs));
  const needsAction =
    statuses.some((s) => s === 'NEEDS_RESUBMISSION' || s === 'REJECTED') ||
    input.vehicleStatus === 'NEEDS_RESUBMISSION' ||
    input.vehicleStatus === 'REJECTED';

  if (input.everApproved) {
    const readiness = documentReadiness(input.documents, input.requirements, input.nowMs);
    if (readiness.reasons.length === 0 && input.vehicleStatus === 'APPROVED') return 'APPROVED';
    if (needsAction) return 'NEEDS_RESUBMISSION';
    // Lacking documents without a renewal awaiting review => the driver must act.
    const lacking = readiness.reasons.map((r) => r.slice(r.indexOf(':') + 1));
    if (lacking.some((code) => !input.documents[code]?.pending)) return 'EXPIRED';
    // Renewals or vehicle changes are waiting on a reviewer.
    return 'UNDER_REVIEW';
  }

  if (needsAction) return 'NEEDS_RESUBMISSION';
  const allSubmitted = statuses.every((s) => s !== 'NOT_SUBMITTED' && s !== 'EXPIRED');
  if (!allSubmitted || !input.applicationSubmitted) return 'DOCUMENTS_PENDING';
  return 'UNDER_REVIEW';
}

/** Items a reviewer must still approve before the driver can be approved. */
export function approvalBlockers(
  documents: Record<string, DriverDocumentRecord | undefined>,
  requirements: DriverRequirement[],
  vehicleStatus: VehicleStatus,
  nowMs: number,
): string[] {
  const blockers: string[] = documentReadiness(documents, requirements, nowMs).reasons;
  if (vehicleStatus !== 'APPROVED') blockers.push('VEHICLE_NOT_APPROVED');
  return blockers;
}
