import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { DriverRequirement } from '../domain/config';
import { isDateStillValid, isValidDateString, localDateString } from '../domain/dates';
import {
  approvalBlockers,
  computeEligibility,
  deriveDocumentStatus,
  deriveDriverStatus,
  type DriverDocumentRecord,
} from '../domain/driverAccreditation';
import { fail } from '../domain/errors';
import type { DocumentStatus, DriverStatus, VehicleStatus } from '../domain/types';
import { writeAudit } from '../lib/audit';
import { getConfig } from '../lib/configStore';
import type { CallerContext } from '../lib/context';
import { db } from '../lib/firebase';
import { randomId } from '../lib/ids';
import { requirePermission } from '../lib/permissions';
import { enforceRateLimit } from '../lib/rateLimit';
import { millis, now, nowTs, ts } from '../lib/time';
import { driversCol, requireActiveUser } from './accounts';
import { deleteFilesQuietly, promoteUploads, publishProfilePhoto, queueFileDeletion, type UploadRef } from './documentStorage';
import type { DriverDoc, DriverDocumentDoc, VehicleInfo } from './models';
import { notifyUser } from './notifications';
import { revokePresence } from './presence';

/**
 * Driver onboarding and accreditation.
 *
 * Every mandatory requirement is reviewed individually. The driver's overall
 * status and availability eligibility are always recomputed server-side from
 * the per-document approvals, the vehicle approval and expiry dates.
 */

// ---------------------------------------------------------------------------
// State loading & recomputation
// ---------------------------------------------------------------------------

export interface DriverState {
  ref: DocumentReference;
  driver: DriverDoc;
  documents: Record<string, DriverDocumentDoc>;
}

export async function loadDriverState(tx: Transaction, uid: string): Promise<DriverState> {
  const ref = driversCol().doc(uid);
  const [snap, docsSnap] = await Promise.all([tx.get(ref), tx.get(ref.collection('documents'))]);
  if (!snap.exists) throw fail.precondition('ACCOUNT_NOT_REGISTERED', 'Driver profile not found.');
  const documents: Record<string, DriverDocumentDoc> = {};
  docsSnap.docs.forEach((d) => (documents[d.id] = d.data() as DriverDocumentDoc));
  return { ref, driver: snap.data() as DriverDoc, documents };
}

export function toDomainRecord(doc: DriverDocumentDoc | undefined): DriverDocumentRecord | undefined {
  if (!doc) return undefined;
  return {
    requirementCode: doc.requirementCode,
    approved: doc.approved ? { ...doc.approved, approvedAt: millis(doc.approved.approvedAt)! } : null,
    pending: doc.pending ? { ...doc.pending, submittedAt: millis(doc.pending.submittedAt)! } : null,
    lastDecision: doc.lastDecision ? { ...doc.lastDecision, decidedAt: millis(doc.lastDecision.decidedAt)! } : null,
  };
}

function domainDocs(state: DriverState): Record<string, DriverDocumentRecord | undefined> {
  const out: Record<string, DriverDocumentRecord | undefined> = {};
  for (const [code, d] of Object.entries(state.documents)) out[code] = toDomainRecord(d);
  return out;
}

export interface Evaluation {
  status: DriverStatus;
  eligibility: DriverDoc['eligibility'];
  documentsSummary: Record<string, DocumentStatus>;
}

export function evaluateDriver(state: DriverState, requirements: DriverRequirement[], nowMs: number): Evaluation {
  const docs = domainDocs(state);
  const status = deriveDriverStatus({
    current: state.driver.status,
    everApproved: state.driver.everApproved,
    profileComplete: state.driver.profile != null && state.driver.vehicle != null,
    applicationSubmitted: state.driver.applicationSubmittedAt != null,
    vehicleStatus: state.driver.vehicle?.status ?? 'NOT_SUBMITTED',
    documents: docs,
    requirements,
    nowMs,
  });
  const eligibility = computeEligibility({
    accountStatus: state.driver.accountStatus,
    driverStatus: status,
    vehicleStatus: state.driver.vehicle?.status ?? 'NOT_SUBMITTED',
    documents: docs,
    requirements,
    nowMs,
  });
  const documentsSummary: Record<string, DocumentStatus> = {};
  for (const req of requirements.filter((r) => r.active)) documentsSummary[req.code] = deriveDocumentStatus(docs[req.code], nowMs);
  return {
    status,
    eligibility: { eligible: eligibility.eligible, reasons: eligibility.reasons, validUntil: eligibility.validUntil, computedAt: ts(nowMs) },
    documentsSummary,
  };
}

/**
 * Writes a recomputed driver state. A driver who is ONLINE but no longer
 * eligible is taken offline immediately; drivers on an active trip finish it
 * (see docs/booking-state-machine.md, "eligibility lost mid-trip").
 * Returns true when presence must be revoked after commit.
 */
export function writeEvaluation(
  tx: Transaction,
  state: DriverState,
  evaluation: Evaluation,
  extra: Record<string, unknown> = {},
): boolean {
  const goOffline = !evaluation.eligibility?.eligible && state.driver.availability === 'ONLINE';
  tx.update(state.ref, {
    status: evaluation.status,
    eligibility: evaluation.eligibility,
    documentsSummary: evaluation.documentsSummary,
    ...(goOffline
      ? { availability: 'OFFLINE', presenceSessionId: null, availabilityChangedAt: nowTs() }
      : {}),
    ...extra,
    updatedAt: nowTs(),
  });
  return goOffline;
}

// ---------------------------------------------------------------------------
// Driver self-service
// ---------------------------------------------------------------------------

export interface DriverProfileInput {
  municipality: string;
  vehicle: {
    plateNumber: string;
    bodyNumber: string;
    make: string;
    model: string;
    color: string;
    capacity: number;
    franchiseMunicipality: string;
  };
}

function vehicleChanged(a: VehicleInfo | null, b: DriverProfileInput['vehicle']): boolean {
  if (!a) return true;
  return (
    a.plateNumber !== b.plateNumber ||
    a.bodyNumber !== b.bodyNumber ||
    a.make !== b.make ||
    a.model !== b.model ||
    a.color !== b.color ||
    a.capacity !== b.capacity ||
    a.franchiseMunicipality !== b.franchiseMunicipality
  );
}

export async function saveDriverProfile(ctx: CallerContext, input: DriverProfileInput) {
  await requireActiveUser(ctx.uid, 'DRIVER');
  await enforceRateLimit(ctx.uid, 'saveDriverProfile');
  const [policy, area] = await Promise.all([getConfig('documentPolicy'), getConfig('serviceArea')]);
  if (!area.municipalities.includes(input.municipality) || !area.municipalities.includes(input.vehicle.franchiseMunicipality)) {
    throw fail.invalid('Please choose a municipality within the GrabCycle service area.');
  }

  let revoke = false;
  const result = await db().runTransaction(async (tx) => {
    const state = await loadDriverState(tx, ctx.uid);
    if (state.driver.availability === 'ON_TRIP' || state.driver.availability === 'OFFERED') {
      throw fail.precondition('DRIVER_HAS_ACTIVE_TRIP', 'You cannot change your vehicle details during a trip.');
    }
    const changed = vehicleChanged(state.driver.vehicle, input.vehicle);
    // Changing vehicle details after approval requires the vehicle to be reviewed again.
    const vehicleStatus: VehicleStatus = changed ? 'PENDING' : (state.driver.vehicle?.status ?? 'PENDING');
    const vehicle: VehicleInfo = {
      ...input.vehicle,
      status: vehicleStatus,
      publicMessage: changed ? null : (state.driver.vehicle?.publicMessage ?? null),
      reviewedAt: changed ? null : (state.driver.vehicle?.reviewedAt ?? null),
    };
    state.driver.profile = { municipality: input.municipality };
    state.driver.vehicle = vehicle;
    const evaluation = evaluateDriver(state, policy.driverRequirements, now());
    revoke = writeEvaluation(tx, state, evaluation, {
      profile: state.driver.profile,
      vehicle,
      'publicProfile.vehicleSummary': `${input.vehicle.color} ${input.vehicle.make} tricycle`.trim(),
    });
    if (changed && state.driver.everApproved) {
      writeAudit(tx, {
        category: 'REVIEW',
        action: 'DRIVER_VEHICLE_CHANGED',
        actorUid: ctx.uid,
        actorRole: 'DRIVER',
        targetType: 'driver',
        targetId: ctx.uid,
        targetUid: ctx.uid,
      });
    }
    return { status: evaluation.status, vehicleStatus };
  });
  if (revoke) await revokePresence(ctx.uid);
  return result;
}

export interface SubmitDocumentInput {
  requirementCode: string;
  uploads: UploadRef[];
  expiryDate: string | null;
  documentNumber: string | null;
}

export function validateDocumentInput(req: DriverRequirement, input: SubmitDocumentInput, nowMs: number) {
  const requiredSides = [...req.sides].sort();
  const providedSides = input.uploads.map((u) => u.side).sort();
  if (JSON.stringify(requiredSides) !== JSON.stringify(providedSides)) {
    throw fail.invalid(`Please provide: ${req.sides.join(', ').toLowerCase()}.`, { requiredSides });
  }
  let expiryDate: string | null = null;
  if (req.hasExpiry) {
    if (!input.expiryDate || !isValidDateString(input.expiryDate)) throw fail.invalid('Please enter the document expiry date.');
    if (!isDateStillValid(input.expiryDate, nowMs)) {
      throw fail.precondition('DOCUMENT_EXPIRED', 'This document has already expired. Please renew it first.');
    }
    const maxYear = Number(localDateString(nowMs).slice(0, 4)) + 15;
    if (Number(input.expiryDate.slice(0, 4)) > maxYear) throw fail.invalid('Please check the expiry date.');
    expiryDate = input.expiryDate;
  }
  let documentNumber: string | null = null;
  if (req.numberField) {
    const value = (input.documentNumber ?? '').trim().toUpperCase();
    if (!value && req.numberField.required) throw fail.invalid(`Please enter the ${req.numberField.label.toLowerCase()}.`);
    if (value) {
      if (!new RegExp(req.numberField.pattern).test(value)) throw fail.invalid(`Please check the ${req.numberField.label.toLowerCase()}.`);
      documentNumber = value;
    }
  }
  return { expiryDate, documentNumber };
}

export async function submitDriverDocument(ctx: CallerContext, input: SubmitDocumentInput) {
  await requireActiveUser(ctx.uid, 'DRIVER');
  const policy = await getConfig('documentPolicy');
  const req = policy.driverRequirements.find((r) => r.code === input.requirementCode && r.active);
  if (!req) throw fail.precondition('UNSUPPORTED_DOCUMENT_TYPE', 'This document is not required.');
  const { expiryDate, documentNumber } = validateDocumentInput(req, input, now());
  await enforceRateLimit(ctx.uid, 'submitDriverDocument');

  const submissionId = randomId(12);
  const files = await promoteUploads(ctx.uid, input.uploads, `private/drivers/${ctx.uid}/${req.code}/${submissionId}`, policy.maxUploadBytes);

  let replacedPaths: string[] = [];
  let revoke = false;
  try {
    const result = await db().runTransaction(async (tx) => {
      const state = await loadDriverState(tx, ctx.uid);
      if (state.driver.status === 'REJECTED' || state.driver.status === 'SUSPENDED') {
        throw fail.precondition('VERIFICATION_NOT_ALLOWED', 'Your driver account cannot submit documents right now. Please contact support.');
      }
      const existing = state.documents[req.code];
      replacedPaths = existing?.pending?.files.map((f) => f.storagePath) ?? [];
      const nowT = nowTs();
      const doc: DriverDocumentDoc = {
        driverUid: ctx.uid,
        requirementCode: req.code,
        scope: req.scope,
        label: req.label,
        status: 'PENDING_REVIEW',
        approved: existing?.approved ?? null,
        pending: { submissionId, files, expiryDate, documentNumber, submittedAt: nowT },
        lastDecision: existing?.lastDecision ?? null,
        pendingSubmittedAt: nowT,
        approvedExpiryDate: existing?.approved?.expiryDate ?? null,
        updatedAt: nowT,
      };
      state.documents[req.code] = doc;
      tx.set(state.ref.collection('documents').doc(req.code), doc);
      const evaluation = evaluateDriver(state, policy.driverRequirements, now());
      revoke = writeEvaluation(tx, state, evaluation);
      writeAudit(tx, {
        category: 'REVIEW',
        action: 'DRIVER_DOCUMENT_SUBMITTED',
        actorUid: ctx.uid,
        actorRole: 'DRIVER',
        targetType: 'driverDocument',
        targetId: `${ctx.uid}/${req.code}`,
        targetUid: ctx.uid,
        details: { requirementCode: req.code, submissionId },
      });
      return { requirementCode: req.code, submissionId, status: 'PENDING_REVIEW' as const, driverStatus: evaluation.status };
    });
    // A newer submission replaces an unreviewed one; the old files are never reviewed.
    if (replacedPaths.length) await deleteFilesQuietly(replacedPaths);
    if (revoke) await revokePresence(ctx.uid);
    return result;
  } catch (err) {
    await deleteFilesQuietly(files.map((f) => f.storagePath));
    throw err;
  }
}

/** Driver confirms the application is complete and ready for review. */
export async function submitDriverApplication(ctx: CallerContext) {
  await requireActiveUser(ctx.uid, 'DRIVER');
  const policy = await getConfig('documentPolicy');
  return db().runTransaction(async (tx) => {
    const state = await loadDriverState(tx, ctx.uid);
    if (!state.driver.profile || !state.driver.vehicle) {
      throw fail.precondition('DRIVER_PROFILE_INCOMPLETE', 'Please complete your driver and vehicle details first.');
    }
    const nowMs = now();
    const missing = policy.driverRequirements
      .filter((r) => r.active && r.mandatory)
      .filter((r) => {
        const s = deriveDocumentStatus(toDomainRecord(state.documents[r.code]), nowMs);
        return s === 'NOT_SUBMITTED' || s === 'EXPIRED' || s === 'REJECTED' || s === 'NEEDS_RESUBMISSION';
      })
      .map((r) => r.code);
    if (missing.length > 0) {
      throw fail.precondition('DOCUMENT_REQUIREMENTS_INCOMPLETE', 'Some required documents are still missing.', { missing });
    }
    state.driver.applicationSubmittedAt = state.driver.applicationSubmittedAt ?? nowTs();
    const evaluation = evaluateDriver(state, policy.driverRequirements, nowMs);
    writeEvaluation(tx, state, evaluation, { applicationSubmittedAt: state.driver.applicationSubmittedAt });
    writeAudit(tx, {
      category: 'REVIEW',
      action: 'DRIVER_APPLICATION_SUBMITTED',
      actorUid: ctx.uid,
      actorRole: 'DRIVER',
      targetType: 'driver',
      targetId: ctx.uid,
      targetUid: ctx.uid,
    });
    return { status: evaluation.status };
  });
}

/** Recomputes and returns the caller's eligibility with human-readable reasons. */
export async function refreshMyEligibility(ctx: CallerContext) {
  await requireActiveUser(ctx.uid, 'DRIVER');
  const policy = await getConfig('documentPolicy');
  let revoke = false;
  const result = await db().runTransaction(async (tx) => {
    const state = await loadDriverState(tx, ctx.uid);
    const evaluation = evaluateDriver(state, policy.driverRequirements, now());
    revoke = writeEvaluation(tx, state, evaluation);
    return {
      status: evaluation.status,
      eligible: evaluation.eligibility?.eligible ?? false,
      reasons: evaluation.eligibility?.reasons ?? [],
      validUntil: evaluation.eligibility?.validUntil ?? null,
    };
  });
  if (revoke) await revokePresence(ctx.uid);
  return result;
}

// ---------------------------------------------------------------------------
// Reviewer / admin actions
// ---------------------------------------------------------------------------

export interface ReviewDocumentInput {
  driverUid: string;
  requirementCode: string;
  submissionId: string;
  decision: 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMISSION';
  reasonCode: string | null;
  publicMessage: string | null;
  internalNote: string | null;
  /** Reviewer-confirmed expiry date (may correct the driver's entry). */
  verifiedExpiryDate: string | null;
}

export async function reviewDriverDocument(ctx: CallerContext, input: ReviewDocumentInput) {
  const role = requirePermission(ctx, 'review.decide');
  if (ctx.uid === input.driverUid) throw fail.forbidden('You cannot review your own account.');
  if (input.decision !== 'APPROVE' && (!input.reasonCode || !input.publicMessage)) {
    throw fail.invalid('A reason and a message for the driver are required.');
  }
  const [policy, policies] = await Promise.all([getConfig('documentPolicy'), getConfig('policies')]);
  const req = policy.driverRequirements.find((r) => r.code === input.requirementCode);
  if (!req) throw fail.notFound('Requirement');

  let publishFrom: { path: string; previous: string | null } | null = null;
  let revoke = false;
  const result = await db().runTransaction(async (tx) => {
    const state = await loadDriverState(tx, input.driverUid);
    const doc = state.documents[req.code];
    if (!doc?.pending || doc.pending.submissionId !== input.submissionId) {
      throw fail.precondition('INVALID_STATE_TRANSITION', 'This submission is no longer pending review. Refresh and try again.');
    }
    const nowMs = now();
    const nowT = ts(nowMs);
    let expiryDate = doc.pending.expiryDate;
    if (input.decision === 'APPROVE' && req.hasExpiry) {
      expiryDate = input.verifiedExpiryDate ?? expiryDate;
      if (!expiryDate || !isValidDateString(expiryDate) || !isDateStillValid(expiryDate, nowMs)) {
        throw fail.precondition('DOCUMENT_EXPIRED', 'A valid, unexpired expiry date is required to approve this document.');
      }
    }

    const deletion: string[] = [];
    const updated: DriverDocumentDoc = { ...doc, pendingSubmittedAt: null, updatedAt: nowT, pending: null };
    if (input.decision === 'APPROVE') {
      if (doc.approved) deletion.push(...doc.approved.files.map((f) => f.storagePath));
      const { submittedAt: _submittedAt, ...version } = doc.pending;
      updated.approved = { ...version, expiryDate, approvedAt: nowT, reviewerUid: ctx.uid };
      updated.approvedExpiryDate = expiryDate;
      if (req.publishAsProfilePhoto && version.files[0]) {
        publishFrom = { path: version.files[0].storagePath, previous: state.driver.publicProfile.photoPath };
      }
    } else {
      deletion.push(...doc.pending.files.map((f) => f.storagePath));
    }
    updated.lastDecision = { decision: input.decision, reasonCode: input.reasonCode, publicMessage: input.publicMessage, decidedAt: nowT };
    updated.status = deriveDocumentStatus(toDomainRecord(updated), nowMs);
    state.documents[req.code] = updated;
    tx.set(state.ref.collection('documents').doc(req.code), updated);

    const q = queueFileDeletion(deletion, nowMs + policies.retention.rejectedDocumentsDays * 86_400_000, `DRIVER_DOC_${input.decision}`);
    if (q) tx.set(q.ref, q.data);

    const evaluation = evaluateDriver(state, policy.driverRequirements, nowMs);
    revoke = writeEvaluation(tx, state, evaluation);
    writeAudit(tx, {
      category: 'REVIEW',
      action: `DRIVER_DOCUMENT_${input.decision}`,
      actorUid: ctx.uid,
      actorRole: role,
      targetType: 'driverDocument',
      targetId: `${input.driverUid}/${req.code}`,
      targetUid: input.driverUid,
      reasonCode: input.reasonCode,
      details: { submissionId: input.submissionId, expiryDate, internalNote: input.internalNote },
    });
    return { documentStatus: updated.status, driverStatus: evaluation.status };
  });

  if (publishFrom) {
    const { path, previous } = publishFrom as { path: string; previous: string | null };
    const publicPath = await publishProfilePhoto(input.driverUid, path, previous);
    await driversCol().doc(input.driverUid).update({ 'publicProfile.photoPath': publicPath });
  }
  if (revoke) await revokePresence(input.driverUid);
  await notifyUser(input.driverUid, {
    type: 'ACCREDITATION_UPDATE',
    title: input.decision === 'APPROVE' ? 'Document approved' : 'Document needs attention',
    body: input.decision === 'APPROVE' ? `Your ${req.label} was approved.` : `Please check your ${req.label} in GrabCycle.`,
  });
  return result;
}

export interface ReviewVehicleInput {
  driverUid: string;
  decision: 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMISSION';
  reasonCode: string | null;
  publicMessage: string | null;
  internalNote: string | null;
}

const VEHICLE_DECISION: Record<ReviewVehicleInput['decision'], VehicleStatus> = {
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  REQUEST_RESUBMISSION: 'NEEDS_RESUBMISSION',
};

export async function reviewVehicle(ctx: CallerContext, input: ReviewVehicleInput) {
  const role = requirePermission(ctx, 'review.decide');
  if (ctx.uid === input.driverUid) throw fail.forbidden('You cannot review your own account.');
  if (input.decision !== 'APPROVE' && (!input.reasonCode || !input.publicMessage)) {
    throw fail.invalid('A reason and a message for the driver are required.');
  }
  const policy = await getConfig('documentPolicy');
  let revoke = false;
  const result = await db().runTransaction(async (tx) => {
    const state = await loadDriverState(tx, input.driverUid);
    const vehicle = state.driver.vehicle;
    if (!vehicle) throw fail.precondition('DRIVER_PROFILE_INCOMPLETE', 'The driver has not provided vehicle details.');
    if (input.decision === 'APPROVE') {
      // Vehicle approval requires the vehicle documents themselves to be approved.
      const nowMs = now();
      const missing = policy.driverRequirements
        .filter((r) => r.active && r.mandatory && r.scope === 'VEHICLE')
        .filter((r) => deriveDocumentStatus(toDomainRecord(state.documents[r.code]), nowMs) !== 'APPROVED')
        .map((r) => r.code);
      if (missing.length) {
        throw fail.precondition('DOCUMENT_REQUIREMENTS_INCOMPLETE', 'Approve the vehicle documents first.', { missing });
      }
    }
    const status = VEHICLE_DECISION[input.decision];
    state.driver.vehicle = { ...vehicle, status, publicMessage: input.publicMessage, reviewedAt: nowTs() };
    const evaluation = evaluateDriver(state, policy.driverRequirements, now());
    revoke = writeEvaluation(tx, state, evaluation, { vehicle: state.driver.vehicle });
    writeAudit(tx, {
      category: 'REVIEW',
      action: `DRIVER_VEHICLE_${input.decision}`,
      actorUid: ctx.uid,
      actorRole: role,
      targetType: 'driver',
      targetId: input.driverUid,
      targetUid: input.driverUid,
      reasonCode: input.reasonCode,
      details: { internalNote: input.internalNote },
    });
    return { vehicleStatus: status, driverStatus: evaluation.status };
  });
  if (revoke) await revokePresence(input.driverUid);
  await notifyUser(input.driverUid, {
    type: 'ACCREDITATION_UPDATE',
    title: 'Vehicle review update',
    body: 'There is an update on your tricycle review. Open GrabCycle for details.',
  });
  return result;
}

export interface DriverDecisionInput {
  driverUid: string;
  decision: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REINSTATE';
  reasonCode: string | null;
  publicMessage: string | null;
  internalNote: string | null;
}

export async function decideDriver(ctx: CallerContext, input: DriverDecisionInput) {
  // Approve/reject are review decisions; suspension changes account standing.
  const role = requirePermission(ctx, input.decision === 'SUSPEND' || input.decision === 'REINSTATE' ? 'users.suspend' : 'review.decide');
  if (ctx.uid === input.driverUid) throw fail.forbidden('You cannot review your own account.');
  if (input.decision !== 'APPROVE' && input.decision !== 'REINSTATE' && (!input.reasonCode || !input.publicMessage)) {
    throw fail.invalid('A reason and a message for the driver are required.');
  }
  const policy = await getConfig('documentPolicy');
  let revoke = false;
  const result = await db().runTransaction(async (tx) => {
    const state = await loadDriverState(tx, input.driverUid);
    const nowMs = now();
    const d = state.driver;
    const extra: Record<string, unknown> = {
      decision: { decision: input.decision, reasonCode: input.reasonCode, publicMessage: input.publicMessage, decidedAt: ts(nowMs) },
    };

    switch (input.decision) {
      case 'APPROVE': {
        if (d.status === 'REJECTED' || d.status === 'SUSPENDED' || d.status === 'APPROVED') throw fail.transition(d.status, 'APPROVED');
        if (!d.profile || !d.vehicle) throw fail.precondition('DRIVER_PROFILE_INCOMPLETE', 'Driver profile is incomplete.');
        const blockers = approvalBlockers(domainDocs(state), policy.driverRequirements, d.vehicle.status, nowMs);
        if (blockers.length) {
          throw fail.precondition('DOCUMENT_REQUIREMENTS_INCOMPLETE', 'Every mandatory item must be approved first.', { blockers });
        }
        state.driver.status = 'APPROVED';
        state.driver.everApproved = true;
        extra.everApproved = true;
        break;
      }
      case 'REJECT':
        if (d.status === 'APPROVED' || d.status === 'EXPIRED') {
          throw fail.precondition('INVALID_STATE_TRANSITION', 'Use suspension for drivers who were already approved.');
        }
        state.driver.status = 'REJECTED';
        break;
      case 'SUSPEND':
        if (d.status === 'SUSPENDED') throw fail.transition(d.status, 'SUSPENDED');
        state.driver.status = 'SUSPENDED';
        break;
      case 'REINSTATE':
        if (d.status !== 'SUSPENDED' && d.status !== 'REJECTED') throw fail.transition(d.status, 'REINSTATED');
        // Recompute from documents; first-time approval still needs an explicit APPROVE.
        state.driver.status = d.everApproved ? 'APPROVED' : 'UNDER_REVIEW';
        break;
    }

    const evaluation = evaluateDriver(state, policy.driverRequirements, nowMs);
    revoke = writeEvaluation(tx, state, evaluation, extra);
    writeAudit(tx, {
      category: 'REVIEW',
      action: `DRIVER_${input.decision}`,
      actorUid: ctx.uid,
      actorRole: role,
      targetType: 'driver',
      targetId: input.driverUid,
      targetUid: input.driverUid,
      reasonCode: input.reasonCode,
      details: { from: d.status, to: evaluation.status, internalNote: input.internalNote, onTrip: d.currentRideId != null },
    });
    return { status: evaluation.status, eligible: evaluation.eligibility?.eligible ?? false };
  });
  if (revoke) await revokePresence(input.driverUid);
  await notifyUser(input.driverUid, {
    type: 'ACCREDITATION_UPDATE',
    title: input.decision === 'APPROVE' ? 'You’re approved to drive!' : 'Driver account update',
    body: input.decision === 'APPROVE' ? 'You can now go online and receive ride requests.' : 'Open GrabCycle for details about your driver account.',
  });
  return result;
}

/** Scheduled: marks expired documents and recomputes affected drivers. */
export async function processDocumentExpiry(limit = 300): Promise<{ drivers: number }> {
  const today = localDateString(now());
  const snap = await db()
    .collectionGroup('documents')
    .where('status', '==', 'APPROVED')
    .where('approvedExpiryDate', '<', today)
    .limit(limit)
    .get();
  const uids = [...new Set(snap.docs.map((d) => d.get('driverUid') as string))];
  const policy = await getConfig('documentPolicy');
  for (const uid of uids) {
    let revoke = false;
    let label = '';
    await db().runTransaction(async (tx) => {
      const state = await loadDriverState(tx, uid);
      const nowMs = now();
      for (const [code, doc] of Object.entries(state.documents)) {
        const status = deriveDocumentStatus(toDomainRecord(doc), nowMs);
        if (status !== doc.status) {
          tx.update(state.ref.collection('documents').doc(code), { status, updatedAt: nowTs() });
          state.documents[code] = { ...doc, status };
          if (status === 'EXPIRED') label = doc.label;
        }
      }
      const evaluation = evaluateDriver(state, policy.driverRequirements, nowMs);
      revoke = writeEvaluation(tx, state, evaluation);
      writeAudit(tx, {
        category: 'REVIEW',
        action: 'DRIVER_DOCUMENT_EXPIRED',
        actorUid: 'system',
        actorRole: 'SYSTEM',
        targetType: 'driver',
        targetId: uid,
        targetUid: uid,
        details: { status: evaluation.status },
      });
    });
    if (revoke) await revokePresence(uid);
    await notifyUser(uid, {
      type: 'DOCUMENT_EXPIRY',
      title: 'A document has expired',
      body: `${label || 'A required document'} has expired. Upload a renewed copy to keep receiving rides.`,
    });
  }
  return { drivers: uids.length };
}

/** Scheduled: reminders N days before expiry, per requirement configuration. */
export async function sendExpiryReminders(): Promise<number> {
  const policy = await getConfig('documentPolicy');
  let sent = 0;
  for (const req of policy.driverRequirements.filter((r) => r.active && r.hasExpiry)) {
    for (const days of req.expiryReminderDays) {
      const target = localDateString(now() + days * 86_400_000);
      const snap = await db()
        .collectionGroup('documents')
        .where('requirementCode', '==', req.code)
        .where('approvedExpiryDate', '==', target)
        .limit(500)
        .get();
      for (const doc of snap.docs) {
        if ((doc.data() as DriverDocumentDoc).pending) continue; // renewal already submitted
        await notifyUser(doc.get('driverUid'), {
          type: 'DOCUMENT_EXPIRY',
          title: 'Document expiring soon',
          body: `Your ${req.label} expires in ${days} day${days === 1 ? '' : 's'}. Upload the renewed copy in GrabCycle.`,
        });
        sent++;
      }
    }
  }
  return sent;
}

