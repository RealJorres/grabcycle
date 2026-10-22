/**
 * DEVELOPMENT SEED — EMULATOR ONLY. Run from backend/functions: `npm run seed:dev`.
 *
 * Writes the clearly labelled SAMPLE configuration (service area, document
 * policy, operational defaults, sample fares) and a few sample landmarks so
 * the apps can be exercised locally. It creates NO users, drivers, approvals,
 * locations or rides: those must be produced by actually using the apps
 * (and approving submissions in the admin dashboard).
 *
 * Refuses to run unless FIRESTORE_EMULATOR_HOST is set.
 *
 *   firebase emulators:start --project demo-grabcycle
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 \
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run seed:dev -- --admin admin@example.test
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import {
  DEFAULT_APP,
  DEFAULT_MATCHING,
  DEFAULT_PAYMENTS,
  DEFAULT_POLICIES,
  SAMPLE_DOCUMENT_POLICY,
  SAMPLE_FARE_CONFIG,
  SAMPLE_SERVICE_AREA,
} from '../src/domain/defaults';
import { boundsOf } from '../src/domain/geo';

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-grabcycle';

/** Approximate municipal town proper locations — SAMPLE data for local testing only. */
const SAMPLE_LANDMARKS = [
  { name: 'Boac town proper (sample)', municipality: 'Boac', lat: 13.4467, lng: 121.8406 },
  { name: 'Mogpog town proper (sample)', municipality: 'Mogpog', lat: 13.475, lng: 121.8617 },
  { name: 'Gasan town proper (sample)', municipality: 'Gasan', lat: 13.3236, lng: 121.8467 },
  { name: 'Buenavista town proper (sample)', municipality: 'Buenavista', lat: 13.2564, lng: 121.9439 },
  { name: 'Torrijos town proper (sample)', municipality: 'Torrijos', lat: 13.3189, lng: 122.0839 },
  { name: 'Santa Cruz town proper (sample)', municipality: 'Santa Cruz', lat: 13.4775, lng: 122.0294 },
];

async function main(): Promise<void> {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
    console.error('Refusing to seed: set FIRESTORE_EMULATOR_HOST and FIREBASE_DATABASE_EMULATOR_HOST (emulator only).');
    process.exit(1);
  }
  initializeApp({ projectId, databaseURL: `https://${projectId}-default-rtdb.firebaseio.com` });
  const db = getFirestore();
  const meta = { revision: 1, updatedBy: 'seed-dev', updatedAt: new Date() };

  const batch = db.batch();
  batch.set(db.doc('config/serviceArea'), { ...SAMPLE_SERVICE_AREA, meta });
  batch.set(db.doc('config/documentPolicy'), { ...SAMPLE_DOCUMENT_POLICY, meta });
  batch.set(db.doc('config/matching'), { ...DEFAULT_MATCHING, meta });
  batch.set(db.doc('config/policies'), { ...DEFAULT_POLICIES, meta });
  batch.set(db.doc('config/payments'), { ...DEFAULT_PAYMENTS, meta });
  batch.set(db.doc('config/app'), { ...DEFAULT_APP, meta });
  batch.set(db.doc('fareConfigs/sample-v1'), { ...SAMPLE_FARE_CONFIG, version: 'sample-v1', createdBy: 'seed-dev', createdAt: new Date() });
  batch.set(db.doc('config/fare'), { activeVersion: 'sample-v1' });
  for (const [i, l] of SAMPLE_LANDMARKS.entries()) {
    batch.set(db.doc(`landmarks/sample-${i}`), { ...l, barangay: null, keywords: [], active: true, isSample: true });
  }
  await batch.commit();

  await getDatabase()
    .ref('config/bounds')
    .set(boundsOf(SAMPLE_SERVICE_AREA.polygons.map((p) => p.points), SAMPLE_SERVICE_AREA.boundsMarginDeg));

  const adminIdx = process.argv.indexOf('--admin');
  if (adminIdx >= 0) {
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Set FIREBASE_AUTH_EMULATOR_HOST to create an emulator admin.');
    const email = process.argv[adminIdx + 1]!;
    const auth = getAuth();
    const user = (await auth.getUserByEmail(email).catch(() => null)) ?? (await auth.createUser({ email, password: 'emulator-only-password' }));
    await auth.setCustomUserClaims(user.uid, { staffRole: 'superadmin' });
    await db.doc(`staff/${user.uid}`).set({ uid: user.uid, email, role: 'superadmin', active: true });
    console.log(`Emulator superadmin: ${email} / emulator-only-password`);
  }
  console.log('Seeded SAMPLE configuration into the emulator. Replace every sample value before any real deployment.');
}

// The Admin SDK keeps database connections open; exit explicitly when done.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
