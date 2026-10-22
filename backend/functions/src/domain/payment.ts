import { fail } from './errors';
import type { PaymentStatus } from './types';

/**
 * Payment status is deliberately independent from ride status: a COMPLETED
 * ride can still be UNPAID, PENDING (cash discrepancy) or DISPUTED.
 */

type PaymentActor = 'DRIVER' | 'PASSENGER' | 'ADMIN' | 'PROVIDER';

const RULES: ReadonlyArray<{ from: readonly PaymentStatus[]; to: PaymentStatus; actors: readonly PaymentActor[] }> = [
  { from: ['UNPAID'], to: 'PAID', actors: ['DRIVER', 'ADMIN', 'PROVIDER'] },
  { from: ['UNPAID'], to: 'PENDING', actors: ['DRIVER', 'PROVIDER'] },
  { from: ['PENDING'], to: 'PAID', actors: ['ADMIN', 'PROVIDER'] },
  { from: ['PENDING', 'UNPAID'], to: 'FAILED', actors: ['PROVIDER', 'ADMIN'] },
  { from: ['FAILED'], to: 'UNPAID', actors: ['ADMIN'] },
  { from: ['UNPAID', 'PENDING', 'PAID'], to: 'DISPUTED', actors: ['PASSENGER', 'DRIVER', 'ADMIN'] },
  { from: ['DISPUTED'], to: 'PAID', actors: ['ADMIN'] },
  { from: ['DISPUTED', 'PAID'], to: 'REFUNDED', actors: ['ADMIN', 'PROVIDER'] },
];

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus, actor: PaymentActor): boolean {
  return RULES.some((r) => r.to === to && r.from.includes(from) && r.actors.includes(actor));
}

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus, actor: PaymentActor): void {
  if (!canTransitionPayment(from, to, actor)) throw fail.transition(from, to);
}

/** Outcome of recording collected cash against the amount due. */
export function cashOutcome(
  amountDue: number,
  amountCollected: number,
  tolerance: number,
): { status: 'PAID' | 'PENDING'; discrepancy: number } {
  const discrepancy = amountDue - amountCollected;
  return { status: discrepancy <= tolerance ? 'PAID' : 'PENDING', discrepancy: Math.max(0, discrepancy) };
}
