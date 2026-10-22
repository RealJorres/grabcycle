import { onSchedule } from 'firebase-functions/scheduler';
import { log } from '../lib/log';
import { sweepStaleDrivers } from '../services/availability';
import { processDocumentExpiry, sendExpiryReminders } from '../services/drivers';
import { expirePassengerApprovals } from '../services/passengerVerification';
import {
  cleanupStagingUploads,
  processFileDeletionQueue,
  purgeEphemeral,
  purgeOldAuditLogs,
  purgeOldRides,
  sweepRides,
} from '../services/sweepers';

const TZ = 'Asia/Manila';

async function run(name: string, task: () => Promise<unknown>): Promise<void> {
  try {
    const result = await task();
    log.info(`schedule.${name}`, { result });
  } catch (err) {
    log.error(`schedule.${name}.failed`, { message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/** Backstop for offer timeouts and search deadlines when no client is polling. */
export const sweepRidesJob = onSchedule({ schedule: 'every 1 minutes', timeZone: TZ, timeoutSeconds: 120, retryCount: 0 }, () =>
  run('sweepRides', () => sweepRides()),
);

/** Takes unreachable drivers offline and reconciles RTDB publishing rights. */
export const sweepDriversJob = onSchedule({ schedule: 'every 5 minutes', timeZone: TZ, timeoutSeconds: 300, retryCount: 0 }, () =>
  run('sweepDrivers', () => sweepStaleDrivers()),
);

/** Runs just after local midnight so date-based expiry applies promptly. */
export const documentExpiryJob = onSchedule({ schedule: '5 0 * * *', timeZone: TZ, timeoutSeconds: 540 }, async () => {
  await run('documentExpiry', () => processDocumentExpiry());
  await run('passengerApprovalExpiry', () => expirePassengerApprovals());
});

export const expiryRemindersJob = onSchedule({ schedule: '0 9 * * *', timeZone: TZ, timeoutSeconds: 300 }, () =>
  run('expiryReminders', () => sendExpiryReminders()),
);

/** Retention and cleanup. */
export const maintenanceJob = onSchedule({ schedule: '30 2 * * *', timeZone: TZ, timeoutSeconds: 540, memory: '512MiB' }, async () => {
  await run('fileDeletionQueue', () => processFileDeletionQueue());
  await run('stagingUploads', () => cleanupStagingUploads());
  await run('ephemeral', () => purgeEphemeral());
  await run('rideRetention', () => purgeOldRides());
  await run('auditRetention', () => purgeOldAuditLogs());
});
