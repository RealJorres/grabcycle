import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getDatabase, type Database } from 'firebase-admin/database';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { getStorage, type Storage } from 'firebase-admin/storage';

/**
 * Lazily-initialized Admin SDK singletons. In Cloud Functions the default
 * credentials and FIREBASE_CONFIG (projectId, databaseURL, storageBucket) are
 * provided by the runtime; under the Emulator Suite the *_EMULATOR_HOST
 * variables redirect every client to the local emulators.
 */

let app: App | undefined;
let firestore: Firestore | undefined;

export function adminApp(): App {
  if (!app) app = getApps()[0] ?? initializeApp();
  return app;
}

export function db(): Firestore {
  if (!firestore) {
    firestore = getFirestore(adminApp());
    firestore.settings({ ignoreUndefinedProperties: true });
  }
  return firestore;
}

export const rtdb = (): Database => getDatabase(adminApp());
export const auth = (): Auth => getAuth(adminApp());
export const storage = (): Storage => getStorage(adminApp());
export const messaging = (): Messaging => getMessaging(adminApp());
export const bucket = () => storage().bucket();
