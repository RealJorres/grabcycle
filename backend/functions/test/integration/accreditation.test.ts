import { beforeEach, describe, expect, it } from 'vitest';
import { auth } from '../../src/lib/firebase';
import { setClockForTesting } from '../../src/lib/time';
import { setAccountStatus, setStaffRole } from '../../src/services/admin';
import {
  decideDriver,
  processDocumentExpiry,
  refreshMyEligibility,
  reviewDriverDocument,
  reviewVehicle,
  saveDriverProfile,
  submitDriverApplication,
  submitDriverDocument,
} from '../../src/services/drivers';
import type { DriverDoc, DriverDocumentDoc, UserDoc } from '../../src/services/models';
import {
  admin,
  approveAllDriverDocuments,
  expectReason,
  getDoc,
  registerApprovedDriver,
  registerDriver,
  registerPassenger,
  resetEmulators,
  reviewer,
  seedConfig,
  submitAllDriverDocuments,
  superadmin,
  uploadsFor,
  VEHICLE,
} from './helpers';

beforeEach(async () => {
  await resetEmulators();
  await seedConfig();
});

describe('driver onboarding', () => {
  it('progresses through PROFILE_INCOMPLETE → DOCUMENTS_PENDING → UNDER_REVIEW', async () => {
    const d = await registerDriver();
    expect((await getDoc<DriverDoc>(`drivers/${d.uid}`))?.status).toBe('PROFILE_INCOMPLETE');
    await saveDriverProfile(d, { municipality: 'Boac', vehicle: VEHICLE });
    expect((await getDoc<DriverDoc>(`drivers/${d.uid}`))?.status).toBe('DOCUMENTS_PENDING');
    await expectReason(submitDriverApplication(d), 'DOCUMENT_REQUIREMENTS_INCOMPLETE');
    await submitAllDriverDocuments(d);
    const driver = await getDoc<DriverDoc>(`drivers/${d.uid}`);
    expect(driver?.status).toBe('UNDER_REVIEW');
    expect(driver?.eligibility?.eligible).toBe(false);
    expect(driver?.documentsSummary.DRIVERS_LICENSE).toBe('PENDING_REVIEW');
  });

  it('validates document-specific fields', async () => {
    const d = await registerDriver();
    await saveDriverProfile(d, { municipality: 'Boac', vehicle: VEHICLE });
    await expectReason(
      submitDriverDocument(d, { requirementCode: 'DRIVERS_LICENSE', uploads: await uploadsFor(d.uid, ['FRONT', 'BACK']), expiryDate: null, documentNumber: 'N01-12-123456' }),
      'INVALID_ARGUMENT',
    );
    await expectReason(
      submitDriverDocument(d, { requirementCode: 'DRIVERS_LICENSE', uploads: await uploadsFor(d.uid, ['FRONT', 'BACK']), expiryDate: '2030-01-01', documentNumber: null }),
      'INVALID_ARGUMENT',
    );
    await expectReason(
      submitDriverDocument(d, { requirementCode: 'DRIVERS_LICENSE', uploads: await uploadsFor(d.uid, ['FRONT', 'BACK']), expiryDate: '2020-01-01', documentNumber: 'N01-12-123456' }),
      'DOCUMENT_EXPIRED',
    );
    await expectReason(
      submitDriverDocument(d, { requirementCode: 'PROFILE_PHOTO', uploads: await uploadsFor(d.uid, ['FRONT']), expiryDate: null, documentNumber: null }),
      'INVALID_ARGUMENT',
    );
    await expectReason(
      submitDriverDocument(d, { requirementCode: 'MADE_UP', uploads: await uploadsFor(d.uid, ['PHOTO']), expiryDate: null, documentNumber: null }),
      'UNSUPPORTED_DOCUMENT_TYPE',
    );
    await expectReason(saveDriverProfile(d, { municipality: 'Quezon City', vehicle: VEHICLE }), 'INVALID_ARGUMENT');
  });

  it('passengers cannot use driver onboarding', async () => {
    const p = await registerPassenger();
    await expectReason(saveDriverProfile(p, { municipality: 'Boac', vehicle: VEHICLE }), 'ACCOUNT_TYPE_MISMATCH');
  });
});

describe('accreditation review', () => {
  it('approval of one document does not approve the driver; explicit approval requires every item', async () => {
    const d = await registerDriver();
    await submitAllDriverDocuments(d);
    const license = await getDoc<DriverDocumentDoc>(`drivers/${d.uid}/documents/DRIVERS_LICENSE`);
    await reviewDriverDocument(reviewer, {
      driverUid: d.uid,
      requirementCode: 'DRIVERS_LICENSE',
      submissionId: license!.pending!.submissionId,
      decision: 'APPROVE',
      reasonCode: null,
      publicMessage: null,
      internalNote: null,
      verifiedExpiryDate: '2029-05-31',
    });
    const approve = { driverUid: d.uid, decision: 'APPROVE' as const, reasonCode: null, publicMessage: null, internalNote: null };
    const err = await expectReason(decideDriver(reviewer, approve), 'DOCUMENT_REQUIREMENTS_INCOMPLETE');
    expect((err.meta.blockers as string[]).length).toBeGreaterThan(1);

    await approveAllDriverDocuments(d.uid);
    await expectReason(decideDriver(reviewer, approve), 'DOCUMENT_REQUIREMENTS_INCOMPLETE'); // vehicle not yet approved
    await reviewVehicle(reviewer, { driverUid: d.uid, decision: 'APPROVE', reasonCode: null, publicMessage: null, internalNote: null });
    expect((await getDoc<DriverDoc>(`drivers/${d.uid}`))?.status).toBe('UNDER_REVIEW');
    await decideDriver(reviewer, approve);
    const driver = await getDoc<DriverDoc>(`drivers/${d.uid}`);
    expect(driver?.status).toBe('APPROVED');
    expect(driver?.eligibility?.eligible).toBe(true);
    expect(driver?.eligibility?.validUntil).toBe(Date.parse('2029-06-01T00:00:00+08:00'));
    // The approved profile photo is published for passenger safety.
    expect(driver?.publicProfile.photoPath).toMatch(new RegExp(`^public/driverPhotos/${d.uid}/`));
    // Reviewer-confirmed expiry overrides the driver's entry.
    expect((await getDoc<DriverDocumentDoc>(`drivers/${d.uid}/documents/DRIVERS_LICENSE`))?.approved?.expiryDate).toBe('2029-05-31');
  });

  it('a rejected document needs resubmission; stale submission ids are refused', async () => {
    const d = await registerDriver();
    await submitAllDriverDocuments(d);
    const orDoc = await getDoc<DriverDocumentDoc>(`drivers/${d.uid}/documents/VEHICLE_OR`);
    const submissionId = orDoc!.pending!.submissionId;
    await reviewDriverDocument(reviewer, {
      driverUid: d.uid,
      requirementCode: 'VEHICLE_OR',
      submissionId,
      decision: 'REQUEST_RESUBMISSION',
      reasonCode: 'UNREADABLE',
      publicMessage: 'The OR photo is unreadable.',
      internalNote: null,
      verifiedExpiryDate: null,
    });
    const driver = await getDoc<DriverDoc>(`drivers/${d.uid}`);
    expect(driver?.status).toBe('NEEDS_RESUBMISSION');
    expect(driver?.documentsSummary.VEHICLE_OR).toBe('NEEDS_RESUBMISSION');
    await expectReason(
      reviewDriverDocument(reviewer, {
        driverUid: d.uid,
        requirementCode: 'VEHICLE_OR',
        submissionId,
        decision: 'APPROVE',
        reasonCode: null,
        publicMessage: null,
        internalNote: null,
        verifiedExpiryDate: null,
      }),
      'INVALID_STATE_TRANSITION',
    );
    await submitDriverDocument(d, { requirementCode: 'VEHICLE_OR', uploads: await uploadsFor(d.uid, ['FRONT']), expiryDate: '2030-01-01', documentNumber: null });
    expect((await getDoc<DriverDoc>(`drivers/${d.uid}`))?.status).toBe('UNDER_REVIEW');
  });

  it('document expiry removes eligibility; an approved renewal restores it', async () => {
    const d = await registerApprovedDriver();
    expect((await getDoc<DriverDoc>(`drivers/${d.uid}`))?.eligibility?.eligible).toBe(true);
    setClockForTesting(() => Date.parse('2031-01-02T08:00:00+08:00'));
    expect((await processDocumentExpiry()).drivers).toBe(1);
    let driver = await getDoc<DriverDoc>(`drivers/${d.uid}`);
    expect(driver?.status).toBe('EXPIRED');
    expect(driver?.eligibility?.eligible).toBe(false);
    expect(driver?.eligibility?.reasons).toContain('DOCUMENT_EXPIRED:DRIVERS_LICENSE');

    for (const code of ['DRIVERS_LICENSE', 'VEHICLE_OR', 'FRANCHISE_PERMIT']) {
      const req = code === 'DRIVERS_LICENSE' ? ['FRONT', 'BACK'] : ['FRONT'];
      await submitDriverDocument(d, {
        requirementCode: code,
        uploads: await uploadsFor(d.uid, req as Array<'FRONT' | 'BACK'>),
        expiryDate: '2035-12-31',
        documentNumber: code === 'DRIVERS_LICENSE' ? 'N01-12-123456' : null,
      });
    }
    expect((await getDoc<DriverDoc>(`drivers/${d.uid}`))?.status).toBe('UNDER_REVIEW');
    await approveAllDriverDocuments(d.uid);
    driver = await getDoc<DriverDoc>(`drivers/${d.uid}`);
    expect(driver?.status).toBe('APPROVED');
    expect(driver?.eligibility?.eligible).toBe(true);
  });

  it('changing vehicle details after approval requires re-review', async () => {
    const d = await registerApprovedDriver();
    await saveDriverProfile(d, { municipality: 'Boac', vehicle: { ...VEHICLE, plateNumber: '999XYZ' } });
    const driver = await getDoc<DriverDoc>(`drivers/${d.uid}`);
    expect(driver?.vehicle?.status).toBe('PENDING');
    expect(driver?.eligibility?.eligible).toBe(false);
    expect(driver?.eligibility?.reasons).toContain('VEHICLE_NOT_APPROVED');
  });

  it('a driver cannot approve themselves or bypass review via eligibility refresh', async () => {
    const d = await registerDriver();
    await submitAllDriverDocuments(d);
    const result = await refreshMyEligibility(d);
    expect(result.eligible).toBe(false);
    await expectReason(decideDriver(d, { driverUid: d.uid, decision: 'APPROVE', reasonCode: null, publicMessage: null, internalNote: null }), 'PERMISSION_DENIED');
  });

  it('suspension blocks eligibility and reinstatement restores it', async () => {
    const d = await registerApprovedDriver();
    await decideDriver(admin, { driverUid: d.uid, decision: 'SUSPEND', reasonCode: 'COMPLAINT', publicMessage: 'Your account is under review.', internalNote: null });
    let driver = await getDoc<DriverDoc>(`drivers/${d.uid}`);
    expect(driver?.status).toBe('SUSPENDED');
    expect(driver?.eligibility?.eligible).toBe(false);
    await expectReason(
      decideDriver(reviewer, { driverUid: d.uid, decision: 'REINSTATE', reasonCode: null, publicMessage: null, internalNote: null }),
      'PERMISSION_DENIED',
    );
    await decideDriver(admin, { driverUid: d.uid, decision: 'REINSTATE', reasonCode: null, publicMessage: null, internalNote: null });
    driver = await getDoc<DriverDoc>(`drivers/${d.uid}`);
    expect(driver?.status).toBe('APPROVED');
    expect(driver?.eligibility?.eligible).toBe(true);
  });
});

describe('account standing and staff roles', () => {
  it('account suspension disables the Auth user and blocks driver eligibility', async () => {
    const d = await registerApprovedDriver();
    await setAccountStatus(admin, { uid: d.uid, status: 'SUSPENDED', reasonCode: 'POLICY', publicMessage: 'Suspended pending review.', internalNote: null });
    expect((await auth().getUser(d.uid)).disabled).toBe(true);
    expect((await getDoc<UserDoc>(`users/${d.uid}`))?.status).toBe('SUSPENDED');
    const driver = await getDoc<DriverDoc>(`drivers/${d.uid}`);
    expect(driver?.accountStatus).toBe('SUSPENDED');
    expect(driver?.eligibility?.reasons).toContain('ACCOUNT_NOT_ACTIVE');
    await expectReason(saveDriverProfile(d, { municipality: 'Boac', vehicle: VEHICLE }), 'ACCOUNT_SUSPENDED');

    await setAccountStatus(admin, { uid: d.uid, status: 'ACTIVE', reasonCode: 'APPEAL_ACCEPTED', publicMessage: 'Welcome back.', internalNote: null });
    expect((await auth().getUser(d.uid)).disabled).toBe(false);
    expect((await getDoc<DriverDoc>(`drivers/${d.uid}`))?.eligibility?.eligible).toBe(true);
  });

  it('only superadmins manage staff roles; rider accounts cannot become staff', async () => {
    await auth().createUser({ uid: 'new-staff', email: 'new.staff@example.test', password: 'Sup3r-secret-pass' });
    await expectReason(setStaffRole(admin, { email: 'new.staff@example.test', role: 'reviewer' }), 'PERMISSION_DENIED');
    await setStaffRole(superadmin, { email: 'new.staff@example.test', role: 'reviewer' });
    expect((await auth().getUser('new-staff')).customClaims?.staffRole).toBe('reviewer');
    await setStaffRole(superadmin, { email: 'new.staff@example.test', role: null });
    expect((await auth().getUser('new-staff')).customClaims?.staffRole).toBeUndefined();

    const p = await registerPassenger();
    await auth().updateUser(p.uid, { email: 'rider@example.test' });
    await expectReason(setStaffRole(superadmin, { email: 'rider@example.test', role: 'admin' }), 'ACCOUNT_TYPE_MISMATCH');
  });
});
