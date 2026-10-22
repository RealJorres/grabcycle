import type { DocumentReference, DocumentSnapshot } from 'firebase-admin/firestore';
import { fail } from '../domain/errors';
import { isTerminalRideStatus } from '../domain/rideStateMachine';
import { writeAudit } from '../lib/audit';
import type { CallerContext } from '../lib/context';
import { auth, bucket, db, rtdb } from '../lib/firebase';
import { log } from '../lib/log';
import { requirePermission } from '../lib/permissions';
import { nowTs } from '../lib/time';
import { driversCol, usersCol } from './accounts';
import type { RideDoc, UserDoc } from './models';

/**
 * Data-subject requests (Data Privacy Act): staff-run export, deletion with
 * anonymisation of records that must be retained, and resolution. Every
 * step is audited; the request record tracks progress.
 */

export const DELETED = '[deleted]';

type RequestType = 'ACCESS' | 'DELETION' | 'CORRECTION';
type RequestStatus = 'RECEIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED';

interface DataRequestDoc {
  requestId: string;
  uid: string;
  type: RequestType;
  note: string | null;
  status: RequestStatus;
}

const requestsCol = () => db().collection('dataRequests');

async function loadOpenRequest(requestId: string, type?: RequestType): Promise<{ ref: DocumentReference; req: DataRequestDoc }> {
  const ref = requestsCol().doc(requestId);
  const req = (await ref.get()).data() as DataRequestDoc | undefined;
  if (!req) throw fail.notFound('Data request');
  if (req.status === 'COMPLETED' || req.status === 'REJECTED') {
    throw fail.precondition('INVALID_STATE_TRANSITION', 'This request is already closed.');
  }
  if (type && req.type !== type) throw fail.invalid(`This is not a ${type.toLowerCase()} request.`);
  return { ref, req };
}

/** Firestore Timestamp → ISO string for a portable export. */
function plain(value: unknown): unknown {
  if (value == null) return value;
  if (typeof (value as { toDate?: unknown }).toDate === 'function') return (value as { toDate(): Date }).toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

function strip<T extends Record<string, unknown>>(data: T | undefined, keys: string[]): Record<string, unknown> | null {
  if (!data) return null;
  const copy: Record<string, unknown> = { ...data };
  for (const k of keys) delete copy[k];
  return plain(copy) as Record<string, unknown>;
}

async function docsWhere(collection: string, field: string, uid: string): Promise<DocumentSnapshot[]> {
  return (await db().collection(collection).where(field, '==', uid).limit(5000).get()).docs;
}

/**
 * Builds the export for an ACCESS request: the person's own records, without
 * staff-internal content (reviewer notes, file locations, matching
 * internals) or other people's contact details.
 */
export async function exportUserData(ctx: CallerContext, input: { requestId: string }) {
  const role = requirePermission(ctx, 'privacy.manage');
  const { ref, req } = await loadOpenRequest(input.requestId);
  const uid = req.uid;
  const [user, driver, driverDocs, ridesP, ridesD, paysP, paysD, ratingsGiven, cases, verifications] = await Promise.all([
    usersCol().doc(uid).get(),
    driversCol().doc(uid).get(),
    driversCol().doc(uid).collection('documents').get(),
    docsWhere('rides', 'passengerUid', uid),
    docsWhere('rides', 'driverUid', uid),
    docsWhere('payments', 'passengerUid', uid),
    docsWhere('payments', 'driverUid', uid),
    docsWhere('ratings', 'raterUid', uid),
    docsWhere('supportCases', 'reporterUid', uid),
    docsWhere('verificationCases', 'uid', uid),
  ]);
  const rideView = (d: DocumentSnapshot) => strip(d.data(), ['offer', 'searchDeadline']);
  const data = {
    generatedAt: new Date().toISOString(),
    uid,
    account: strip(user.data(), []),
    driver: strip(driver.data(), ['presenceSessionId', 'missedOffers']),
    driverDocuments: driverDocs.docs.map((d) => {
      const x = d.data();
      // File locations stay internal; the export states what was submitted and decided.
      const version = (v: Record<string, unknown> | null | undefined) => (v ? strip(v, ['files', 'reviewerUid']) : null);
      return { requirement: x.label, status: x.status, approved: version(x.approved), pending: version(x.pending), lastDecision: strip(x.lastDecision, []) };
    }),
    identityVerifications: verifications.map((d) => {
      const x = d.data() ?? {};
      return {
        caseId: d.id,
        status: x.status,
        idType: x.idTypeLabel,
        nameOnId: x.nameOnId,
        idExpiry: x.idExpiry,
        submittedAt: plain(x.submittedAt),
        decision: x.decision ? { decision: x.decision.decision, reasonCode: x.decision.reasonCode, publicMessage: x.decision.publicMessage, decidedAt: plain(x.decision.decidedAt) } : null,
      };
    }),
    ridesAsPassenger: ridesP.map(rideView),
    ridesAsDriver: ridesD.map(rideView),
    payments: [...paysP, ...paysD].map((d) => strip(d.data(), ['recordedBy'])),
    ratingsGiven: ratingsGiven.map((d) => strip(d.data(), ['rateeUid'])),
    supportCases: cases.map((d) => strip(d.data(), ['assignedTo'])),
  };
  await ref.update({ status: 'IN_PROGRESS', updatedAt: nowTs(), handledBy: ctx.uid });
  await writeAudit(null, {
    category: 'SECURITY',
    action: 'DATA_EXPORTED',
    actorUid: ctx.uid,
    actorRole: role,
    targetType: 'dataRequest',
    targetId: input.requestId,
    targetUid: uid,
    details: { rides: ridesP.length + ridesD.length, cases: cases.length },
  });
  return data;
}

/** Closes a request after it was fulfilled (or declined with a documented reason). */
export async function resolveDataRequest(ctx: CallerContext, input: { requestId: string; status: 'COMPLETED' | 'REJECTED'; resolutionNote: string }) {
  const role = requirePermission(ctx, 'privacy.manage');
  const { ref, req } = await loadOpenRequest(input.requestId);
  await ref.update({ status: input.status, resolutionNote: input.resolutionNote, resolvedAt: nowTs(), handledBy: ctx.uid, updatedAt: nowTs() });
  await writeAudit(null, {
    category: 'SECURITY',
    action: `DATA_REQUEST_${input.status}`,
    actorUid: ctx.uid,
    actorRole: role,
    targetType: 'dataRequest',
    targetId: input.requestId,
    targetUid: req.uid,
    details: { type: req.type },
  });
  return { status: input.status };
}

/**
 * Fulfils a DELETION request. Refuses while the person has an active trip or
 * an open payment dispute. Deletes the account, profile, driver record,
 * devices, files and live location; records that must be retained for the
 * configured period (rides, payments, ratings, support cases, verification
 * decisions, audit) are kept but stripped of identifying content. Safe to
 * re-run: every step is idempotent.
 */
export async function deleteUserData(ctx: CallerContext, input: { requestId: string; confirmUid: string }) {
  const role = requirePermission(ctx, 'privacy.manage');
  const { ref, req } = await loadOpenRequest(input.requestId, 'DELETION');
  const uid = req.uid;
  if (input.confirmUid !== uid) throw fail.invalid('Type the account id exactly to confirm the deletion.');
  if (uid === ctx.uid) throw fail.forbidden('You cannot process your own deletion request.');

  const user = (await usersCol().doc(uid).get()).data() as UserDoc | undefined;
  const driver = (await driversCol().doc(uid).get()).data() as { currentRideId?: string | null; currentOfferRideId?: string | null } | undefined;
  const activeIds = [user?.activeRideId, driver?.currentRideId].filter((x): x is string => !!x);
  for (const rideId of activeIds) {
    const ride = (await db().collection('rides').doc(rideId).get()).data() as RideDoc | undefined;
    if (ride && !isTerminalRideStatus(ride.status)) {
      throw fail.precondition('INVALID_STATE_TRANSITION', 'The account has an active trip. Resolve it before deleting.', { rideId });
    }
  }
  const disputes = [
    ...(await db().collection('payments').where('passengerUid', '==', uid).where('status', '==', 'DISPUTED').limit(1).get()).docs,
    ...(await db().collection('payments').where('driverUid', '==', uid).where('status', '==', 'DISPUTED').limit(1).get()).docs,
  ];
  if (disputes.length > 0) {
    throw fail.precondition('INVALID_STATE_TRANSITION', 'The account has an open payment dispute. Resolve it before deleting.', { rideId: disputes[0]!.id });
  }

  await ref.update({ status: 'IN_PROGRESS', updatedAt: nowTs(), handledBy: ctx.uid });
  const counts = { rides: 0, ratings: 0, supportCases: 0, verificationCases: 0, files: 0 };

  // 1. Stop all access first: sign-in and live location.
  await auth().deleteUser(uid).catch((err: { code?: string }) => {
    if (err?.code !== 'auth/user-not-found') throw err;
  });
  await rtdb().ref(`presence/${uid}`).remove();
  await rtdb().ref(`locations/${uid}`).remove();

  // 2. Files: identity and accreditation images, staged uploads, public photo.
  for (const prefix of [`private/identity/${uid}/`, `private/accreditation/${uid}/`, `uploads/${uid}/`, `public/driverPhotos/${uid}/`]) {
    const [files] = await bucket().getFiles({ prefix });
    await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true })));
    counts.files += files.length;
  }

  // 3. Retained records: keep the facts, remove identifying content.
  const batchUpdate = async (snaps: DocumentSnapshot[], patch: (d: DocumentSnapshot) => Record<string, unknown>) => {
    for (let i = 0; i < snaps.length; i += 400) {
      const batch = db().batch();
      snaps.slice(i, i + 400).forEach((d) => batch.update(d.ref, patch(d)));
      await batch.commit();
    }
  };
  const ridesP = await docsWhere('rides', 'passengerUid', uid);
  const ridesD = await docsWhere('rides', 'driverUid', uid);
  await batchUpdate(ridesP, () => ({ 'passenger.firstName': DELETED, 'pickup.note': null }));
  await batchUpdate(ridesD.filter((d) => d.get('driver') != null), () => ({ 'driver.displayName': DELETED, 'driver.photoPath': null }));
  counts.rides = ridesP.length + ridesD.length;
  for (const r of [...ridesP, ...ridesD]) await r.ref.collection('contact').doc('info').delete();

  const ratings = [...(await docsWhere('ratings', 'raterUid', uid)), ...(await docsWhere('ratings', 'rateeUid', uid))];
  await batchUpdate(ratings, () => ({ comment: null }));
  counts.ratings = ratings.length;

  const cases = await docsWhere('supportCases', 'reporterUid', uid);
  await batchUpdate(cases, () => ({ description: DELETED }));
  counts.supportCases = cases.length;

  const verifications = await docsWhere('verificationCases', 'uid', uid);
  await batchUpdate(verifications, () => ({ nameOnId: DELETED, applicantName: DELETED, applicantPhoneMasked: null, files: [] }));
  counts.verificationCases = verifications.length;

  // 4. Account documents.
  await db().recursiveDelete(usersCol().doc(uid));
  await db().recursiveDelete(driversCol().doc(uid));

  await ref.update({ status: 'COMPLETED', resolvedAt: nowTs(), resolutionNote: 'Account deleted; retained records anonymised.', updatedAt: nowTs() });
  await writeAudit(null, {
    category: 'SECURITY',
    action: 'DATA_DELETION_COMPLETED',
    actorUid: ctx.uid,
    actorRole: role,
    targetType: 'dataRequest',
    targetId: input.requestId,
    targetUid: uid,
    details: counts,
  });
  log.info('privacy.deleted', { requestId: input.requestId, ...counts });
  return { status: 'COMPLETED' as const, ...counts };
}
