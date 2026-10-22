/**
 * Integration tests run against the Firebase Emulator Suite
 * (`npm run test:emulator`). They exercise the real services and the Admin
 * SDK with emulated Firestore, Realtime Database, Storage and Auth.
 */
const projectId = process.env.GCLOUD_PROJECT ?? 'demo-grabcycle';
process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId,
  databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
  storageBucket: `${projectId}.appspot.com`,
});

for (const v of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!process.env[v]) {
    throw new Error(`${v} is not set. Run integration tests with "npm run test:emulator".`);
  }
}
