import { CONFIG_SCHEMAS, fareConfigSchema, type ConfigKey, type ConfigTypes, type FareConfig } from '../domain/config';
import { DEFAULT_APP, DEFAULT_MATCHING, DEFAULT_PAYMENTS, DEFAULT_POLICIES } from '../domain/defaults';
import { AppError } from '../domain/errors';
import { db } from './firebase';
import { log } from './log';
import { now } from './time';

/**
 * Reads runtime configuration from Firestore (`config/{key}`) with a short
 * in-memory cache. Operational settings fall back to safe defaults; the
 * service area, document policy and fare rules FAIL CLOSED when missing or
 * invalid, so the platform never operates on unconfigured regulatory data.
 */

const FALLBACKS: Partial<{ [K in ConfigKey]: ConfigTypes[K] }> = {
  matching: DEFAULT_MATCHING,
  policies: DEFAULT_POLICIES,
  payments: DEFAULT_PAYMENTS,
  app: DEFAULT_APP,
};

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: unknown }>();

function unavailable(what: string): AppError {
  return new AppError('unavailable', 'SERVICE_UNAVAILABLE', `${what} is not configured yet. Please try again later.`, {
    config: what,
  });
}

export async function getConfig<K extends ConfigKey>(key: K): Promise<ConfigTypes[K]> {
  const cached = cache.get(key);
  if (cached && now() - cached.at < CACHE_TTL_MS) return cached.value as ConfigTypes[K];

  const snap = await db().collection('config').doc(key).get();
  let value: ConfigTypes[K];
  if (!snap.exists) {
    const fallback = FALLBACKS[key];
    if (!fallback) throw unavailable(key);
    value = fallback as ConfigTypes[K];
  } else {
    const parsed = CONFIG_SCHEMAS[key].safeParse(snap.data());
    if (!parsed.success) {
      log.error('config.invalid', { key, issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')) });
      throw unavailable(key);
    }
    value = parsed.data as ConfigTypes[K];
  }
  cache.set(key, { at: now(), value });
  return value;
}

export interface ActiveFare {
  version: string;
  config: FareConfig;
}

export async function getActiveFareConfig(): Promise<ActiveFare> {
  const cached = cache.get('fare');
  if (cached && now() - cached.at < CACHE_TTL_MS) return cached.value as ActiveFare;

  const pointer = await db().collection('config').doc('fare').get();
  const version = pointer.get('activeVersion');
  if (typeof version !== 'string' || !version) throw unavailable('Fare rules');
  const snap = await db().collection('fareConfigs').doc(version).get();
  const parsed = fareConfigSchema.safeParse(snap.data());
  if (!snap.exists || !parsed.success) {
    log.error('config.fare.invalid', { version });
    throw unavailable('Fare rules');
  }
  const value = { version, config: parsed.data };
  cache.set('fare', { at: now(), value });
  return value;
}

/** Loads a specific (possibly inactive) fare version, e.g. to re-derive a historical quote. */
export async function getFareConfigVersion(version: string): Promise<FareConfig> {
  const snap = await db().collection('fareConfigs').doc(version).get();
  const parsed = fareConfigSchema.safeParse(snap.data());
  if (!snap.exists || !parsed.success) throw unavailable('Fare rules');
  return parsed.data;
}

export function clearConfigCache(): void {
  cache.clear();
}
