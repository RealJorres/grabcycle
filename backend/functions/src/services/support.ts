import { fail } from '../domain/errors';
import type { SupportCategory, SupportStatus } from '../domain/types';
import { writeAudit } from '../lib/audit';
import type { CallerContext } from '../lib/context';
import { db } from '../lib/firebase';
import { requirePermission } from '../lib/permissions';
import { enforceRateLimit } from '../lib/rateLimit';
import { nowTs } from '../lib/time';
import { requireActiveUser } from './accounts';
import type { RideDoc, SupportCaseDoc } from './models';
import { notifyUser } from './notifications';
import { rideRef } from './rideCommon';

/**
 * Support / incident reports linked (optionally) to a ride. Reporters see
 * their own cases and the public response; internal notes are staff-only.
 * GrabCycle does not claim to dispatch emergency services: the app directs
 * users to call 911 for emergencies.
 */
export async function createSupportCase(ctx: CallerContext, input: { rideId: string | null; category: SupportCategory; description: string }) {
  const user = await requireActiveUser(ctx.uid);
  await enforceRateLimit(ctx.uid, 'supportCase');
  if (input.rideId) {
    const ride = (await rideRef(input.rideId).get()).data() as RideDoc | undefined;
    if (!ride || (ride.passengerUid !== ctx.uid && ride.driverUid !== ctx.uid)) throw fail.notFound('Ride');
  }
  const ref = db().collection('supportCases').doc();
  const doc: SupportCaseDoc = {
    caseId: ref.id,
    reporterUid: ctx.uid,
    reporterRole: user.accountType,
    rideId: input.rideId,
    category: input.category,
    description: input.description,
    status: 'OPEN',
    priority: input.category === 'SAFETY' ? 'URGENT' : 'NORMAL',
    publicResponse: null,
    assignedTo: null,
    createdAt: nowTs(),
    updatedAt: nowTs(),
  };
  await ref.set(doc);
  await writeAudit(null, {
    category: 'SUPPORT',
    action: 'SUPPORT_CASE_CREATED',
    actorUid: ctx.uid,
    actorRole: user.accountType,
    targetType: 'supportCase',
    targetId: ref.id,
    targetUid: ctx.uid,
    details: { category: input.category, rideId: input.rideId },
  });
  return { caseId: ref.id, priority: doc.priority };
}

export async function updateSupportCase(
  ctx: CallerContext,
  input: { caseId: string; status: SupportStatus; publicResponse: string | null; internalNote: string | null; assignToMe: boolean },
) {
  const role = requirePermission(ctx, 'support.manage');
  const result = await db().runTransaction(async (tx) => {
    const ref = db().collection('supportCases').doc(input.caseId);
    const c = (await tx.get(ref)).data() as SupportCaseDoc | undefined;
    if (!c) throw fail.notFound('Support case');
    tx.update(ref, {
      status: input.status,
      ...(input.publicResponse != null ? { publicResponse: input.publicResponse } : {}),
      ...(input.assignToMe ? { assignedTo: ctx.uid } : {}),
      updatedAt: nowTs(),
    });
    if (input.internalNote) {
      tx.set(ref.collection('notes').doc(), { note: input.internalNote, authorUid: ctx.uid, createdAt: nowTs() });
    }
    writeAudit(tx, {
      category: 'SUPPORT',
      action: 'SUPPORT_CASE_UPDATED',
      actorUid: ctx.uid,
      actorRole: role,
      targetType: 'supportCase',
      targetId: input.caseId,
      targetUid: c.reporterUid,
      details: { from: c.status, to: input.status },
    });
    return c;
  });
  if (input.publicResponse) {
    await notifyUser(result.reporterUid, { type: 'SUPPORT_UPDATE', title: 'Support update', body: 'GrabCycle support replied to your report.' });
  }
  return { status: input.status };
}
