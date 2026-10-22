import { describe, expect, it } from 'vitest';
import { documentPolicySchema } from '../../src/domain/config';
import { SAMPLE_DOCUMENT_POLICY } from '../../src/domain/defaults';
import {
  approvalBlockers,
  computeEligibility,
  deriveDocumentStatus,
  deriveDriverStatus,
  type DriverDocumentRecord,
} from '../../src/domain/driverAccreditation';
import { endOfLocalDayMillis } from '../../src/domain/dates';

const policy = documentPolicySchema.parse(SAMPLE_DOCUMENT_POLICY);
const requirements = policy.driverRequirements;
const NOW = Date.UTC(2026, 9, 22, 2, 0, 0); // 2026-10-22 10:00 Manila

function approvedDoc(code: string, expiryDate: string | null = null): DriverDocumentRecord {
  return {
    requirementCode: code,
    approved: {
      submissionId: `s-${code}`,
      files: [],
      expiryDate,
      documentNumber: null,
      approvedAt: NOW - 1000,
      reviewerUid: 'rev',
    },
    pending: null,
    lastDecision: { decision: 'APPROVE', reasonCode: null, publicMessage: null, decidedAt: NOW - 1000 },
  };
}

function pendingDoc(code: string, expiryDate: string | null = null): DriverDocumentRecord {
  return {
    requirementCode: code,
    approved: null,
    pending: { submissionId: `p-${code}`, files: [], expiryDate, documentNumber: null, submittedAt: NOW - 500 },
    lastDecision: null,
  };
}

function allApproved(expiry = '2027-12-31'): Record<string, DriverDocumentRecord> {
  const docs: Record<string, DriverDocumentRecord> = {};
  for (const r of requirements.filter((x) => x.mandatory)) {
    docs[r.code] = approvedDoc(r.code, r.hasExpiry ? expiry : null);
  }
  return docs;
}

describe('document status derivation', () => {
  it('tracks pending, approved, expired and rejected states', () => {
    expect(deriveDocumentStatus(undefined, NOW)).toBe('NOT_SUBMITTED');
    expect(deriveDocumentStatus(pendingDoc('X'), NOW)).toBe('PENDING_REVIEW');
    expect(deriveDocumentStatus(approvedDoc('X', '2026-10-22'), NOW)).toBe('APPROVED');
    expect(deriveDocumentStatus(approvedDoc('X', '2026-10-21'), NOW)).toBe('EXPIRED');
    expect(
      deriveDocumentStatus(
        { requirementCode: 'X', approved: null, pending: null, lastDecision: { decision: 'REJECT', reasonCode: 'BLURRY', publicMessage: null, decidedAt: NOW } },
        NOW,
      ),
    ).toBe('REJECTED');
  });

  it('expiry is inclusive of the whole local day', () => {
    const end = endOfLocalDayMillis('2026-10-22');
    expect(deriveDocumentStatus(approvedDoc('X', '2026-10-22'), end - 1)).toBe('APPROVED');
    expect(deriveDocumentStatus(approvedDoc('X', '2026-10-22'), end)).toBe('EXPIRED');
  });
});

describe('driver eligibility', () => {
  const base = {
    accountStatus: 'ACTIVE' as const,
    driverStatus: 'APPROVED' as const,
    vehicleStatus: 'APPROVED' as const,
    requirements,
    nowMs: NOW,
  };

  it('is eligible only when every mandatory document is approved and valid', () => {
    const e = computeEligibility({ ...base, documents: allApproved() });
    expect(e.eligible).toBe(true);
    expect(e.reasons).toEqual([]);
    expect(e.validUntil).toBe(endOfLocalDayMillis('2027-12-31'));
  });

  it('approval of one document does not imply the others', () => {
    const docs = { DRIVERS_LICENSE: approvedDoc('DRIVERS_LICENSE', '2027-01-01') };
    const e = computeEligibility({ ...base, documents: docs });
    expect(e.eligible).toBe(false);
    expect(e.reasons).toContain('DOCUMENT_MISSING:VEHICLE_OR');
    expect(e.reasons).toContain('DOCUMENT_MISSING:PROFILE_PHOTO');
  });

  it('optional documents are not required', () => {
    const e = computeEligibility({ ...base, documents: allApproved() });
    expect(e.reasons.some((r) => r.includes('POLICE_CLEARANCE'))).toBe(false);
  });

  it('an expired licence blocks eligibility even if the stored status says APPROVED', () => {
    const docs = allApproved();
    docs.DRIVERS_LICENSE = approvedDoc('DRIVERS_LICENSE', '2026-10-21');
    const e = computeEligibility({ ...base, documents: docs });
    expect(e.eligible).toBe(false);
    expect(e.reasons).toEqual(['DOCUMENT_EXPIRED:DRIVERS_LICENSE']);
  });

  it('validUntil is the earliest mandatory expiry', () => {
    const docs = allApproved('2028-01-01');
    docs.VEHICLE_OR = approvedDoc('VEHICLE_OR', '2026-11-30');
    expect(computeEligibility({ ...base, documents: docs }).validUntil).toBe(endOfLocalDayMillis('2026-11-30'));
  });

  it('account suspension, driver suspension and vehicle status all block', () => {
    expect(computeEligibility({ ...base, accountStatus: 'SUSPENDED', documents: allApproved() }).reasons).toContain('ACCOUNT_NOT_ACTIVE');
    expect(computeEligibility({ ...base, driverStatus: 'SUSPENDED', documents: allApproved() }).reasons).toContain('DRIVER_SUSPENDED');
    expect(computeEligibility({ ...base, driverStatus: 'UNDER_REVIEW', documents: allApproved() }).reasons).toContain('DRIVER_NOT_APPROVED');
    expect(computeEligibility({ ...base, vehicleStatus: 'PENDING', documents: allApproved() }).reasons).toContain('VEHICLE_NOT_APPROVED');
  });
});

describe('driver status derivation', () => {
  const input = {
    current: 'DOCUMENTS_PENDING' as const,
    everApproved: false,
    profileComplete: true,
    applicationSubmitted: false,
    vehicleStatus: 'PENDING' as const,
    requirements,
    nowMs: NOW,
  };

  it('progresses PROFILE_INCOMPLETE → DOCUMENTS_PENDING → UNDER_REVIEW', () => {
    expect(deriveDriverStatus({ ...input, profileComplete: false, documents: {} })).toBe('PROFILE_INCOMPLETE');
    expect(deriveDriverStatus({ ...input, documents: {} })).toBe('DOCUMENTS_PENDING');
    const pending: Record<string, DriverDocumentRecord> = {};
    for (const r of requirements.filter((x) => x.mandatory)) pending[r.code] = pendingDoc(r.code, '2027-01-01');
    expect(deriveDriverStatus({ ...input, documents: pending })).toBe('DOCUMENTS_PENDING');
    expect(deriveDriverStatus({ ...input, applicationSubmitted: true, documents: pending })).toBe('UNDER_REVIEW');
  });

  it('never grants first-time approval automatically', () => {
    const s = deriveDriverStatus({ ...input, applicationSubmitted: true, vehicleStatus: 'APPROVED', documents: allApproved() });
    expect(s).toBe('UNDER_REVIEW');
  });

  it('moves an approved driver to EXPIRED and back after an approved renewal', () => {
    const approved = { ...input, current: 'APPROVED' as const, everApproved: true, applicationSubmitted: true, vehicleStatus: 'APPROVED' as const };
    const docs = allApproved();
    expect(deriveDriverStatus({ ...approved, documents: docs })).toBe('APPROVED');
    docs.DRIVERS_LICENSE = approvedDoc('DRIVERS_LICENSE', '2026-10-01');
    expect(deriveDriverStatus({ ...approved, documents: docs })).toBe('EXPIRED');
    docs.DRIVERS_LICENSE = { ...docs.DRIVERS_LICENSE, pending: { submissionId: 'r', files: [], expiryDate: '2031-01-01', documentNumber: null, submittedAt: NOW } };
    expect(deriveDriverStatus({ ...approved, current: 'EXPIRED', documents: docs })).toBe('UNDER_REVIEW');
    docs.DRIVERS_LICENSE = approvedDoc('DRIVERS_LICENSE', '2031-01-01');
    expect(deriveDriverStatus({ ...approved, current: 'UNDER_REVIEW', documents: docs })).toBe('APPROVED');
  });

  it('a pending renewal does not suspend a still-valid approval', () => {
    const docs = allApproved();
    docs.DRIVERS_LICENSE = { ...docs.DRIVERS_LICENSE!, pending: { submissionId: 'r', files: [], expiryDate: '2031-01-01', documentNumber: null, submittedAt: NOW } };
    expect(
      deriveDriverStatus({ ...input, current: 'APPROVED', everApproved: true, applicationSubmitted: true, vehicleStatus: 'APPROVED', documents: docs }),
    ).toBe('APPROVED');
  });

  it('never leaves SUSPENDED or REJECTED automatically', () => {
    expect(deriveDriverStatus({ ...input, current: 'SUSPENDED', documents: allApproved() })).toBe('SUSPENDED');
    expect(deriveDriverStatus({ ...input, current: 'REJECTED', documents: allApproved() })).toBe('REJECTED');
  });

  it('lists approval blockers', () => {
    const docs = allApproved();
    delete docs.VEHICLE_CR;
    expect(approvalBlockers(docs, requirements, 'PENDING', NOW)).toEqual(['DOCUMENT_MISSING:VEHICLE_CR', 'VEHICLE_NOT_APPROVED']);
  });
});
