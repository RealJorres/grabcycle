import { endOfLocalDayMillis, isDateStillValid, isValidDateString } from '../domain/dates';
import { AppError, fail } from '../domain/errors';
import { assertVerificationTransition, effectiveVerificationStatus, type VerificationActor } from '../domain/passengerVerification';
import type { PassengerVerificationStatus } from '../domain/types';
import { writeAudit } from '../lib/audit';
import { getConfig } from '../lib/configStore';
import type { CallerContext } from '../lib/context';
import { db } from '../lib/firebase';
import { maskPhone } from '../lib/ids';
import { requirePermission } from '../lib/permissions';
import { enforceRateLimit } from '../lib/rateLimit';
import { now, nowTs, ts } from '../lib/time';
import { assertActive, requireActiveUser, usersCol } from './accounts';
import { deleteFilesQuietly, promoteUploads, queueFileDeletion, type UploadRef } from './documentStorage';
import type { UserDoc, VerificationCaseDoc } from './models';
import { notifyUser } from './notifications';

/**
 * Mandatory passenger identity verification.
 *
 * A passenger cannot book until a reviewer APPROVES their case. Uploading
 * files only creates a SUBMITTED case. The authoritative status lives in
 * `verificationCases/{caseId}` (staff-only) and is mirrored, without internal
 * notes or document references, to `users/{uid}.passengerVerification`.
 */

export const casesCol = () => db().collection('verificationCases');

export interface SubmitVerificationInput {
  idType: string;
  nameOnId: string;
  idExpiry: string | null;
  uploads: UploadRef[];
}

export async function submitPassengerVerification(ctx: CallerContext, input: SubmitVerificationInput) {
  const user = await requireActiveUser(ctx.uid, 'PASSENGER');
  const current = effectiveVerificationStatus(user.passengerVerification, now());
  if (current === 'SUBMITTED' || current === 'UNDER_REVIEW') {
    throw fail.precondition('VERIFICATION_ALREADY_PENDING', 'Your documents are already being reviewed.');
  }
  if (current !== 'NOT_SUBMITTED' && current !== 'NEEDS_RESUBMISSION') {
    throw fail.precondition('VERIFICATION_NOT_ALLOWED', 'Verification cannot be submitted for this account right now.');
  }

  const policy = await getConfig('documentPolicy');
  const idType = policy.passengerIdTypes.find((t) => t.code === input.idType && t.active);
  if (!idType) throw fail.precondition('UNSUPPORTED_DOCUMENT_TYPE', 'This type of ID is not accepted.');

  const requiredSides = [...idType.sides].sort();
  const providedSides = input.uploads.map((u) => u.side).sort();
  if (JSON.stringify(requiredSides) !== JSON.stringify(providedSides)) {
    throw fail.invalid(`Please provide the ${idType.sides.join(' and ').toLowerCase()} of your ID.`, { requiredSides });
  }

  let idExpiry: string | null = null;
  if (idType.hasExpiry) {
    if (!input.idExpiry || !isValidDateString(input.idExpiry)) throw fail.invalid('Please enter the expiry date shown on your ID.');
    if (!isDateStillValid(input.idExpiry, now())) {
      throw fail.precondition('DOCUMENT_EXPIRED', 'This ID has expired. Please use a valid ID.');
    }
    idExpiry = input.idExpiry;
  }

  // Rate-limit only the expensive storage processing, not cheap validation errors.
  await enforceRateLimit(ctx.uid, 'submitVerification');
  const caseRef = casesCol().doc();
  const files = await promoteUploads(ctx.uid, input.uploads, `private/identity/${ctx.uid}/${caseRef.id}`, policy.maxUploadBytes);

  try {
    await db().runTransaction(async (tx) => {
      const fresh = assertActive((await tx.get(usersCol().doc(ctx.uid))).data() as UserDoc | undefined ?? null, 'PASSENGER');
      const recorded = fresh.passengerVerification?.status ?? 'NOT_SUBMITTED';
      const from = effectiveVerificationStatus(fresh.passengerVerification, now());
      assertVerificationTransition(from, 'SUBMITTED', 'PASSENGER');

      const previousAttempts = await tx.get(casesCol().where('uid', '==', ctx.uid).select());
      const nowT = nowTs();
      const doc: VerificationCaseDoc = {
        caseId: caseRef.id,
        uid: ctx.uid,
        status: 'SUBMITTED',
        idType: idType.code,
        idTypeLabel: idType.label,
        nameOnId: input.nameOnId,
        idExpiry,
        files,
        applicantName: fresh.displayName,
        applicantPhoneMasked: maskPhone(fresh.phoneNumber),
        attempt: previousAttempts.size + 1,
        submittedAt: nowT,
        claimedBy: null,
        claimedAt: null,
        decision: null,
        filesDeleteAfter: null,
        updatedAt: nowT,
      };
      tx.set(caseRef, doc);
      tx.update(usersCol().doc(ctx.uid), {
        passengerVerification: {
          status: 'SUBMITTED',
          caseId: caseRef.id,
          validUntil: null,
          publicMessage: null,
          submittedAt: nowT,
          updatedAt: nowT,
        },
        updatedAt: nowT,
      });
      writeAudit(tx, {
        category: 'REVIEW',
        action: 'PASSENGER_VERIFICATION_SUBMITTED',
        actorUid: ctx.uid,
        actorRole: 'PASSENGER',
        targetType: 'verificationCase',
        targetId: caseRef.id,
        targetUid: ctx.uid,
        details: { idType: idType.code, attempt: doc.attempt, renewalOfLapsedApproval: recorded === 'APPROVED' },
      });
    });
  } catch (err) {
    await deleteFilesQuietly(files.map((f) => f.storagePath));
    throw err;
  }
  return { caseId: caseRef.id, status: 'SUBMITTED' as const };
}

/** Reviewer takes ownership of a case so two reviewers do not work it concurrently. */
export async function claimVerificationCase(ctx: CallerContext, input: { caseId: string }) {
  const role = requirePermission(ctx, 'review.decide');
  return db().runTransaction(async (tx) => {
    const caseRef = casesCol().doc(input.caseId);
    const snap = await tx.get(caseRef);
    if (!snap.exists) throw fail.notFound('Verification case');
    const c = snap.data() as VerificationCaseDoc;
    if (c.uid === ctx.uid) throw fail.forbidden('You cannot review your own account.');
    if (c.status === 'UNDER_REVIEW' && c.claimedBy === ctx.uid) return { status: c.status, claimedBy: c.claimedBy };
    if (c.status !== 'SUBMITTED') throw fail.transition(c.status, 'UNDER_REVIEW');

    const userRef = usersCol().doc(c.uid);
    const user = (await tx.get(userRef)).data() as UserDoc | undefined;
    if (user?.passengerVerification?.caseId === c.caseId) {
      assertVerificationTransition(user.passengerVerification.status, 'UNDER_REVIEW', 'REVIEWER');
      tx.update(userRef, { 'passengerVerification.status': 'UNDER_REVIEW', 'passengerVerification.updatedAt': nowTs() });
    }
    tx.update(caseRef, { status: 'UNDER_REVIEW', claimedBy: ctx.uid, claimedAt: nowTs(), updatedAt: nowTs() });
    writeAudit(tx, {
      category: 'REVIEW',
      action: 'PASSENGER_VERIFICATION_CLAIMED',
      actorUid: ctx.uid,
      actorRole: role,
      targetType: 'verificationCase',
      targetId: c.caseId,
      targetUid: c.uid,
    });
    return { status: 'UNDER_REVIEW', claimedBy: ctx.uid };
  });
}

export const VERIFICATION_CHECKLIST = ['nameMatchesProfile', 'photoClear', 'documentUnexpired', 'appearsAuthentic'] as const;

export interface DecisionInput {
  caseId: string;
  decision: 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMISSION';
  reasonCode: string | null;
  publicMessage: string | null;
  internalNote: string | null;
  checklist: Partial<Record<(typeof VERIFICATION_CHECKLIST)[number], boolean>>;
}

const DECISION_STATUS: Record<DecisionInput['decision'], PassengerVerificationStatus> = {
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  REQUEST_RESUBMISSION: 'NEEDS_RESUBMISSION',
};

export async function decidePassengerVerification(ctx: CallerContext, input: DecisionInput) {
  const role = requirePermission(ctx, 'review.decide');
  if (input.decision === 'APPROVE') {
    const missing = VERIFICATION_CHECKLIST.filter((k) => input.checklist[k] !== true);
    if (missing.length > 0) throw fail.invalid('Complete every checklist item before approving.', { missing });
  } else if (!input.reasonCode || !input.publicMessage) {
    throw fail.invalid('A reason and a message for the passenger are required.');
  }

  const [policy, policies] = await Promise.all([getConfig('documentPolicy'), getConfig('policies')]);
  const target = DECISION_STATUS[input.decision];

  const result = await db().runTransaction(async (tx) => {
    const caseRef = casesCol().doc(input.caseId);
    const snap = await tx.get(caseRef);
    if (!snap.exists) throw fail.notFound('Verification case');
    const c = snap.data() as VerificationCaseDoc;
    if (c.uid === ctx.uid) throw fail.forbidden('You cannot review your own account.');
    if (c.status !== 'SUBMITTED' && c.status !== 'UNDER_REVIEW') throw fail.transition(c.status, target);
    if (c.status === 'UNDER_REVIEW' && c.claimedBy && c.claimedBy !== ctx.uid && role === 'reviewer') {
      throw fail.precondition('PERMISSION_DENIED', 'Another reviewer is handling this case.');
    }

    const userRef = usersCol().doc(c.uid);
    const user = (await tx.get(userRef)).data() as UserDoc | undefined;
    if (!user || user.passengerVerification?.caseId !== c.caseId) {
      throw fail.precondition('INVALID_STATE_TRANSITION', 'This case is no longer the passenger’s current submission.');
    }
    const actor: VerificationActor = role === 'reviewer' ? 'REVIEWER' : 'ADMIN';
    assertVerificationTransition(user.passengerVerification.status, target, actor);

    const nowMs = now();
    let validUntil: number | null = null;
    if (target === 'APPROVED') {
      const candidates: number[] = [];
      if (c.idExpiry) {
        if (!isDateStillValid(c.idExpiry, nowMs)) {
          throw fail.precondition('DOCUMENT_EXPIRED', 'The submitted ID has expired and cannot be approved.');
        }
        candidates.push(endOfLocalDayMillis(c.idExpiry));
      }
      if (policy.passengerApprovalValidityDays) candidates.push(nowMs + policy.passengerApprovalValidityDays * 86_400_000);
      validUntil = candidates.length ? Math.min(...candidates) : null;
    }

    const nowT = ts(nowMs);
    const filesDeleteAfter = target === 'REJECTED' ? ts(nowMs + policies.retention.rejectedDocumentsDays * 86_400_000) : null;
    tx.update(caseRef, {
      status: target,
      claimedBy: c.claimedBy ?? ctx.uid,
      decision: {
        decision: input.decision,
        reasonCode: input.reasonCode,
        publicMessage: input.publicMessage,
        internalNote: input.internalNote,
        checklist: input.checklist,
        reviewerUid: ctx.uid,
        decidedAt: nowT,
      },
      filesDeleteAfter,
      updatedAt: nowT,
    });
    tx.update(userRef, {
      passengerVerification: {
        status: target,
        caseId: c.caseId,
        validUntil,
        publicMessage: target === 'APPROVED' ? null : input.publicMessage,
        submittedAt: user.passengerVerification.submittedAt,
        updatedAt: nowT,
      },
      updatedAt: nowT,
    });
    if (filesDeleteAfter) {
      const q = queueFileDeletion(c.files.map((f) => f.storagePath), filesDeleteAfter.toMillis(), 'PASSENGER_ID_REJECTED');
      if (q) tx.set(q.ref, q.data);
    }
    writeAudit(tx, {
      category: 'REVIEW',
      action: `PASSENGER_VERIFICATION_${input.decision}`,
      actorUid: ctx.uid,
      actorRole: role,
      targetType: 'verificationCase',
      targetId: c.caseId,
      targetUid: c.uid,
      reasonCode: input.reasonCode,
      details: { checklist: input.checklist },
    });
    return { uid: c.uid, status: target };
  });

  await notifyUser(result.uid, {
    type: 'VERIFICATION_UPDATE',
    title: result.status === 'APPROVED' ? 'You’re verified!' : 'Verification update',
    body:
      result.status === 'APPROVED'
        ? 'Your ID has been approved. You can now book rides.'
        : 'Your ID verification needs your attention. Open GrabCycle for details.',
  });
  return result;
}

export interface AdminVerificationActionInput {
  uid: string;
  action: 'SUSPEND' | 'REINSTATE' | 'REVOKE' | 'REOPEN';
  reasonCode: string;
  publicMessage: string;
  internalNote: string | null;
}

const ACTION_TARGET: Record<AdminVerificationActionInput['action'], PassengerVerificationStatus> = {
  SUSPEND: 'SUSPENDED',
  REINSTATE: 'APPROVED',
  REVOKE: 'NEEDS_RESUBMISSION',
  REOPEN: 'NEEDS_RESUBMISSION',
};

/** Suspension / revocation of a passenger's verified status (e.g. fraud, expired ID). */
export async function adminUpdatePassengerVerification(ctx: CallerContext, input: AdminVerificationActionInput) {
  const role = requirePermission(ctx, 'users.suspend');
  const target = ACTION_TARGET[input.action];
  const result = await db().runTransaction(async (tx) => {
    const userRef = usersCol().doc(input.uid);
    const user = (await tx.get(userRef)).data() as UserDoc | undefined;
    if (!user || user.accountType !== 'PASSENGER' || !user.passengerVerification) throw fail.notFound('Passenger');
    const from = user.passengerVerification.status;
    if (input.action === 'REOPEN' && from !== 'REJECTED') throw fail.transition(from, target);
    if (input.action === 'REVOKE' && from !== 'APPROVED' && from !== 'SUSPENDED') throw fail.transition(from, target);
    assertVerificationTransition(from, target, 'ADMIN');
    if (target === 'APPROVED' && user.passengerVerification.validUntil != null && user.passengerVerification.validUntil <= now()) {
      throw new AppError('failed-precondition', 'DOCUMENT_EXPIRED', 'The approval has lapsed; request a resubmission instead.');
    }
    tx.update(userRef, {
      'passengerVerification.status': target,
      'passengerVerification.publicMessage': target === 'APPROVED' ? null : input.publicMessage,
      'passengerVerification.updatedAt': nowTs(),
      updatedAt: nowTs(),
    });
    writeAudit(tx, {
      category: 'REVIEW',
      action: `PASSENGER_VERIFICATION_${input.action}`,
      actorUid: ctx.uid,
      actorRole: role,
      targetType: 'user',
      targetId: input.uid,
      targetUid: input.uid,
      reasonCode: input.reasonCode,
      details: { from, to: target, internalNote: input.internalNote },
    });
    return { uid: input.uid, status: target };
  });
  await notifyUser(input.uid, {
    type: 'VERIFICATION_UPDATE',
    title: 'Verification update',
    body: 'There is an update on your GrabCycle verification. Open the app for details.',
  });
  return result;
}

/** Daily: approvals whose validity lapsed move to NEEDS_RESUBMISSION. */
export async function expirePassengerApprovals(limit = 300): Promise<number> {
  const nowMs = now();
  const snap = await usersCol()
    .where('passengerVerification.status', '==', 'APPROVED')
    .where('passengerVerification.validUntil', '<=', nowMs)
    .limit(limit)
    .get();
  for (const doc of snap.docs) {
    await db().runTransaction(async (tx) => {
      const user = (await tx.get(doc.ref)).data() as UserDoc | undefined;
      const pv = user?.passengerVerification;
      if (!pv || pv.status !== 'APPROVED' || pv.validUntil == null || pv.validUntil > nowMs) return;
      tx.update(doc.ref, {
        'passengerVerification.status': 'NEEDS_RESUBMISSION',
        'passengerVerification.publicMessage': 'Your ID verification has expired. Please submit a valid ID to keep booking rides.',
        'passengerVerification.updatedAt': nowTs(),
      });
      writeAudit(tx, {
        category: 'REVIEW',
        action: 'PASSENGER_VERIFICATION_EXPIRED',
        actorUid: 'system',
        actorRole: 'SYSTEM',
        targetType: 'user',
        targetId: doc.id,
        targetUid: doc.id,
      });
    });
    await notifyUser(doc.id, {
      type: 'VERIFICATION_UPDATE',
      title: 'Please renew your ID verification',
      body: 'Your ID verification has expired. Submit a valid ID to continue booking.',
    });
  }
  return snap.size;
}
