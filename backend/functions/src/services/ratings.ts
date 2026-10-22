import { fail } from '../domain/errors';
import { getConfig } from '../lib/configStore';
import type { CallerContext } from '../lib/context';
import { db } from '../lib/firebase';
import { enforceRateLimit } from '../lib/rateLimit';
import { millis, now, nowTs } from '../lib/time';
import { driversCol, usersCol } from './accounts';
import type { RideDoc } from './models';
import { increment, rideRef } from './rideCommon';

/**
 * Two-way ratings after a legitimately COMPLETED trip. The rating id is
 * deterministic (`{rideId}_{role}`), so each party can rate once per trip,
 * and only the two participants can rate each other.
 */
export async function submitRating(ctx: CallerContext, input: { rideId: string; stars: number; comment: string | null; tags: string[] }) {
  await enforceRateLimit(ctx.uid, 'rating');
  const policies = await getConfig('policies');
  return db().runTransaction(async (tx) => {
    const ride = (await tx.get(rideRef(input.rideId))).data() as RideDoc | undefined;
    if (!ride) throw fail.notFound('Ride');
    let role: 'PASSENGER' | 'DRIVER';
    if (ride.passengerUid === ctx.uid) role = 'PASSENGER';
    else if (ride.driverUid === ctx.uid) role = 'DRIVER';
    else throw fail.notFound('Ride');
    if (ride.status !== 'COMPLETED' || !ride.driverUid) throw fail.precondition('RATING_NOT_ALLOWED', 'Only completed trips can be rated.');
    const completedAt = millis(ride.completedAt) ?? 0;
    if (now() - completedAt > policies.ratings.ratingWindowDays * 86_400_000) {
      throw fail.precondition('RATING_NOT_ALLOWED', 'The rating period for this trip has ended.');
    }
    const rateeUid = role === 'PASSENGER' ? ride.driverUid : ride.passengerUid;
    if (rateeUid === ctx.uid) throw fail.precondition('RATING_NOT_ALLOWED', 'You cannot rate yourself.');

    const ratingRef = db().collection('ratings').doc(`${input.rideId}_${role}`);
    if ((await tx.get(ratingRef)).exists) throw fail.precondition('RATING_ALREADY_SUBMITTED', 'You already rated this trip.');

    tx.set(ratingRef, {
      rideId: input.rideId,
      raterUid: ctx.uid,
      raterRole: role,
      rateeUid,
      stars: input.stars,
      comment: input.comment,
      tags: input.tags,
      createdAt: nowTs(),
    });
    const summaryRef = role === 'PASSENGER' ? driversCol().doc(rateeUid) : usersCol().doc(rateeUid);
    tx.update(summaryRef, { 'ratingSummary.count': increment(1), 'ratingSummary.sum': increment(input.stars) });
    tx.update(rideRef(input.rideId), { [role === 'PASSENGER' ? 'rated.byPassenger' : 'rated.byDriver']: true });
    return { ok: true };
  });
}
