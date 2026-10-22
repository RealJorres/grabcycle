import { getConfig } from '../lib/configStore';
import { bucket, db } from '../lib/firebase';
import { log } from '../lib/log';
import { now, ts } from '../lib/time';
import { deleteFilesQuietly } from './documentStorage';
import { advanceRide } from './rideMatching';
import { ridesCol } from './rideCommon';

/**
 * Scheduled maintenance. Every task is idempotent and bounded per run, so a
 * missed or overlapping execution never corrupts state.
 */

/** Backstop for ride progress when no participant is polling (every minute). */
export async function sweepRides(limit = 200): Promise<number> {
  const cutoff = ts(now() - 10_000);
  const snap = await ridesCol()
    .where('status', 'in', ['REQUESTED', 'SEARCHING'])
    .where('updatedAt', '<=', cutoff)
    .orderBy('updatedAt')
    .limit(limit)
    .get();
  for (const doc of snap.docs) {
    try {
      await advanceRide(doc.id);
    } catch (err) {
      log.error('sweep.ride_failed', { rideId: doc.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return snap.size;
}

/** Deletes private files whose retention period ended. */
export async function processFileDeletionQueue(limit = 200): Promise<number> {
  const snap = await db().collection('fileDeletionQueue').where('deleteAfter', '<=', ts(now())).limit(limit).get();
  for (const doc of snap.docs) {
    await deleteFilesQuietly((doc.get('paths') as string[]) ?? []);
    await doc.ref.delete();
  }
  return snap.size;
}

/** Removes abandoned staging uploads (also configure a bucket lifecycle rule as a backstop). */
export async function cleanupStagingUploads(): Promise<number> {
  const policies = await getConfig('policies');
  const cutoff = now() - policies.retention.stagingUploadsHours * 3_600_000;
  const [files] = await bucket().getFiles({ prefix: 'uploads/', maxResults: 1000 });
  const old = files.filter((f) => Date.parse(String(f.metadata.timeCreated ?? '')) < cutoff);
  await deleteFilesQuietly(old.map((f) => f.name));
  return old.length;
}

/** Purges expired quotes and rate-limit windows (Firestore TTL policies are the primary mechanism). */
export async function purgeEphemeral(): Promise<number> {
  let deleted = 0;
  for (const [col, field] of [
    ['fareQuotes', 'expiresAt'],
    ['rateLimits', 'expiresAt'],
  ] as const) {
    const snap = await db().collection(col).where(field, '<=', ts(now() - 3_600_000)).limit(400).get();
    const batch = db().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (!snap.empty) await batch.commit();
    deleted += snap.size;
  }
  return deleted;
}

/** Applies the ride-record retention policy (rides, timelines, traces, payments, ratings). */
export async function purgeOldRides(limit = 100): Promise<number> {
  const policies = await getConfig('policies');
  const cutoff = ts(now() - policies.retention.rideRecordsDays * 86_400_000);
  const snap = await ridesCol().where('requestedAt', '<', cutoff).limit(limit).get();
  for (const doc of snap.docs) {
    await db().recursiveDelete(doc.ref);
    await db().collection('payments').doc(doc.id).delete();
    await db().collection('ratings').doc(`${doc.id}_PASSENGER`).delete();
    await db().collection('ratings').doc(`${doc.id}_DRIVER`).delete();
  }
  return snap.size;
}
