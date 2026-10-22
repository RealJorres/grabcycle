import { beforeEach, describe, expect, it } from 'vitest';
import { writeAudit } from '../../src/lib/audit';
import { bucket, db } from '../../src/lib/firebase';
import { setClockForTesting, ts } from '../../src/lib/time';
import { queueFileDeletion } from '../../src/services/documentStorage';
import { cleanupStagingUploads, processFileDeletionQueue, purgeEphemeral, purgeOldAuditLogs, purgeOldRides } from '../../src/services/sweepers';
import { DEFAULT_POLICIES } from '../../src/domain/defaults';
import { getDoc, jpegBytes, resetEmulators, seedConfig, stageUpload } from './helpers';

const DAY = 86_400_000;
const T0 = Date.parse('2030-01-01T00:00:00+08:00');

beforeEach(async () => {
  await resetEmulators();
  await seedConfig();
  setClockForTesting(() => T0);
});

describe('retention jobs', () => {
  it('deletes ride records older than rideRecordsDays, with their timelines, payments and ratings', async () => {
    const old = T0 - (DEFAULT_POLICIES.retention.rideRecordsDays + 1) * DAY;
    const recent = T0 - 10 * DAY;
    for (const [id, at] of [['a'.repeat(32), old], ['b'.repeat(32), recent]] as const) {
      await db().doc(`rides/${id}`).set({ rideId: id, requestedAt: ts(at), status: 'COMPLETED' });
      await db().doc(`rides/${id}/events/e1`).set({ type: 'COMPLETED', at: ts(at) });
      await db().doc(`payments/${id}`).set({ rideId: id, status: 'PAID' });
      await db().doc(`ratings/${id}_PASSENGER`).set({ rideId: id, stars: 5 });
    }
    expect(await purgeOldRides()).toBe(1);
    expect(await getDoc(`rides/${'a'.repeat(32)}`)).toBeUndefined();
    expect(await getDoc(`rides/${'a'.repeat(32)}/events/e1`)).toBeUndefined();
    expect(await getDoc(`payments/${'a'.repeat(32)}`)).toBeUndefined();
    expect(await getDoc(`ratings/${'a'.repeat(32)}_PASSENGER`)).toBeUndefined();
    expect(await getDoc(`rides/${'b'.repeat(32)}`)).toBeDefined();
    expect(await getDoc(`payments/${'b'.repeat(32)}`)).toBeDefined();
  });

  it('deletes audit entries older than auditLogDays and keeps newer ones', async () => {
    setClockForTesting(() => T0 - (DEFAULT_POLICIES.retention.auditLogDays + 1) * DAY);
    await writeAudit(null, { category: 'CONFIG', action: 'OLD', actorUid: 'x', actorRole: 'admin', targetType: 't', targetId: '1' });
    setClockForTesting(() => T0 - DAY);
    await writeAudit(null, { category: 'CONFIG', action: 'NEW', actorUid: 'x', actorRole: 'admin', targetType: 't', targetId: '2' });
    setClockForTesting(() => T0);
    expect(await purgeOldAuditLogs()).toBe(1);
    const left = await db().collection('auditLogs').get();
    expect(left.docs.map((d) => d.get('action'))).toEqual(['NEW']);
  });

  it('deletes queued private files only after their retention date', async () => {
    const due = 'private/identity/u1/case1/a.jpg';
    const later = 'private/identity/u1/case2/b.jpg';
    for (const p of [due, later]) await bucket().file(p).save(jpegBytes(), { resumable: false, contentType: 'image/jpeg' });
    const q1 = queueFileDeletion([due], T0 - 1, 'TEST')!;
    const q2 = queueFileDeletion([later], T0 + DAY, 'TEST')!;
    await q1.ref.set(q1.data);
    await q2.ref.set(q2.data);
    expect(await processFileDeletionQueue()).toBe(1);
    expect((await bucket().file(due).exists())[0]).toBe(false);
    expect((await bucket().file(later).exists())[0]).toBe(true);
  });

  it('removes abandoned staging uploads after stagingUploadsHours', async () => {
    const uploadId = await stageUpload('u2');
    // Uploaded "now" in real time; nothing is old yet.
    setClockForTesting(() => Date.now());
    expect(await cleanupStagingUploads()).toBe(0);
    setClockForTesting(() => Date.now() + (DEFAULT_POLICIES.retention.stagingUploadsHours + 1) * 3_600_000);
    expect(await cleanupStagingUploads()).toBe(1);
    expect((await bucket().file(`uploads/u2/${uploadId}`).exists())[0]).toBe(false);
  });

  it('purges expired quotes and rate-limit windows', async () => {
    await db().doc('fareQuotes/q-old').set({ expiresAt: ts(T0 - 2 * 3_600_000) });
    await db().doc('fareQuotes/q-live').set({ expiresAt: ts(T0 + 600_000) });
    await db().doc('rateLimits/r-old').set({ expiresAt: ts(T0 - 2 * 3_600_000) });
    expect(await purgeEphemeral()).toBe(2);
    expect(await getDoc('fareQuotes/q-live')).toBeDefined();
  });
});
