import { logger } from 'firebase-functions';

/**
 * Structured logging with defensive redaction. Never log passwords, tokens,
 * phone numbers, private storage paths, ID numbers or precise coordinates.
 */
const REDACT_KEYS = /(token|password|secret|phone|storagepath|path|documentnumber|licen[cs]e|idnumber|authorization|email)/i;
const COORD_KEYS = /^(lat|lng|latitude|longitude)$/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.test(k)) out[k] = '[redacted]';
      // Coarsen coordinates to ~1 km so logs cannot reconstruct movements.
      else if (COORD_KEYS.test(k) && typeof v === 'number') out[k] = Math.round(v * 100) / 100;
      else out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

export const log = {
  info: (event: string, fields: Record<string, unknown> = {}) => logger.info(event, sanitize(fields)),
  warn: (event: string, fields: Record<string, unknown> = {}) => logger.warn(event, sanitize(fields)),
  error: (event: string, fields: Record<string, unknown> = {}) => logger.error(event, sanitize(fields)),
};

export const _sanitizeForTesting = sanitize;
