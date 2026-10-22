/**
 * Build-time configuration from VITE_* variables. The Firebase web config is
 * public by design (access is enforced by Auth, security rules, custom claims
 * and App Check), but it is still supplied per environment, never hardcoded.
 */
export interface AppEnv {
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId: string;
    storageBucket?: string;
    databaseURL?: string;
  };
  functionsRegion: string;
  recaptchaSiteKey: string | null;
  useEmulators: boolean;
}

type RawEnv = Record<string, string | boolean | undefined>;

export function readEnv(raw: RawEnv): { env: AppEnv | null; missing: string[] } {
  const str = (k: string) => {
    const v = raw[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };
  const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'];
  const missing = required.filter((k) => !str(k));
  if (missing.length) return { env: null, missing };
  return {
    env: {
      firebase: {
        apiKey: str('VITE_FIREBASE_API_KEY')!,
        authDomain: str('VITE_FIREBASE_AUTH_DOMAIN')!,
        projectId: str('VITE_FIREBASE_PROJECT_ID')!,
        appId: str('VITE_FIREBASE_APP_ID')!,
        storageBucket: str('VITE_FIREBASE_STORAGE_BUCKET'),
        databaseURL: str('VITE_FIREBASE_DATABASE_URL'),
      },
      functionsRegion: str('VITE_FUNCTIONS_REGION') ?? 'asia-southeast1',
      recaptchaSiteKey: str('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY') ?? null,
      useEmulators: str('VITE_USE_EMULATORS') === 'true',
    },
    missing: [],
  };
}
