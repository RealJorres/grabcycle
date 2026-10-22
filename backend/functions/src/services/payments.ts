import { fail } from '../domain/errors';
import { assertPaymentTransition, cashOutcome } from '../domain/payment';
import { writeAudit } from '../lib/audit';
import { getConfig } from '../lib/configStore';
import type { CallerContext } from '../lib/context';
import { db } from '../lib/firebase';
import { requirePermission } from '../lib/permissions';
import { nowTs } from '../lib/time';
import type { PaymentDoc, RideDoc } from './models';
import { notifyUser } from './notifications';
import { rideRef } from './rideCommon';
import { paymentsCol } from './rides';

/**
 * Payment records. Cash is the initial method; status is independent from
 * ride status and every change is appended to the payment's history.
 *
 * Future online gateways (e.g. PayMongo) plug in behind `PaymentProvider`
 * and confirm payments ONLY from verified server-side webhooks — never from
 * a client success screen. No gateway is implemented yet.
 */
export interface PaymentProvider {
  readonly method: string;
  /** Creates a provider-side payment intent for a completed ride. */
  createIntent(payment: PaymentDoc): Promise<{ providerRef: string; clientAction: unknown }>;
  /** Verifies a webhook signature and returns the confirmed outcome (idempotent by event id). */
  verifyWebhook(rawBody: Buffer, signature: string): Promise<{ eventId: string; providerRef: string; status: 'PAID' | 'FAILED' | 'REFUNDED' }>;
}

/** Driver records cash collected after completing a trip without recording it. */
export async function recordCashPayment(ctx: CallerContext, input: { rideId: string; amountCollected: number }) {
  const cfg = await getConfig('payments');
  return db().runTransaction(async (tx) => {
    const ref = paymentsCol().doc(input.rideId);
    const snap = await tx.get(ref);
    const p = snap.data() as PaymentDoc | undefined;
    if (!p || p.driverUid !== ctx.uid) throw fail.notFound('Payment');
    if (p.status !== 'UNPAID') throw fail.precondition('PAYMENT_ALREADY_RECORDED', 'Payment for this trip was already recorded.');
    const outcome = cashOutcome(p.amountDue, input.amountCollected, cfg.cashDiscrepancyTolerance);
    assertPaymentTransition('UNPAID', outcome.status, 'DRIVER');
    const now = nowTs();
    tx.update(ref, {
      status: outcome.status,
      amountCollected: input.amountCollected,
      discrepancy: outcome.discrepancy,
      recordedBy: ctx.uid,
      recordedAt: now,
      history: [...p.history, { status: outcome.status, by: ctx.uid, at: now, note: outcome.discrepancy ? `Shortfall ${outcome.discrepancy}` : null }],
      updatedAt: now,
    });
    tx.update(rideRef(input.rideId), { 'payment.status': outcome.status, updatedAt: now });
    return { status: outcome.status };
  });
}

/** Passenger or driver disputes a payment; staff follow up through a support case. */
export async function disputePayment(ctx: CallerContext, input: { rideId: string; description: string }) {
  const result = await db().runTransaction(async (tx) => {
    const ref = paymentsCol().doc(input.rideId);
    const p = (await tx.get(ref)).data() as PaymentDoc | undefined;
    if (!p || (p.passengerUid !== ctx.uid && p.driverUid !== ctx.uid)) throw fail.notFound('Payment');
    const role = p.passengerUid === ctx.uid ? 'PASSENGER' : 'DRIVER';
    if (p.status === 'DISPUTED') return { caseId: null, status: p.status };
    assertPaymentTransition(p.status, 'DISPUTED', role);
    const now = nowTs();
    tx.update(ref, { status: 'DISPUTED', history: [...p.history, { status: 'DISPUTED', by: ctx.uid, at: now, note: null }], updatedAt: now });
    tx.update(rideRef(input.rideId), { 'payment.status': 'DISPUTED', updatedAt: now });
    const caseRef = db().collection('supportCases').doc();
    tx.set(caseRef, {
      caseId: caseRef.id,
      reporterUid: ctx.uid,
      reporterRole: role,
      rideId: input.rideId,
      category: 'FARE_OR_PAYMENT',
      description: input.description,
      status: 'OPEN',
      priority: 'NORMAL',
      publicResponse: null,
      assignedTo: null,
      createdAt: now,
      updatedAt: now,
    });
    return { caseId: caseRef.id, status: 'DISPUTED' as const };
  });
  return result;
}

/** Staff resolve a pending or disputed payment. */
export async function resolvePayment(ctx: CallerContext, input: { rideId: string; status: 'PAID' | 'REFUNDED' | 'FAILED'; note: string }) {
  const role = requirePermission(ctx, 'payments.manage');
  const p = await db().runTransaction(async (tx) => {
    const ref = paymentsCol().doc(input.rideId);
    const payment = (await tx.get(ref)).data() as PaymentDoc | undefined;
    if (!payment) throw fail.notFound('Payment');
    assertPaymentTransition(payment.status, input.status, 'ADMIN');
    const ride = (await tx.get(rideRef(input.rideId))).data() as RideDoc | undefined;
    const now = nowTs();
    tx.update(ref, { status: input.status, history: [...payment.history, { status: input.status, by: ctx.uid, at: now, note: input.note }], updatedAt: now });
    if (ride) tx.update(rideRef(input.rideId), { 'payment.status': input.status, updatedAt: now });
    writeAudit(tx, {
      category: 'PAYMENT',
      action: `PAYMENT_${input.status}`,
      actorUid: ctx.uid,
      actorRole: role,
      targetType: 'payment',
      targetId: input.rideId,
      targetUid: payment.passengerUid,
      details: { from: payment.status, note: input.note },
    });
    return payment;
  });
  await notifyUser(p.passengerUid, { type: 'PAYMENT_UPDATE', title: 'Payment update', body: 'There is an update on a trip payment.', rideId: input.rideId });
  return { status: input.status };
}
