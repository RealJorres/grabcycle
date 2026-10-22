import type { Query } from 'firebase-admin/firestore';
import { localDateString } from '../domain/dates';
import { fail } from '../domain/errors';
import { STAFF_ROLES, type StaffRole } from '../domain/types';
import { writeAudit } from '../lib/audit';
import { getConfig } from '../lib/configStore';
import type { CallerContext } from '../lib/context';
import { auth, db } from '../lib/firebase';
import { requirePermission } from '../lib/permissions';
import { enforceRateLimit } from '../lib/rateLimit';
import { now, nowTs, ts } from '../lib/time';
import { driversCol, usersCol } from './accounts';
import { readPrivateFile } from './documentStorage';
import { evaluateDriver, loadDriverState, writeEvaluation } from './drivers';
import type { DriverDocumentDoc, UserDoc, VerificationCaseDoc } from './models';
import { notifyUser } from './notifications';
import { casesCol } from './passengerVerification';
import { revokePresence } from './presence';

/**
 * Staff-only operations that are not part of a specific review queue.
 */

// ---------------------------------------------------------------------------
// Audited document viewing
// ---------------------------------------------------------------------------

export type DocumentFileRef =
  | { kind: 'PASSENGER_CASE'; caseId: string; side: string }
  | { kind: 'DRIVER_DOCUMENT'; driverUid: string; requirementCode: string; version: 'pending' | 'approved'; side: string };

/**
 * Returns the bytes of one private document image to an authorized reviewer.
 * The storage path is resolved server-side from the review record; clients
 * can never request arbitrary paths. Every access is audit-logged.
 */
export async function getDocumentFile(ctx: CallerContext, ref: DocumentFileRef) {
  const role = requirePermission(ctx, 'documents.view');
  await enforceRateLimit(ctx.uid, 'documentView');

  let path: string | undefined;
  let targetUid: string;
  let targetId: string;
  if (ref.kind === 'PASSENGER_CASE') {
    const snap = await casesCol().doc(ref.caseId).get();
    if (!snap.exists) throw fail.notFound('Verification case');
    const c = snap.data() as VerificationCaseDoc;
    path = c.files.find((f) => f.side === ref.side)?.storagePath;
    targetUid = c.uid;
    targetId = c.caseId;
  } else {
    const snap = await driversCol().doc(ref.driverUid).collection('documents').doc(ref.requirementCode).get();
    if (!snap.exists) throw fail.notFound('Document');
    const d = snap.data() as DriverDocumentDoc;
    path = d[ref.version]?.files.find((f) => f.side === ref.side)?.storagePath;
    targetUid = ref.driverUid;
    targetId = `${ref.driverUid}/${ref.requirementCode}/${ref.version}`;
  }
  if (!path) throw fail.notFound('Document image');
  if (targetUid === ctx.uid) throw fail.forbidden('You cannot open your own documents from the review console.');

  const { bytes, contentType } = await readPrivateFile(path);
  await writeAudit(null, {
    category: 'REVIEW',
    action: 'DOCUMENT_VIEWED',
    actorUid: ctx.uid,
    actorRole: role,
    targetType: ref.kind === 'PASSENGER_CASE' ? 'verificationCase' : 'driverDocument',
    targetId,
    targetUid,
    details: { side: ref.side },
  });
  return { contentType, dataBase64: bytes.toString('base64') };
}

// ---------------------------------------------------------------------------
// Account standing
// ---------------------------------------------------------------------------

export interface AccountStatusInput {
  uid: string;
  status: 'ACTIVE' | 'SUSPENDED';
  reasonCode: string;
  publicMessage: string;
  internalNote: string | null;
}

/**
 * Suspends or reinstates an account. Suspension disables the Auth user and
 * revokes refresh tokens, so reinstalling the app or switching devices does
 * not bypass it; ID tokens already issued expire within the hour and every
 * function re-checks `users/{uid}.status` anyway.
 */
export async function setAccountStatus(ctx: CallerContext, input: AccountStatusInput) {
  const role = requirePermission(ctx, 'users.suspend');
  if (input.uid === ctx.uid) throw fail.forbidden('You cannot change your own account status.');
  const policy = await getConfig('documentPolicy');
  let revoke = false;

  const result = await db().runTransaction(async (tx) => {
    const userRef = usersCol().doc(input.uid);
    const snap = await tx.get(userRef);
    if (!snap.exists) throw fail.notFound('Account');
    const user = snap.data() as UserDoc;
    const driverState = user.accountType === 'DRIVER' ? await loadDriverState(tx, input.uid) : null;
    if (user.status === input.status) return { status: user.status, activeRideId: user.activeRideId ?? driverState?.driver.currentRideId ?? null };

    tx.update(userRef, {
      status: input.status,
      suspension: input.status === 'SUSPENDED' ? { reasonCode: input.reasonCode, publicMessage: input.publicMessage, at: nowTs() } : null,
      updatedAt: nowTs(),
    });
    if (driverState) {
      driverState.driver.accountStatus = input.status;
      const evaluation = evaluateDriver(driverState, policy.driverRequirements, now());
      revoke = writeEvaluation(tx, driverState, evaluation, { accountStatus: input.status });
    }
    writeAudit(tx, {
      category: 'SECURITY',
      action: input.status === 'SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_REINSTATED',
      actorUid: ctx.uid,
      actorRole: role,
      targetType: 'user',
      targetId: input.uid,
      targetUid: input.uid,
      reasonCode: input.reasonCode,
      details: { internalNote: input.internalNote },
    });
    return { status: input.status, activeRideId: user.activeRideId ?? driverState?.driver.currentRideId ?? null };
  });

  if (input.status === 'SUSPENDED') {
    await auth().updateUser(input.uid, { disabled: true });
    await auth().revokeRefreshTokens(input.uid);
    if (revoke) await revokePresence(input.uid);
  } else {
    await auth().updateUser(input.uid, { disabled: false });
    await notifyUser(input.uid, { type: 'ACCOUNT_UPDATE', title: 'Account reinstated', body: 'Your GrabCycle account is active again.' });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fare discount entitlements (e.g. senior citizen, PWD, student)
// ---------------------------------------------------------------------------

export async function setFareDiscount(
  ctx: CallerContext,
  input: { uid: string; code: string | null; expiresOn: string | null; reasonCode: string },
) {
  const role = requirePermission(ctx, 'review.decide');
  await db().runTransaction(async (tx) => {
    const ref = usersCol().doc(input.uid);
    const user = (await tx.get(ref)).data() as UserDoc | undefined;
    if (!user || user.accountType !== 'PASSENGER') throw fail.notFound('Passenger');
    tx.update(ref, {
      fareDiscount: input.code
        ? {
            code: input.code,
            verifiedAt: nowTs(),
            expiresAt: input.expiresOn ? ts(Date.parse(`${input.expiresOn}T23:59:59+08:00`)) : null,
            verifiedBy: ctx.uid,
          }
        : null,
      updatedAt: nowTs(),
    });
    writeAudit(tx, {
      category: 'REVIEW',
      action: input.code ? 'FARE_DISCOUNT_GRANTED' : 'FARE_DISCOUNT_REMOVED',
      actorUid: ctx.uid,
      actorRole: role,
      targetType: 'user',
      targetId: input.uid,
      targetUid: input.uid,
      reasonCode: input.reasonCode,
      details: { code: input.code, expiresOn: input.expiresOn },
    });
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Staff role management (superadmin only)
// ---------------------------------------------------------------------------

export async function setStaffRole(ctx: CallerContext, input: { email: string; role: StaffRole | null }) {
  requirePermission(ctx, 'staff.manage');
  const target = await auth().getUserByEmail(input.email).catch(() => null);
  if (!target) throw fail.notFound('Staff user (create the account in Firebase Authentication first)');
  if (target.uid === ctx.uid) throw fail.forbidden('You cannot change your own role.');
  if (input.role && !(STAFF_ROLES as readonly string[]).includes(input.role)) throw fail.invalid('Unknown role.');

  // Staff identities must stay separate from rider/driver accounts.
  const userDoc = await usersCol().doc(target.uid).get();
  if (userDoc.exists) throw fail.precondition('ACCOUNT_TYPE_MISMATCH', 'Passenger or driver accounts cannot be given staff roles.');

  const previous = (target.customClaims?.staffRole as string | undefined) ?? null;
  if (previous === 'superadmin' && input.role !== 'superadmin') {
    const supers = await db().collection('staff').where('role', '==', 'superadmin').where('active', '==', true).get();
    if (supers.size <= 1) throw fail.precondition('PERMISSION_DENIED', 'At least one superadmin must remain.');
  }

  const claims = { ...(target.customClaims ?? {}) } as Record<string, unknown>;
  if (input.role) claims.staffRole = input.role;
  else delete claims.staffRole;
  await auth().setCustomUserClaims(target.uid, claims);
  // Force re-authentication so a removed or reduced role takes effect promptly.
  await auth().revokeRefreshTokens(target.uid);

  await db()
    .collection('staff')
    .doc(target.uid)
    .set(
      { uid: target.uid, email: target.email ?? input.email, role: input.role, active: input.role != null, updatedAt: nowTs(), updatedBy: ctx.uid },
      { merge: true },
    );
  await writeAudit(null, {
    category: 'SECURITY',
    action: 'STAFF_ROLE_CHANGED',
    actorUid: ctx.uid,
    actorRole: ctx.staffRole ?? 'unknown',
    targetType: 'staff',
    targetId: target.uid,
    targetUid: target.uid,
    details: { from: previous, to: input.role },
  });
  return { uid: target.uid, role: input.role };
}

// ---------------------------------------------------------------------------
// Operational overview
// ---------------------------------------------------------------------------

export async function getOverview(ctx: CallerContext) {
  requirePermission(ctx, 'reports.read');
  const count = async (q: Query) => (await q.count().get()).data().count;
  const users = usersCol();
  const drivers = driversCol();
  const rides = db().collection('rides');
  const startOfDay = ts(Date.parse(`${localDateString(now())}T00:00:00+08:00`));

  const [
    passengers,
    passengersPending,
    driversTotal,
    driversPending,
    driversOnline,
    activeRides,
    completedToday,
    cancelledToday,
    openSupport,
    pendingPayments,
  ] = await Promise.all([
    count(users.where('accountType', '==', 'PASSENGER')),
    count(users.where('passengerVerification.status', 'in', ['SUBMITTED', 'UNDER_REVIEW'])),
    count(drivers),
    count(drivers.where('status', '==', 'UNDER_REVIEW')),
    count(drivers.where('availability', 'in', ['ONLINE', 'OFFERED', 'ON_TRIP'])),
    count(rides.where('status', 'in', ['REQUESTED', 'SEARCHING', 'ACCEPTED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS'])),
    count(rides.where('status', '==', 'COMPLETED').where('completedAt', '>=', startOfDay)),
    count(rides.where('status', 'in', ['CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN']).where('cancelledAt', '>=', startOfDay)),
    count(db().collection('supportCases').where('status', 'in', ['OPEN', 'IN_PROGRESS'])),
    count(db().collection('payments').where('status', 'in', ['PENDING', 'DISPUTED'])),
  ]);
  const pendingDocuments = await count(db().collectionGroup('documents').where('status', '==', 'PENDING_REVIEW'));

  return {
    passengers,
    passengersPendingVerification: passengersPending,
    drivers: driversTotal,
    driversAwaitingApproval: driversPending,
    driverDocumentsPendingReview: pendingDocuments,
    driversOnline,
    activeRides,
    completedToday,
    cancelledToday,
    openSupportCases: openSupport,
    paymentsNeedingAttention: pendingPayments,
    generatedAt: now(),
  };
}
