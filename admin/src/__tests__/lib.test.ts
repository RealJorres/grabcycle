import { FirebaseError } from 'firebase/app';
import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { auditConstraints } from '../lib/auditQuery';
import { signInMessage } from '../lib/authMessages';
import { parseConfigJson } from '../lib/configJson';
import { readEnv } from '../lib/env';
import { toDisplayError } from '../lib/errors';
import { formatCalendarDate, formatCentavos, formatDateTime, humanize, maskPhone, relativeAge } from '../lib/format';
import { normalizePhilippineMobile } from '../lib/phone';
import { sortCases } from '../lib/support';

describe('format', () => {
  it('formats integer centavos as pesos', () => {
    expect(formatCentavos(4550)).toBe('₱45.50');
    expect(formatCentavos(0)).toBe('₱0.00');
    expect(formatCentavos(null)).toBe('—');
  });

  it('shows times in Philippine time regardless of the device zone', () => {
    // 2026-10-22T16:30:00Z is 00:30 the next day in Manila (UTC+8).
    expect(formatDateTime(Date.UTC(2026, 9, 22, 16, 30))).toMatch(/Oct 23, 2026/);
  });

  it('never shifts calendar dates', () => {
    expect(formatCalendarDate('2030-01-01')).toMatch(/Jan 1, 2030/);
    expect(formatCalendarDate('not-a-date')).toBe('—');
  });

  it('masks phone numbers and humanizes codes', () => {
    expect(maskPhone('+639171234567')).toBe('+63 917 ••• 4567');
    expect(maskPhone(null)).toBe('—');
    expect(humanize('DRIVER_EN_ROUTE')).toBe('Driver en route');
    expect(relativeAge(Date.now() - 5 * 60_000)).toBe('5 min ago');
  });
});

describe('phone normalization', () => {
  it.each([
    ['0917 123 4567', '+639171234567'],
    ['+63 917-123-4567', '+639171234567'],
    ['9171234567', '+639171234567'],
    ['639171234567', '+639171234567'],
    ['02 8123 4567', null],
    ['hello', null],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePhilippineMobile(input)).toBe(expected);
  });
});

describe('error display', () => {
  it('uses the stable backend reason and exposes field errors', () => {
    const err = new FirebaseError('functions/invalid-argument', 'The configuration is invalid.');
    (err as unknown as { details: unknown }).details = { reason: 'INVALID_ARGUMENT', fields: [{ path: 'matching.offerTimeoutSec', message: 'Too small' }, 'junk'] };
    const d = toDisplayError(err);
    expect(d.reason).toBe('INVALID_ARGUMENT');
    expect(d.message).toBe('The configuration is invalid.');
    expect(d.fields).toEqual([{ path: 'matching.offerTimeoutSec', message: 'Too small' }]);
  });

  it('explains permission errors without leaking details', () => {
    const err = new FirebaseError('functions/permission-denied', 'Forbidden');
    expect(toDisplayError(err).message).toBe('Your role does not allow this action.');
    expect(toDisplayError(new Error('boom')).message).toBe('boom');
  });

  it('does not reveal whether an email is registered on sign-in', () => {
    expect(signInMessage('auth/user-not-found')).toBe(signInMessage('auth/wrong-password'));
    expect(signInMessage('auth/too-many-requests')).toMatch(/Too many attempts/);
  });
});

describe('env', () => {
  it('reports missing Firebase settings instead of crashing', () => {
    expect(readEnv({}).missing).toContain('VITE_FIREBASE_PROJECT_ID');
    const { env } = readEnv({
      VITE_FIREBASE_API_KEY: 'k',
      VITE_FIREBASE_AUTH_DOMAIN: 'd',
      VITE_FIREBASE_PROJECT_ID: 'p',
      VITE_FIREBASE_APP_ID: 'a',
      VITE_USE_EMULATORS: 'true',
    });
    expect(env?.functionsRegion).toBe('asia-southeast1');
    expect(env?.useEmulators).toBe(true);
    expect(env?.recaptchaSiteKey).toBeNull();
  });
});

describe('config editor parsing', () => {
  it('rejects non-objects and strips server metadata', () => {
    expect(parseConfigJson('[1]').error).toMatch(/JSON object/);
    expect(parseConfigJson('{').error).toMatch(/Invalid JSON/);
    expect(parseConfigJson('{"a":1,"meta":{"revision":3}}').value).toEqual({ a: 1 });
  });
});

describe('audit queries', () => {
  const asJson = (c: ReturnType<typeof auditConstraints>) => (c ? c.map((x) => x.type) : null);

  it('always constrains non-admins to their category (rules would deny otherwise)', () => {
    const c = auditConstraints({ category: '', targetUid: '', actorUid: '' }, ['REVIEW']);
    expect(asJson(c)).toEqual(['where', 'orderBy', 'limit']);
    expect(auditConstraints({ category: 'CONFIG', targetUid: '', actorUid: '' }, ['REVIEW'])).toBeNull();
  });

  it('lets admins query everything or by actor', () => {
    expect(asJson(auditConstraints({ category: '', targetUid: '', actorUid: '' }, 'ALL'))).toEqual(['orderBy', 'limit']);
    expect(asJson(auditConstraints({ category: '', targetUid: '', actorUid: 'u1' }, 'ALL'))).toEqual(['where', 'orderBy', 'limit']);
    expect(asJson(auditConstraints({ category: 'REVIEW', targetUid: 'u2', actorUid: '' }, 'ALL'))).toEqual(['where', 'where', 'orderBy', 'limit']);
  });
});

describe('support ordering', () => {
  it('puts urgent cases first, oldest first within a priority', () => {
    const t = (ms: number) => Timestamp.fromMillis(ms);
    const sorted = sortCases([
      { id: 'a', priority: 'NORMAL' as const, createdAt: t(1) },
      { id: 'b', priority: 'URGENT' as const, createdAt: t(5) },
      { id: 'c', priority: 'URGENT' as const, createdAt: t(2) },
      { id: 'd', priority: 'HIGH' as const, createdAt: t(0) },
    ]);
    expect(sorted.map((c) => c.id)).toEqual(['c', 'b', 'd', 'a']);
  });
});
