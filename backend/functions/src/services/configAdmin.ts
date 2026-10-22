import { CONFIG_SCHEMAS, fareConfigSchema, type ConfigKey, type FareConfig } from '../domain/config';
import { fail } from '../domain/errors';
import { isInServiceArea } from '../domain/serviceArea';
import { writeAudit } from '../lib/audit';
import { clearConfigCache, getConfig } from '../lib/configStore';
import type { CallerContext } from '../lib/context';
import { db } from '../lib/firebase';
import { randomId } from '../lib/ids';
import { DEPLOY_ENV } from '../lib/params';
import { requirePermission } from '../lib/permissions';
import { now, nowTs } from '../lib/time';
import { clearLandmarkCache, type LandmarkDoc } from './places';
import { syncServiceBounds } from './presence';

/**
 * Administrator configuration management. Every change is schema-validated,
 * versioned in `configHistory`, and audit-logged. Production refuses
 * configuration still flagged as SAMPLE data.
 */

function isProduction(): boolean {
  try {
    return DEPLOY_ENV.value() === 'production';
  } catch {
    return false;
  }
}

export async function updateConfig(ctx: CallerContext, input: { key: ConfigKey; value: unknown }) {
  const role = requirePermission(ctx, 'config.manage');
  const schema = CONFIG_SCHEMAS[input.key];
  const parsed = schema.safeParse(input.value);
  if (!parsed.success) {
    throw fail.invalid('The configuration is invalid.', {
      fields: parsed.error.issues.slice(0, 15).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const value = parsed.data as Record<string, unknown>;
  if (isProduction() && value.isSample === true) {
    throw fail.precondition('INVALID_ARGUMENT', 'Sample configuration cannot be used in production. Review the values and clear the sample flag.');
  }

  const ref = db().collection('config').doc(input.key);
  await db().runTransaction(async (tx) => {
    const before = await tx.get(ref);
    const revision = ((before.get('meta.revision') as number | undefined) ?? 0) + 1;
    tx.set(ref, { ...value, meta: { revision, updatedAt: nowTs(), updatedBy: ctx.uid } });
    tx.set(db().collection('configHistory').doc(), {
      key: input.key,
      revision,
      value,
      previous: before.exists ? before.data() : null,
      updatedBy: ctx.uid,
      at: nowTs(),
    });
    writeAudit(tx, {
      category: 'CONFIG',
      action: 'CONFIG_UPDATED',
      actorUid: ctx.uid,
      actorRole: role,
      targetType: 'config',
      targetId: input.key,
      details: { revision },
    });
  });
  clearConfigCache();
  if (input.key === 'serviceArea') await syncServiceBounds();
  return { key: input.key };
}

export async function publishFareConfig(ctx: CallerContext, input: { config: unknown; activate: boolean }) {
  const role = requirePermission(ctx, 'config.manage');
  const parsed = fareConfigSchema.safeParse(input.config);
  if (!parsed.success) {
    throw fail.invalid('The fare rules are invalid.', {
      fields: parsed.error.issues.slice(0, 15).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const config: FareConfig = parsed.data;
  if (input.activate && isProduction() && config.isSample) {
    throw fail.precondition('INVALID_ARGUMENT', 'Sample fare rules cannot be activated in production.');
  }
  const stamp = new Date(now()).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const version = `fare-${stamp}-${randomId(3)}`;
  await db().runTransaction(async (tx) => {
    tx.set(db().collection('fareConfigs').doc(version), { ...config, version, createdAt: nowTs(), createdBy: ctx.uid });
    if (input.activate) tx.set(db().collection('config').doc('fare'), { activeVersion: version, activatedAt: nowTs(), activatedBy: ctx.uid });
    writeAudit(tx, {
      category: 'CONFIG',
      action: input.activate ? 'FARE_PUBLISHED_AND_ACTIVATED' : 'FARE_PUBLISHED',
      actorUid: ctx.uid,
      actorRole: role,
      targetType: 'fareConfig',
      targetId: version,
      details: { isSample: config.isSample, mode: config.mode },
    });
  });
  clearConfigCache();
  return { version, active: input.activate };
}

export async function activateFareVersion(ctx: CallerContext, input: { version: string }) {
  const role = requirePermission(ctx, 'config.manage');
  const snap = await db().collection('fareConfigs').doc(input.version).get();
  const parsed = fareConfigSchema.safeParse(snap.data());
  if (!snap.exists || !parsed.success) throw fail.notFound('Fare version');
  if (isProduction() && parsed.data.isSample) throw fail.precondition('INVALID_ARGUMENT', 'Sample fare rules cannot be activated in production.');
  await db().collection('config').doc('fare').set({ activeVersion: input.version, activatedAt: nowTs(), activatedBy: ctx.uid });
  await writeAudit(null, {
    category: 'CONFIG',
    action: 'FARE_ACTIVATED',
    actorUid: ctx.uid,
    actorRole: role,
    targetType: 'fareConfig',
    targetId: input.version,
  });
  clearConfigCache();
  return { version: input.version };
}

export async function upsertLandmark(ctx: CallerContext, input: { id: string | null } & Omit<LandmarkDoc, 'isSample'>) {
  const role = requirePermission(ctx, 'config.manage');
  const area = await getConfig('serviceArea');
  if (!isInServiceArea(area, input)) throw fail.precondition('OUTSIDE_SERVICE_AREA', 'The landmark is outside the service area.');
  const id = input.id ?? db().collection('landmarks').doc().id;
  const { id: _ignored, ...data } = input;
  await db().collection('landmarks').doc(id).set({ ...data, isSample: false, updatedAt: nowTs(), updatedBy: ctx.uid });
  await writeAudit(null, {
    category: 'CONFIG',
    action: input.id ? 'LANDMARK_UPDATED' : 'LANDMARK_CREATED',
    actorUid: ctx.uid,
    actorRole: role,
    targetType: 'landmark',
    targetId: id,
  });
  clearLandmarkCache();
  return { id };
}
