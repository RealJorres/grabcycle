# GrabCycle

Tricycle ride-hailing for Marinduque, Philippines. The system has three parts:

| Part | Stack | Folder |
|---|---|---|
| Mobile app (passenger and driver in one app) | Native Android, **Java + XML** (no Kotlin), View Binding, ViewModel/LiveData | `android/` |
| Backend | Firebase: Auth, Cloud Firestore, Realtime Database (live locations), Cloud Storage (private documents), Cloud Functions 2nd gen (TypeScript, Node 24), FCM, App Check | `backend/` |
| Operations dashboard (staff only) | React 19, Vite 8, TypeScript 6, Tailwind CSS 4, Firebase Hosting | `admin/` |

The backend decides everything that matters: who may book, who may drive, who gets a ride, what it costs, and how payments and reviews change. The apps only request changes. Clients never write to Firestore directly.

## What it does

- **Passengers** sign in with their phone number and submit a government ID. **They cannot book until a human reviewer approves it.** After that they set a pickup and a destination, get a server-computed fare quote, see nearby available drivers, and book a chosen driver or automatic matching. They can follow the driver live, call or text through the app, use the emergency menu, pay cash, rate the driver, and file support reports.
- **Drivers** register, add their tricycle, and upload accreditation documents (license, OR/CR, franchise, photos, and so on, as defined by the configurable document policy). **They cannot go online until every mandatory document and the vehicle are approved.** Online drivers share location in a visible foreground service, receive time-limited offers, run the trip step by step, and record the cash received against the server's final fare.
- **Staff** use the dashboard to review IDs and accreditation (each document view is audited and watermarked), manage users, rides, payments, support cases, privacy requests (export, deletion with anonymisation), configuration (service area, fares, matching, policies) and staff roles.

## Repository layout

```
android/            Gradle project: :core (pure Java domain rules + tests), :app (the app)
backend/functions/  Cloud Functions source, tests, seed/provisioning scripts
backend/rules/      Firestore, Realtime Database and Storage security rules + indexes
admin/              Operations dashboard
docs/               Design, operations and compliance documentation
firebase.json       Emulator, Hosting (CSP/HSTS headers) and deploy configuration
.github/workflows/  CI: backend, admin dashboard, Android
```

## Quick start (local, no real project needed)

Prerequisites: Node 24, Java 21 (Firebase emulators; Android uses JDK 17+), Android Studio with SDK 37 for the app.

```bash
# Backend: install, run all tests against the Emulator Suite
cd backend/functions
npm ci
npm run lint && npm run typecheck && npm run test:unit
npm run test:emulator          # integration + security-rules tests

# Start all emulators (functions included) for the demo project
npm run serve

# In another terminal: write the labelled SAMPLE configuration and an
# emulator-only superadmin for the dashboard
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run seed:dev -- --admin admin@example.test

# Dashboard against the emulators
cd ../../admin
cp .env.development.example .env.development.local
npm ci && npm run dev
```

Full setup, including a real Firebase project, the Android build, Maps keys and the first superadmin, is in [docs/setup.md](docs/setup.md).

## Tests

| Suite | Command | What it covers |
|---|---|---|
| Backend unit | `npm run test:unit` (backend/functions) | State machines, fare engine, geohash matching, accreditation rules |
| Backend integration | `npm run test:emulator` | Verification, accreditation, discovery, ride lifecycle, payments, **concurrency** (no double booking, idempotent requests) |
| Security rules | included in `test:emulator` | Firestore, Realtime Database and Storage rules |
| Android core | `./gradlew :core:test` | Status rules, money/phone/date parsing, geo math, notification de-duplication |
| Android app (JVM) | `./gradlew :app:testDebugUnitTest` | Contract tests for callable response parsing |
| Android lint/build | `./gradlew :app:lintDebug :app:assembleDebug` | |
| Dashboard | `npm test` (admin) | Contract tests against backend permissions and payment rules, route protection, review forms, formatting |

CI runs all of these on every push (`.github/workflows/ci.yml`). Android instrumented/UI tests are not yet written, and nothing has been tested on a physical device. See [Status and limitations](#status-and-limitations).

## Documentation

- [Setup](docs/setup.md): local development, real project configuration, deployment
- [Toolchain and versions](docs/toolchain.md): every version, why it was chosen, and its source
- [Architecture and security model](docs/security-model.md)
- [Data dictionary](docs/data-dictionary.md)
- [Booking state machine](docs/booking-state-machine.md) (also covers verification, accreditation and payment states)
- [Ride assignment invariants](docs/ride-assignment-invariants.md)
- [Privacy and retention](docs/privacy-and-retention.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Production checklist](docs/production-checklist.md)

## Status and limitations

Read this before relying on the system.

- **Sample configuration is not official.** The service-area polygon, the document requirements and the fare table produced by `seed:dev` are development samples, flagged `isSample: true`. The backend refuses to activate sample fares or save sample configuration in production. The operator must obtain the official fare matrix, franchise and accreditation requirements from the LGUs and LTO.
- **Not yet verified against real services:** Google Maps (Places, Geocoding, Routes) with a real key, phone authentication with real SMS, FCM delivery to devices, App Check (Play Integrity and reCAPTCHA Enterprise), and deployment to a real Firebase project. Code paths exist and degrade explicitly (for example, straight-line fare estimates are labelled as such), but they have only run against emulators and mocks.
- **The Android app is built and unit-tested in CI**, but its UI has not been exercised on a device or emulator, and instrumented tests have not been written.
- **The emergency feature does not contact emergency services.** It opens the dialer for the configured hotline, lets the passenger text their own emergency contact, and files an urgent support report. The UI states this.
- **Payments are cash only**, behind a provider abstraction. No online payment provider is integrated.
- Legal texts in `android/app/src/main/res/raw/` are drafts that need review by counsel for the Data Privacy Act of 2012 and local ordinances.
