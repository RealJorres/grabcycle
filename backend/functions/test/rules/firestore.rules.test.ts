import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, deleteDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { createRulesEnv } from './env';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createRulesEnv();
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/alice'), {
      uid: 'alice',
      accountType: 'PASSENGER',
      status: 'ACTIVE',
      passengerVerification: { status: 'SUBMITTED', validUntil: null },
    });
    await setDoc(doc(db, 'users/bob'), { uid: 'bob', accountType: 'PASSENGER', status: 'ACTIVE' });
    await setDoc(doc(db, 'drivers/dan'), { uid: 'dan', status: 'APPROVED', availability: 'ONLINE' });
    await setDoc(doc(db, 'drivers/dan/documents/DRIVERS_LICENSE'), { status: 'APPROVED' });
    await setDoc(doc(db, 'drivers/dan/private/details'), { licenseNumber: 'N01-12-123456' });
    await setDoc(doc(db, 'verificationCases/case1'), { uid: 'alice', status: 'SUBMITTED' });
    await setDoc(doc(db, 'rides/r1'), {
      passengerUid: 'alice',
      driverUid: 'dan',
      status: 'ACCEPTED',
      offer: null,
    });
    await setDoc(doc(db, 'rides/r1/events/e1'), { type: 'ACCEPTED' });
    await setDoc(doc(db, 'rides/r1/contact/info'), { passengerPhone: '+639170000000', driverPhone: '+639180000000' });
    await setDoc(doc(db, 'rides/r1/private/matching'), { candidates: ['dan'] });
    await setDoc(doc(db, 'rides/r2'), {
      passengerUid: 'bob',
      driverUid: null,
      status: 'SEARCHING',
      offer: { driverId: 'dan', expiresAt: 0 },
    });
    await setDoc(doc(db, 'rides/r3'), { passengerUid: 'alice', driverUid: 'dan', status: 'COMPLETED', offer: null });
    await setDoc(doc(db, 'rides/r3/contact/info'), { passengerPhone: '+639170000000' });
    await setDoc(doc(db, 'payments/r1'), { passengerUid: 'alice', driverUid: 'dan', status: 'UNPAID' });
    await setDoc(doc(db, 'supportCases/s1'), { reporterUid: 'alice', status: 'OPEN', category: 'OTHER' });
    await setDoc(doc(db, 'supportCases/s1/notes/n1'), { note: 'internal' });
    await setDoc(doc(db, 'config/matching'), { initialRadiusM: 2000 });
    await setDoc(doc(db, 'auditLogs/a1'), { category: 'REVIEW', action: 'X' });
    await setDoc(doc(db, 'auditLogs/a2'), { category: 'SECURITY', action: 'Y' });
    await setDoc(doc(db, 'fareQuotes/q1'), { passengerUid: 'alice' });
    await setDoc(doc(db, 'staff/rev1'), { role: 'reviewer' });
  });
});

const as = (uid: string, staffRole?: string) =>
  env.authenticatedContext(uid, staffRole ? { staffRole } : {}).firestore();

describe('accounts', () => {
  it('owners read their own profile; others cannot', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'users/alice')));
    await assertFails(getDoc(doc(as('bob'), 'users/alice')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/alice')));
  });

  it('clients can never write approval state, roles or status', async () => {
    const db = as('alice');
    await assertFails(updateDoc(doc(db, 'users/alice'), { 'passengerVerification.status': 'APPROVED' }));
    await assertFails(setDoc(doc(db, 'users/mallory'), { uid: 'mallory', accountType: 'DRIVER' }));
    await assertFails(updateDoc(doc(db, 'users/alice'), { status: 'ACTIVE' }));
    await assertFails(deleteDoc(doc(db, 'users/alice')));
    await assertFails(setDoc(doc(db, 'staff/alice'), { role: 'superadmin' }));
  });

  it('a forged non-staff claim value grants nothing', async () => {
    await assertFails(getDocs(collection(as('alice', 'driver'), 'users')));
    await assertFails(getDoc(doc(as('alice', 'passenger'), 'verificationCases/case1')));
  });

  it('only staff can list users', async () => {
    await assertFails(getDocs(collection(as('alice'), 'users')));
    await assertSucceeds(getDocs(collection(as('s1', 'support'), 'users')));
  });

  it('staff directory is superadmin-only (plus self)', async () => {
    await assertSucceeds(getDoc(doc(as('rev1', 'reviewer'), 'staff/rev1')));
    await assertFails(getDocs(collection(as('a1', 'admin'), 'staff')));
    await assertSucceeds(getDocs(collection(as('su', 'superadmin'), 'staff')));
  });
});

describe('drivers and documents', () => {
  it('drivers read only their own records and documents', async () => {
    await assertSucceeds(getDoc(doc(as('dan'), 'drivers/dan')));
    await assertSucceeds(getDoc(doc(as('dan'), 'drivers/dan/documents/DRIVERS_LICENSE')));
    await assertSucceeds(getDoc(doc(as('dan'), 'drivers/dan/private/details')));
    await assertFails(getDoc(doc(as('alice'), 'drivers/dan')));
    await assertFails(getDoc(doc(as('alice'), 'drivers/dan/private/details')));
  });

  it('drivers cannot make themselves available or approved', async () => {
    await assertFails(updateDoc(doc(as('dan'), 'drivers/dan'), { availability: 'ONLINE' }));
    await assertFails(updateDoc(doc(as('dan'), 'drivers/dan'), { status: 'APPROVED' }));
    await assertFails(setDoc(doc(as('dan'), 'drivers/dan/documents/VEHICLE_OR'), { status: 'APPROVED' }));
  });

  it('support staff cannot read sensitive driver details; reviewers can', async () => {
    await assertFails(getDoc(doc(as('s1', 'support'), 'drivers/dan/private/details')));
    await assertSucceeds(getDoc(doc(as('r1', 'reviewer'), 'drivers/dan/private/details')));
  });

  it('verification cases are reviewer-only', async () => {
    await assertFails(getDoc(doc(as('alice'), 'verificationCases/case1')));
    await assertFails(getDoc(doc(as('s1', 'support'), 'verificationCases/case1')));
    await assertSucceeds(getDoc(doc(as('r1', 'reviewer'), 'verificationCases/case1')));
  });
});

describe('rides', () => {
  it('participants read their ride; unrelated users cannot', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'rides/r1')));
    await assertSucceeds(getDoc(doc(as('dan'), 'rides/r1')));
    await assertFails(getDoc(doc(as('bob'), 'rides/r1')));
  });

  it('an offered driver can read the request; nobody can write rides', async () => {
    await assertSucceeds(getDoc(doc(as('dan'), 'rides/r2')));
    await assertFails(getDoc(doc(as('eve'), 'rides/r2')));
    await assertFails(updateDoc(doc(as('dan'), 'rides/r2'), { status: 'ACCEPTED', driverUid: 'dan' }));
    await assertFails(setDoc(doc(as('alice'), 'rides/r9'), { passengerUid: 'alice', status: 'ACCEPTED' }));
  });

  it('ride queries must be constrained to the caller', async () => {
    await assertSucceeds(getDocs(query(collection(as('alice'), 'rides'), where('passengerUid', '==', 'alice'))));
    await assertSucceeds(getDocs(query(collection(as('dan'), 'rides'), where('driverUid', '==', 'dan'))));
    await assertFails(getDocs(collection(as('alice'), 'rides')));
    await assertFails(getDocs(query(collection(as('alice'), 'rides'), where('passengerUid', '==', 'bob'))));
  });

  it('events visible to participants; matching internals admin-only', async () => {
    await assertSucceeds(getDocs(collection(as('alice'), 'rides/r1/events')));
    await assertFails(getDocs(collection(as('bob'), 'rides/r1/events')));
    await assertFails(getDoc(doc(as('alice'), 'rides/r1/private/matching')));
    await assertSucceeds(getDoc(doc(as('a1', 'admin'), 'rides/r1/private/matching')));
  });

  it('contact numbers are visible only while the trip is active', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'rides/r1/contact/info')));
    await assertFails(getDoc(doc(as('bob'), 'rides/r1/contact/info')));
    await assertFails(getDoc(doc(as('alice'), 'rides/r3/contact/info')));
  });
});

describe('payments, support, config, audit', () => {
  it('payments are readable by participants and never writable', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'payments/r1')));
    await assertFails(getDoc(doc(as('bob'), 'payments/r1')));
    await assertFails(updateDoc(doc(as('dan'), 'payments/r1'), { status: 'PAID' }));
  });

  it('support cases are private to the reporter; notes are staff-only', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'supportCases/s1')));
    await assertFails(getDoc(doc(as('bob'), 'supportCases/s1')));
    await assertFails(getDocs(collection(as('alice'), 'supportCases/s1/notes')));
    await assertSucceeds(getDocs(collection(as('s1', 'support'), 'supportCases/s1/notes')));
  });

  it('config is readable when signed in and never client-writable', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'config/matching')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'config/matching')));
    await assertFails(setDoc(doc(as('a1', 'admin'), 'config/matching'), { initialRadiusM: 1 }));
  });

  it('audit logs are scoped by role and category', async () => {
    await assertSucceeds(getDoc(doc(as('a1', 'admin'), 'auditLogs/a2')));
    await assertSucceeds(getDoc(doc(as('r1', 'reviewer'), 'auditLogs/a1')));
    await assertFails(getDoc(doc(as('r1', 'reviewer'), 'auditLogs/a2')));
    await assertFails(getDoc(doc(as('alice'), 'auditLogs/a1')));
  });

  it('server-only collections are inaccessible', async () => {
    await assertFails(getDoc(doc(as('alice'), 'fareQuotes/q1')));
    await assertFails(getDoc(doc(as('a1', 'admin'), 'rateLimits/x')));
  });
});
