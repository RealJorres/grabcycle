import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { browserSessionPersistence, connectAuthEmulator, getAuth, setPersistence, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import { readEnv } from './env';

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  functions: Functions;
  projectId: string;
  emulators: boolean;
}

let services: FirebaseServices | null = null;
let configError: string[] | null = null;

/**
 * Lazily initialises Firebase. Returns null (with the missing variable names
 * available from {@link firebaseConfigError}) when the build has no config,
 * so the UI can explain instead of crashing.
 */
export function firebase(): FirebaseServices | null {
  if (services || configError) return services;
  const { env, missing } = readEnv(import.meta.env as Record<string, string | boolean | undefined>);
  if (!env) {
    configError = missing;
    return null;
  }
  const app = initializeApp(env.firebase);
  const emulators = env.useEmulators && import.meta.env.DEV;
  if (env.recaptchaSiteKey && !emulators) {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(env.recaptchaSiteKey), isTokenAutoRefreshEnabled: true });
  }
  const auth = getAuth(app);
  // Staff sessions end when the browser tab closes; shared workstations are common.
  void setPersistence(auth, browserSessionPersistence);
  const db = getFirestore(app);
  const functions = getFunctions(app, env.functionsRegion);
  if (emulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  }
  services = { app, auth, db, functions, projectId: env.firebase.projectId, emulators };
  return services;
}

export function firebaseConfigError(): string[] | null {
  firebase();
  return configError;
}

/** Throws when Firebase is not configured; for use after the app shell has checked. */
export function requireFirebase(): FirebaseServices {
  const s = firebase();
  if (!s) throw new Error('Firebase is not configured');
  return s;
}
