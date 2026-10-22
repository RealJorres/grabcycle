# Toolchain and versions

Versions were chosen as the latest stable releases that are compatible with each other, verified on 2026-10-22 against the package registries (`npm view`, Gradle and Maven resolution in CI). Every version is pinned (exact npm versions with lockfiles, a Gradle version catalog, a wrapper with a SHA-256 checksum) so builds are reproducible. Dependabot or Renovate should propose upgrades; re-run every suite before merging.

## Backend (`backend/functions`)

| Component | Version | Notes and source |
|---|---|---|
| Node.js runtime | 24 (LTS) | Cloud Functions 2nd gen runtime `nodejs24` (`firebase.json`). nodejs.org/en/about/previous-releases; firebase.google.com/docs/functions/manage-functions |
| firebase-functions | 7.4.0 | 2nd gen `onCall`/`onSchedule`, params API (`defineString`, `defineSecret`) |
| firebase-admin | 14.5.0 | |
| firebase-tools (CLI, emulators) | 15.34.1 | Pinned dev dependency; run with `npx firebase` |
| TypeScript | 6.0.3 | **Not 7.x:** typescript-eslint 8.72 declares `typescript >=4.8.4 <6.1.0`. Move to 7.x when the lint toolchain supports it |
| zod | 4.6.7 | Strict input schemas |
| geofire-common | 6.0.0 | Geohash encoding and query bounds |
| vitest | 5.0.5 | Unit, integration and rules projects |
| @firebase/rules-unit-testing | 6.0.0 | Security-rules tests |
| ESLint / typescript-eslint | 10.13.0 / 8.72.0 | |

## Android (`android/`)

| Component | Version | Notes and source |
|---|---|---|
| Gradle wrapper | 9.6.0 (SHA-256 pinned) | gradle.org/releases |
| Android Gradle Plugin | 9.4.0 | developer.android.com/build/releases/gradle-plugin. AGP 9 compiles Kotlin by default; the project is Java-only, so `enableKotlin = false` |
| compileSdk / targetSdk / minSdk | 37 / 36 / 26 | targetSdk 36 meets the current Google Play target-API requirement (developer.android.com/google/play/requirements/target-sdk). minSdk 26 (Android 8.0) covers older phones common in the region while allowing `java.time` without desugaring |
| Java language level | 17 | CI runs JDK 21 |
| Firebase Android BoM | 35.0.2 | Auth, Firestore, Database, Storage, Functions, Messaging, App Check (Play Integrity and debug). firebase.google.com/support/release-notes/android |
| Google services plugin | 4.5.0 | Applied only when `google-services.json` exists |
| Play services Maps / Location | 20.1.0 / 21.4.0 | |
| AndroidX | appcompat 1.8.0, activity 1.13.0, fragment 1.9.1, lifecycle 2.11.0, core 1.19.1, recyclerview 1.4.0, constraintlayout 2.2.2, coordinatorlayout 1.3.0, exifinterface 1.4.2 | |
| Material Components | 1.14.0 | Material 3 theme |
| Tests | JUnit 6 (Jupiter, BOM 6.1.3) for `:core`; JUnit 4.13.2 for app JVM tests; AndroidX Test 1.7.0 and Espresso 3.7.0 for future instrumented tests | |

### Deprecation notes

- **FCM token registration:** `FirebaseMessaging.getToken()` is deprecated in recent firebase-messaging releases in favour of Firebase Installations-based registration. It still works and is used, with a documented suppression in `UserRepository.registerDevice`, because the backend currently targets devices by token. Migrate the backend and app together.
- The Android build compiles with `-Xlint:deprecation` and `-Xlint:unchecked`, so CI logs list any other deprecated API use.

## Dashboard (`admin/`)

| Component | Version | Notes |
|---|---|---|
| React / React DOM | 19.3.1 | |
| React Router | 8.5.0 | Declarative routes (`BrowserRouter`, `Routes`) |
| Vite | 8.3.5 | Rolldown-based; `build.rolldownOptions.output.codeSplitting` splits Firebase and React into cacheable chunks |
| @vitejs/plugin-react | 6.1.2 | |
| Tailwind CSS (+ @tailwindcss/vite) | 4.3.3 | CSS-first configuration (`@theme` in `src/index.css`) |
| Firebase JS SDK | 13.1.0 | Same major as the backend test tooling |
| TypeScript | 6.0.3 | Same constraint as the backend |
| Vitest / jsdom / Testing Library | 5.0.5 / 30.1.3 / React 16.3.3, DOM 10.4.1, user-event 14.6.8, jest-dom 7.0.1 | |
| ESLint | 10.13.0 (+ react-hooks 7.1.1, react-refresh 0.5.7) | |

## CI (`.github/workflows/ci.yml`)

GitHub Actions on `ubuntu-latest`: `actions/checkout@v7`, `actions/setup-node@v7` (Node 24), `actions/setup-java@v6` (Temurin 21), `gradle/actions/setup-gradle@v6` with wrapper validation, `actions/upload-artifact@v7`. Three jobs: backend (lint, typecheck, build, unit, emulator integration and rules tests), admin (lint, typecheck, tests, build), Android (core tests, app JVM tests, lint, debug build).

## Install-script policy

npm warns that `protobufjs` and `@firebase/util` have postinstall scripts that are not on an allow-list. They are not needed for these builds (the Firebase defaults auto-config and protobuf code generation are unused), and CI runs without them.
