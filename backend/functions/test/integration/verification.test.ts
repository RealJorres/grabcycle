import { beforeEach, describe, expect, it } from 'vitest';
import { bucket, db } from '../../src/lib/firebase';
import { setClockForTesting } from '../../src/lib/time';
import { completeRegistration } from '../../src/services/accounts';
import type { UserDoc, VerificationCaseDoc } from '../../src/services/models';
import {
  adminUpdatePassengerVerification,
  claimVerificationCase,
  decidePassengerVerification,
  expirePassengerApprovals,
  submitPassengerVerification,
} from '../../src/services/passengerVerification';
import { getDocumentFile } from '../../src/services/admin';
import {
  admin,
  createAuthUser,
  ctx,
  expectReason,
  getDoc,
  jpegBytes,
  registerPassenger,
  resetEmulators,
  reviewer,
  seedConfig,
  stageUpload,
  support,
  TERMS,
  uploadsFor,
} from './helpers';

beforeEach(async () => {
  await resetEmulators();
  await seedConfig();
});

const FULL_CHECKLIST = { nameMatchesProfile: true, photoClear: true, documentUnexpired: true, appearsAuthentic: true };

describe('registration', () => {
  it('requires phone sign-in and current consent', async () => {
    const noPhone = ctx('u-email', { phone: null, provider: 'password' });
    await expectReason(
      completeRegistration(noPhone, { accountType: 'PASSENGER', fullName: 'Ana Reyes', ...TERMS, locale: 'en' }),
      'PHONE_NOT_VERIFIED',
    );
    const c = ctx('u-old-terms');
    await expectReason(
      completeRegistration(c, { accountType: 'PASSENGER', fullName: 'Ana Reyes', termsVersion: '2020-01', privacyNoticeVersion: '2020-01', locale: 'en' }),
      'CONSENT_REQUIRED',
    );
  });

  it('is idempotent and the account type cannot be changed later', async () => {
    const c = ctx('u-1');
    await createAuthUser(c);
    const first = await completeRegistration(c, { accountType: 'PASSENGER', fullName: 'Ana Reyes', ...TERMS, locale: 'en' });
    const again = await completeRegistration(c, { accountType: 'PASSENGER', fullName: 'Ana Reyes', ...TERMS, locale: 'en' });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    await expectReason(
      completeRegistration(c, { accountType: 'DRIVER', fullName: 'Ana Reyes', ...TERMS, locale: 'en' }),
      'ACCOUNT_ALREADY_REGISTERED',
    );
    const user = await getDoc<UserDoc>('users/u-1');
    expect(user?.passengerVerification?.status).toBe('NOT_SUBMITTED');
    expect(user?.status).toBe('ACTIVE');
  });

  it('staff identities cannot register as riders', async () => {
    await expectReason(
      completeRegistration(admin, { accountType: 'PASSENGER', fullName: 'Admin User', ...TERMS, locale: 'en' }),
      'PERMISSION_DENIED',
    );
  });
});

describe('passenger identity verification', () => {
  it('submission moves files to private storage and creates a SUBMITTED case — never approval', async () => {
    const p = await registerPassenger();
    const uploads = await uploadsFor(p.uid, ['FRONT', 'BACK']);
    const { caseId, status } = await submitPassengerVerification(p, { idType: 'PHILSYS', nameOnId: 'Juan Dela Cruz', idExpiry: null, uploads });
    expect(status).toBe('SUBMITTED');

    const c = await getDoc<VerificationCaseDoc>(`verificationCases/${caseId}`);
    expect(c?.files).toHaveLength(2);
    for (const f of c!.files) {
      expect(f.storagePath.startsWith(`private/identity/${p.uid}/${caseId}/`)).toBe(true);
      expect(f.storagePath).not.toContain('Juan');
      expect((await bucket().file(f.storagePath).exists())[0]).toBe(true);
    }
    for (const u of uploads) expect((await bucket().file(`uploads/${p.uid}/${u.uploadId}`).exists())[0]).toBe(false);

    const user = await getDoc<UserDoc>(`users/${p.uid}`);
    expect(user?.passengerVerification?.status).toBe('SUBMITTED');
    // The passenger-visible summary never contains document references.
    expect(JSON.stringify(user)).not.toContain('private/identity');
  });

  it('validates sides, type, expiry and file contents', async () => {
    const p = await registerPassenger();
    await expectReason(
      submitPassengerVerification(p, { idType: 'PHILSYS', nameOnId: 'Juan', idExpiry: null, uploads: await uploadsFor(p.uid, ['FRONT']) }),
      'INVALID_ARGUMENT',
    );
    await expectReason(
      submitPassengerVerification(p, { idType: 'LIBRARY_CARD', nameOnId: 'Juan', idExpiry: null, uploads: await uploadsFor(p.uid, ['FRONT']) }),
      'UNSUPPORTED_DOCUMENT_TYPE',
    );
    await expectReason(
      submitPassengerVerification(p, { idType: 'PASSPORT', nameOnId: 'Juan', idExpiry: '2001-01-01', uploads: await uploadsFor(p.uid, ['FRONT']) }),
      'DOCUMENT_EXPIRED',
    );
    const notJpeg = await stageUpload(p.uid, { bytes: Buffer.from('MZ'.padEnd(5000, '\0')) });
    await expectReason(
      submitPassengerVerification(p, { idType: 'PASSPORT', nameOnId: 'Juan', idExpiry: '2031-01-01', uploads: [{ side: 'FRONT', uploadId: notJpeg }] }),
      'UPLOAD_INVALID',
    );
    const pdf = await stageUpload(p.uid, { bytes: jpegBytes(), contentType: 'application/pdf' });
    await expectReason(
      submitPassengerVerification(p, { idType: 'PASSPORT', nameOnId: 'Juan', idExpiry: '2031-01-01', uploads: [{ side: 'FRONT', uploadId: pdf }] }),
      'UPLOAD_INVALID',
    );
    await expectReason(
      submitPassengerVerification(p, { idType: 'PASSPORT', nameOnId: 'Juan', idExpiry: '2031-01-01', uploads: [{ side: 'FRONT', uploadId: 'doesNotExist0000000000' }] }),
      'UPLOAD_NOT_FOUND',
    );
    // Someone else's upload id cannot be used.
    const other = await registerPassenger('Maria Clara');
    const othersUpload = await stageUpload(other.uid);
    await expectReason(
      submitPassengerVerification(p, { idType: 'PASSPORT', nameOnId: 'Juan', idExpiry: '2031-01-01', uploads: [{ side: 'FRONT', uploadId: othersUpload }] }),
      'UPLOAD_NOT_FOUND',
    );
  });

  it('prevents duplicate pending submissions and drivers submitting passenger ID', async () => {
    const p = await registerPassenger();
    await submitPassengerVerification(p, { idType: 'PHILSYS', nameOnId: 'Juan', idExpiry: null, uploads: await uploadsFor(p.uid, ['FRONT', 'BACK']) });
    await expectReason(
      submitPassengerVerification(p, { idType: 'PHILSYS', nameOnId: 'Juan', idExpiry: null, uploads: await uploadsFor(p.uid, ['FRONT', 'BACK']) }),
      'VERIFICATION_ALREADY_PENDING',
    );
  });

  it('review workflow: claim, request resubmission, resubmit, approve — with an audit trail', async () => {
    const p = await registerPassenger();
    const first = await submitPassengerVerification(p, { idType: 'PHILSYS', nameOnId: 'Juan', idExpiry: null, uploads: await uploadsFor(p.uid, ['FRONT', 'BACK']) });
    await claimVerificationCase(reviewer, { caseId: first.caseId });
    expect((await getDoc<UserDoc>(`users/${p.uid}`))?.passengerVerification?.status).toBe('UNDER_REVIEW');

    await expectReason(
      decidePassengerVerification(reviewer, { caseId: first.caseId, decision: 'REQUEST_RESUBMISSION', reasonCode: 'BLURRY', publicMessage: null, internalNote: null, checklist: {} }),
      'INVALID_ARGUMENT',
    );
    await decidePassengerVerification(reviewer, {
      caseId: first.caseId,
      decision: 'REQUEST_RESUBMISSION',
      reasonCode: 'BLURRY',
      publicMessage: 'The back of your ID is blurry. Please retake it in good light.',
      internalNote: 'Glare on back side',
      checklist: {},
    });
    const afterResubmitRequest = await getDoc<UserDoc>(`users/${p.uid}`);
    expect(afterResubmitRequest?.passengerVerification?.status).toBe('NEEDS_RESUBMISSION');
    expect(afterResubmitRequest?.passengerVerification?.publicMessage).toContain('blurry');
    expect(JSON.stringify(afterResubmitRequest)).not.toContain('Glare');

    const second = await submitPassengerVerification(p, { idType: 'PHILSYS', nameOnId: 'Juan', idExpiry: null, uploads: await uploadsFor(p.uid, ['FRONT', 'BACK']) });
    // Approving requires the full checklist.
    await expectReason(
      decidePassengerVerification(reviewer, { caseId: second.caseId, decision: 'APPROVE', reasonCode: null, publicMessage: null, internalNote: null, checklist: { photoClear: true } }),
      'INVALID_ARGUMENT',
    );
    // The superseded case cannot be decided.
    await expectReason(
      decidePassengerVerification(reviewer, { caseId: first.caseId, decision: 'APPROVE', reasonCode: null, publicMessage: null, internalNote: null, checklist: FULL_CHECKLIST }),
      'INVALID_STATE_TRANSITION',
    );
    await decidePassengerVerification(reviewer, { caseId: second.caseId, decision: 'APPROVE', reasonCode: null, publicMessage: null, internalNote: null, checklist: FULL_CHECKLIST });
    const user = await getDoc<UserDoc>(`users/${p.uid}`);
    expect(user?.passengerVerification?.status).toBe('APPROVED');
    const c = await getDoc<VerificationCaseDoc>(`verificationCases/${second.caseId}`);
    expect(c?.decision?.reviewerUid).toBe(reviewer.uid);
    expect(c?.attempt).toBe(2);
  });

  it('only reviewers can decide; support staff and passengers cannot', async () => {
    const p = await registerPassenger();
    const { caseId } = await submitPassengerVerification(p, { idType: 'PHILSYS', nameOnId: 'Juan', idExpiry: null, uploads: await uploadsFor(p.uid, ['FRONT', 'BACK']) });
    const args = { caseId, decision: 'APPROVE' as const, reasonCode: null, publicMessage: null, internalNote: null, checklist: FULL_CHECKLIST };
    await expectReason(decidePassengerVerification(p, args), 'PERMISSION_DENIED');
    await expectReason(decidePassengerVerification(support, args), 'PERMISSION_DENIED');
    await expectReason(getDocumentFile(support, { kind: 'PASSENGER_CASE', caseId, side: 'FRONT' }), 'PERMISSION_DENIED');
    await expectReason(getDocumentFile(p, { kind: 'PASSENGER_CASE', caseId, side: 'FRONT' }), 'PERMISSION_DENIED');
  });

  it('reviewers view documents through an audited channel', async () => {
    const p = await registerPassenger();
    const { caseId } = await submitPassengerVerification(p, { idType: 'PHILSYS', nameOnId: 'Juan', idExpiry: null, uploads: await uploadsFor(p.uid, ['FRONT', 'BACK']) });
    const file = await getDocumentFile(reviewer, { kind: 'PASSENGER_CASE', caseId, side: 'BACK' });
    expect(file.contentType).toBe('image/jpeg');
    expect(Buffer.from(file.dataBase64, 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    const audit = await db().collection('auditLogs').where('action', '==', 'DOCUMENT_VIEWED').where('targetUid', '==', p.uid).get();
    expect(audit.size).toBe(1);
    expect(audit.docs[0]!.get('actorUid')).toBe(reviewer.uid);
  });

  it('approval validity follows ID expiry and lapses into NEEDS_RESUBMISSION', async () => {
    const p = await registerPassenger();
    const { caseId } = await submitPassengerVerification(p, {
      idType: 'PASSPORT',
      nameOnId: 'Juan',
      idExpiry: '2030-06-30',
      uploads: await uploadsFor(p.uid, ['FRONT']),
    });
    await decidePassengerVerification(reviewer, { caseId, decision: 'APPROVE', reasonCode: null, publicMessage: null, internalNote: null, checklist: FULL_CHECKLIST });
    const user = await getDoc<UserDoc>(`users/${p.uid}`);
    expect(user?.passengerVerification?.validUntil).toBe(Date.parse('2030-07-01T00:00:00+08:00'));

    setClockForTesting(() => Date.parse('2030-07-02T00:00:00+08:00'));
    expect(await expirePassengerApprovals()).toBe(1);
    expect((await getDoc<UserDoc>(`users/${p.uid}`))?.passengerVerification?.status).toBe('NEEDS_RESUBMISSION');
  });

  it('a lapsed approval can be renewed before the daily expiry job runs', async () => {
    const p = await registerPassenger();
    const { caseId } = await submitPassengerVerification(p, {
      idType: 'PASSPORT',
      nameOnId: 'Juan',
      idExpiry: '2030-06-30',
      uploads: await uploadsFor(p.uid, ['FRONT']),
    });
    await decidePassengerVerification(reviewer, { caseId, decision: 'APPROVE', reasonCode: null, publicMessage: null, internalNote: null, checklist: FULL_CHECKLIST });

    // Still valid: resubmitting is refused.
    await expectReason(
      submitPassengerVerification(p, { idType: 'PASSPORT', nameOnId: 'Juan', idExpiry: '2035-01-01', uploads: await uploadsFor(p.uid, ['FRONT']) }),
      'VERIFICATION_NOT_ALLOWED',
    );

    // Lapsed but not yet swept: renewal is accepted and goes back to review.
    setClockForTesting(() => Date.parse('2030-07-01T08:00:00+08:00'));
    const renewed = await submitPassengerVerification(p, {
      idType: 'PASSPORT',
      nameOnId: 'Juan',
      idExpiry: '2035-01-01',
      uploads: await uploadsFor(p.uid, ['FRONT']),
    });
    expect(renewed.status).toBe('SUBMITTED');
    const user = await getDoc<UserDoc>(`users/${p.uid}`);
    expect(user?.passengerVerification?.status).toBe('SUBMITTED');
    expect(user?.passengerVerification?.validUntil).toBeNull();
    const audit = await db().collection('auditLogs').where('action', '==', 'PASSENGER_VERIFICATION_SUBMITTED').where('targetUid', '==', p.uid).get();
    expect(audit.docs.map((d) => d.get('details.renewalOfLapsedApproval')).sort()).toEqual([false, true]);
  });

  it('admins can suspend and reinstate a verified passenger; reviewers cannot', async () => {
    const p = await registerPassenger();
    const { caseId } = await submitPassengerVerification(p, { idType: 'PHILSYS', nameOnId: 'Juan', idExpiry: null, uploads: await uploadsFor(p.uid, ['FRONT', 'BACK']) });
    await decidePassengerVerification(reviewer, { caseId, decision: 'APPROVE', reasonCode: null, publicMessage: null, internalNote: null, checklist: FULL_CHECKLIST });
    const args = { uid: p.uid, action: 'SUSPEND' as const, reasonCode: 'FRAUD_SUSPECTED', publicMessage: 'Your verification is on hold.', internalNote: null };
    await expectReason(adminUpdatePassengerVerification(reviewer, args), 'PERMISSION_DENIED');
    await adminUpdatePassengerVerification(admin, args);
    expect((await getDoc<UserDoc>(`users/${p.uid}`))?.passengerVerification?.status).toBe('SUSPENDED');
    // A suspended passenger cannot simply resubmit to escape the suspension.
    await expectReason(
      submitPassengerVerification(p, { idType: 'PHILSYS', nameOnId: 'Juan', idExpiry: null, uploads: await uploadsFor(p.uid, ['FRONT', 'BACK']) }),
      'VERIFICATION_NOT_ALLOWED',
    );
    await adminUpdatePassengerVerification(admin, { ...args, action: 'REINSTATE' });
    expect((await getDoc<UserDoc>(`users/${p.uid}`))?.passengerVerification?.status).toBe('APPROVED');
  });
});
