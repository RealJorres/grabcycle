# Setup

This guide covers local development against the Firebase Emulator Suite, then configuring and deploying a real Firebase project. Nothing secret is committed: every environment-specific value lives in an uncommitted file, an environment variable, or Secret Manager.

## 1. Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Node.js | 24 (LTS) | Cloud Functions runtime, tests, dashboard |
| Java | 21 | Firebase emulators (Firestore, Database, Storage) and the Gradle daemon |
| Android Studio | Current stable with Android SDK Platform 37 and Build-Tools | Android app |
| Firebase CLI | Pinned as a dev dependency of `backend/functions` (`npx firebase ...`) | Emulators, deploy |

Network access: Gradle needs `services.gradle.org`, `dl.google.com` (Google Maven) and Maven Central; npm needs `registry.npmjs.org`. The Firebase emulators download their JARs on first run from Google storage.

See [toolchain.md](toolchain.md) for exact versions and why they were chosen.

## 2. Local development with the Emulator Suite

The demo project id `demo-grabcycle` needs no Google credentials, and emulators for a `demo-` project can never reach production resources.

### Backend

```bash
cd backend/functions
npm ci
cp .secret.local.example .secret.local     # MAPS_SERVER_KEY=DISABLED (no Google routing/places)
npm run serve                              # builds, then starts all emulators (UI at http://127.0.0.1:4000)
```

`.env.demo-grabcycle` (committed, no secrets) sets `ENFORCE_APP_CHECK=false`, `DEPLOY_ENV=development` and the local dashboard origins.

Seed the labelled sample configuration and an emulator-only superadmin:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run seed:dev -- --admin admin@example.test
```

The seed writes configuration and sample landmarks only. It creates no passengers, drivers, approvals, locations or rides; you produce those by using the apps and approving submissions in the dashboard. It refuses to run unless the emulator variables are set.

Tests:

```bash
npm run lint && npm run typecheck && npm run test:unit
npm run test:emulator    # starts auth/firestore/database/storage emulators and runs integration + rules tests
```

### Dashboard

```bash
cd admin
npm ci
cp .env.development.example .env.development.local   # demo project, VITE_USE_EMULATORS=true
npm run dev                                          # http://localhost:5173
```

Sign in as `admin@example.test` with the password printed by the seed script. Emulator mode is only honoured in the development server and is shown as a banner in the sidebar.

### Android app against the emulators

1. Create a Firebase **Android app** registration for package `ph.grabcycle.app` in any project (a free test project is fine), download its `google-services.json`, and place it at `android/app/google-services.json`. It is git-ignored. Without it the app compiles but shows a "not configured" screen.
2. Add to `android/local.properties` (git-ignored):

   ```properties
   grabcycle.useEmulators=true
   # 10.0.2.2 is the host machine as seen from the Android emulator. For a USB
   # device use your computer's LAN IP and start emulators with --host 0.0.0.0
   # (only on a trusted network).
   grabcycle.emulatorHost=10.0.2.2
   # Optional: Android-restricted Maps SDK key; without it the map is hidden and
   # pickup is chosen from search/landmarks.
   MAPS_API_KEY=
   ```

3. Build and run the **debug** variant. Emulator switches are compiled into debug builds only; release builds always use the real project. Cleartext HTTP to the emulator host is allowed only by the debug network security configuration.

Phone sign-in against the Auth emulator uses fictional numbers: the verification code appears in the Emulator UI (Auth tab).

## 3. A real Firebase project

Use separate projects for staging and production.

1. **Create the project** on the Blaze plan (Cloud Functions 2nd gen requires it). Choose `asia-southeast1` (Singapore) for Firestore, Realtime Database, Storage and Functions to keep latency low for the Philippines.
2. **Enable products:** Authentication (Phone provider for riders, Email/Password for staff), Cloud Firestore, Realtime Database, Cloud Storage, Cloud Functions, Cloud Messaging, App Check, Hosting.
3. **Register apps:**
   - Android `ph.grabcycle.app` with the SHA-256 of your upload and Play app-signing keys. Download `google-services.json` to `android/app/`.
   - Web app for the dashboard. Its config values go into `admin/.env.production.local` (see `admin/.env.example`). These identifiers are public by design; access is enforced by Auth, rules, custom claims and App Check.
4. **App Check:**
   - Android: Play Integrity (release builds install it automatically; debug builds use the debug provider, so register the debug token from Logcat).
   - Web: reCAPTCHA Enterprise. Put the site key in `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`.
   - Turn on enforcement for Firestore, Realtime Database and Storage in the console once clients are deployed. Cloud Functions enforce it through `ENFORCE_APP_CHECK=true`.
5. **Functions parameters:** copy `backend/functions/.env.example` to `backend/functions/.env.<project-id>` and set `ADMIN_ORIGINS` to the Hosting domains.
6. **Secrets (Secret Manager, never in files):**

   ```bash
   npx firebase functions:secrets:set MAPS_SERVER_KEY --project <project-id>
   ```

   Use a **server** key restricted to the Places API (New), Geocoding API and Routes API, with no application restriction other than API restrictions. Keep it separate from the Android Maps SDK key, which is restricted to the package name and certificate fingerprint.
7. **Deploy rules, indexes, functions, then hosting:**

   ```bash
   cd backend/functions && npm ci && npm run build
   cd ../.. 
   npx --prefix backend/functions firebase deploy --project <project-id> --only firestore,database,storage
   npx --prefix backend/functions firebase deploy --project <project-id> --only functions
   (cd admin && npm ci && npm run build)
   npx --prefix backend/functions firebase deploy --project <project-id> --only hosting
   ```

   Composite indexes can take several minutes to build; queries that need them fail with `FAILED_PRECONDITION` until they are ready.
8. **First superadmin** (out of band, from a trusted workstation with Application Default Credentials of a project Owner):

   ```bash
   gcloud auth application-default login
   cd backend/functions
   npm run provision:admin -- --project <project-id> --email ops@your-domain.ph --role superadmin
   ```

   The temporary password prints once. Sign in to the dashboard and change it immediately ("Forgot password?"). Grant further staff roles from the dashboard's Staff page. Accounts for staff must be created in Firebase Authentication by an operator first; rider and driver accounts can never receive staff roles.
9. **Configure before launch** (dashboard, Configuration): service area (official boundary), document policy (requirements confirmed with LTO and LGUs), fare rules (official LGU-approved fare matrix), matching, policies (terms/privacy versions, retention), payments, app (support contacts, emergency hotline, minimum app version). Sample values are rejected in production.
10. Work through the [production checklist](production-checklist.md).

## 4. Android release build

1. Create `android/keystore.properties` (git-ignored):

   ```properties
   storeFile=/absolute/path/to/upload-keystore.jks
   storePassword=...
   keyAlias=...
   keyPassword=...
   ```

2. Set `MAPS_API_KEY` (Android-restricted) in `local.properties` or the CI secret store.
3. `./gradlew :app:bundleRelease`. R8 minification is enabled; `proguard-rules.pro` keeps the Firestore model classes.
4. Raise `versionCode` for every upload and set `config/app.minAndroidVersionCode` when an old version must be forced to update.
