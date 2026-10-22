import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { get, ref, remove, serverTimestamp, set, update } from 'firebase/database';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { createRulesEnv } from './env';

let env: RulesTestEnvironment;

const BOUNDS = { minLat: 13.1, maxLat: 13.65, minLng: 121.74, maxLng: 122.22 };

beforeAll(async () => {
  env = await createRulesEnv();
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    await set(ref(db, 'config/bounds'), BOUNDS);
    await set(ref(db, 'presence/dan'), { canPublish: true, sessionId: 'sess-1', trackingPassengerUid: 'alice' });
    await set(ref(db, 'presence/olga'), { canPublish: false, sessionId: 'sess-9', trackingPassengerUid: null });
  });
});

const dbAs = (uid: string) => env.authenticatedContext(uid).database();

function location(over: Record<string, unknown> = {}) {
  return { lat: 13.4467, lng: 121.8406, acc: 12, g: 'wdq3x5s8z', ts: serverTimestamp(), sid: 'sess-1', ...over };
}

async function seedPrevious(uid: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(ctx.database(), `locations/${uid}`), data);
  });
}

describe('driver location publishing', () => {
  it('an online driver publishes a valid location with a server timestamp', async () => {
    await assertSucceeds(set(ref(dbAs('dan'), 'locations/dan'), location({ hdg: 90, spd: 5.5, mock: false })));
  });

  it('cannot publish when the server has not marked the driver online', async () => {
    await assertFails(set(ref(dbAs('olga'), 'locations/olga'), location({ sid: 'sess-9' })));
    await assertFails(set(ref(dbAs('nobody'), 'locations/nobody'), location()));
  });

  it('cannot publish under a stale presence session', async () => {
    await assertFails(set(ref(dbAs('dan'), 'locations/dan'), location({ sid: 'old-session' })));
  });

  it('cannot forge timestamps, coordinates outside the service bounds, or extra fields', async () => {
    await assertFails(set(ref(dbAs('dan'), 'locations/dan'), location({ ts: Date.now() })));
    await assertFails(set(ref(dbAs('dan'), 'locations/dan'), location({ lat: 14.5995, lng: 120.9842 })));
    await assertFails(set(ref(dbAs('dan'), 'locations/dan'), location({ lat: 'north' })));
    await assertFails(set(ref(dbAs('dan'), 'locations/dan'), location({ acc: -1 })));
    await assertFails(set(ref(dbAs('dan'), 'locations/dan'), location({ g: 'INVALID!' })));
    await assertFails(set(ref(dbAs('dan'), 'locations/dan'), location({ available: true })));
    const { acc: _acc, ...missingAccuracy } = location();
    await assertFails(set(ref(dbAs('dan'), 'locations/dan'), missingAccuracy));
  });

  it('cannot write another driver’s location or presence', async () => {
    await assertFails(set(ref(dbAs('eve'), 'locations/dan'), location()));
    await assertFails(update(ref(dbAs('dan'), 'presence/dan'), { canPublish: true }));
    await assertFails(set(ref(dbAs('olga'), 'presence/olga'), { canPublish: true, sessionId: 'x' }));
  });

  it('rejects implausible jumps but accepts normal movement', async () => {
    await seedPrevious('dan', { lat: 13.4467, lng: 121.8406, acc: 10, g: 'wdq3x5s8z', ts: Date.now() - 10_000, sid: 'sess-1' });
    // ~5.5 km in 10 s
    await assertFails(set(ref(dbAs('dan'), 'locations/dan'), location({ lat: 13.4967 })));
    // ~220 m in 10 s
    await assertSucceeds(set(ref(dbAs('dan'), 'locations/dan'), location({ lat: 13.4487 })));
  });

  it('throttles updates to at most one every 2 seconds', async () => {
    await seedPrevious('dan', { lat: 13.4467, lng: 121.8406, acc: 10, g: 'wdq3x5s8z', ts: Date.now() - 300, sid: 'sess-1' });
    await assertFails(set(ref(dbAs('dan'), 'locations/dan'), location()));
  });

  it('a driver may delete their own location', async () => {
    await seedPrevious('dan', { lat: 13.4467, lng: 121.8406, acc: 10, g: 'wdq3x5s8z', ts: Date.now() - 10_000, sid: 'sess-1' });
    await assertSucceeds(remove(ref(dbAs('dan'), 'locations/dan')));
  });
});

describe('location disclosure', () => {
  beforeEach(async () => {
    await seedPrevious('dan', { lat: 13.4467, lng: 121.8406, acc: 10, g: 'wdq3x5s8z', ts: Date.now(), sid: 'sess-1' });
    await seedPrevious('olga', { lat: 13.4467, lng: 121.8406, acc: 10, g: 'wdq3x5s8z', ts: Date.now(), sid: 'sess-9' });
  });

  it('only the passenger on the active trip can read the driver location', async () => {
    await assertSucceeds(get(ref(dbAs('alice'), 'locations/dan')));
    await assertSucceeds(get(ref(dbAs('dan'), 'locations/dan')));
    await assertFails(get(ref(dbAs('bob'), 'locations/dan')));
    await assertFails(get(ref(dbAs('alice'), 'locations/olga')));
  });

  it('nobody can list all driver locations', async () => {
    await assertFails(get(ref(dbAs('alice'), 'locations')));
    await assertFails(get(ref(env.unauthenticatedContext().database(), 'locations/dan')));
  });

  it('presence is visible only to its owner; config bounds to signed-in users', async () => {
    await assertSucceeds(get(ref(dbAs('dan'), 'presence/dan')));
    await assertFails(get(ref(dbAs('alice'), 'presence/dan')));
    await assertSucceeds(get(ref(dbAs('alice'), 'config/bounds')));
    await assertFails(set(ref(dbAs('alice'), 'config/bounds'), BOUNDS));
  });
});
