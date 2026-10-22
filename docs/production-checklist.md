# Production checklist

Work through this before real passengers and drivers use the system. Items marked **[blocker]** must be done; the rest are strongly recommended.

## Legal, regulatory and business

- [ ] **[blocker]** Official fare matrix obtained from the LGUs (per municipality or route, night and special-trip rules) and entered as a new fare version with `isSample: false`. The sample fares must never be activated.
- [ ] **[blocker]** Driver accreditation requirements confirmed with LTO and the LGUs (license type and restriction codes, OR/CR, franchise/MTOP, clearances, any LGU-issued body-number permit) and entered in `config/documentPolicy` with `isSample: false`.
- [ ] **[blocker]** Accepted passenger ID types and approval validity confirmed.
- [ ] **[blocker]** Privacy notice and terms of service reviewed by counsel (Data Privacy Act of 2012 and NPC rules); version strings updated in `config/policies.terms` **and** `AppConfig.TERMS_VERSION` / `PRIVACY_NOTICE_VERSION` in the app.
- [ ] **[blocker]** Retention periods in `config/policies.retention` approved by counsel; a policy decided for approved ID images (not deleted automatically today).
- [ ] **[blocker]** Data-subject request procedure written (deadlines, identity checks, secure export delivery); counsel confirms which fields the deletion tool anonymises versus retains (see [privacy-and-retention.md](privacy-and-retention.md)).
- [ ] NPC registration requirements, Data Protection Officer appointment, and breach-notification runbook.
- [ ] Cancellation-fee policy decided and disclosed before enabling `passengerFeeEnabled`.
- [ ] Emergency hotline number confirmed for Marinduque (`config/app.emergencyHotline`; the app's fallback is 911) and support phone and email published.
- [ ] Discount entitlements (senior citizen, PWD, student) confirmed against applicable laws and ordinances, then enabled in the fare version.

## Configuration

- [ ] **[blocker]** `config/serviceArea`: authoritative boundary polygons (including served islands), municipalities, operating hours, `isSample: false`. Saving it recomputes the RTDB location bounds.
- [ ] `config/matching` reviewed with real-world testing (radii, offer timeout, freshness, accuracy).
- [ ] `config/payments.cashDiscrepancyTolerance` set.
- [ ] Landmarks entered (curated, verified coordinates) and sample landmarks deactivated.
- [ ] `config/app.minAndroidVersionCode` set for the release.

## Firebase and Google Cloud

- [ ] **[blocker]** Separate staging and production projects; Blaze plan; budgets and billing alerts configured.
- [ ] **[blocker]** Resources in `asia-southeast1`; `FUNCTIONS_REGION` matches the Android `grabcycle.functionsRegion` and the dashboard `VITE_FUNCTIONS_REGION`.
- [ ] **[blocker]** Security rules and indexes deployed (`firestore`, `database`, `storage`); index builds finished.
- [ ] **[blocker]** `backend/functions/.env.<project>` with `ENFORCE_APP_CHECK=true`, `DEPLOY_ENV=production`, and the real `ADMIN_ORIGINS`.
- [ ] **[blocker]** App Check: Play Integrity registered for the release signing certificate; reCAPTCHA Enterprise for the dashboard; enforcement enabled for Firestore, Realtime Database and Storage after clients ship.
- [ ] **[blocker]** `MAPS_SERVER_KEY` in Secret Manager, restricted to the Routes, Places (New) and Geocoding APIs. Android Maps key restricted to the package and SHA-256.
- [ ] Phone Auth: SMS region policy limited to the Philippines; abuse protection enabled; quotas reviewed.
- [ ] Staff email/password policy (length, no reuse); **MFA for staff** via Identity Platform. The dashboard does not support the MFA sign-in flow yet; add it before enforcing.
- [ ] Firestore TTL policies active for `fareQuotes.expiresAt` and `rateLimits.expiresAt`.
- [ ] Storage lifecycle rule deleting `uploads/` objects older than 2 days (backstop for the staging cleanup job).
- [ ] Point-in-time recovery and scheduled exports (backups) for Firestore; tested restore.
- [ ] Cloud Logging alerts: function error rate, `callable.unhandled`, scheduled job failures, `DOCUMENT_VIEWED` spikes, rate-limit spikes.
- [ ] `minInstances` for latency-critical callables (`createRide`, `respondToOffer`, `getFareQuote`) if cold starts are noticeable; check cost.

## People and access

- [ ] **[blocker]** First superadmin provisioned out of band (`npm run provision:admin`); temporary password changed.
- [ ] Least-privilege roles assigned (reviewers for reviews, support for cases); quarterly access review.
- [ ] Reviewer training: checklist meaning, fraud indicators, messaging tone, never sharing documents outside the dashboard.

## Android release

- [ ] **[blocker]** Upload keystore created and backed up; Play App Signing enabled; SHA-256 fingerprints registered in Firebase and the Maps key.
- [ ] **[blocker]** Release build tested on real devices: low-end Android 8 to 9 phones, a current Android version, poor connectivity, permission denial paths, background/foreground transitions while online as a driver, the camera capture flow, notifications.
- [ ] **[blocker]** Instrumented UI tests for booking, offer acceptance, trip progression and verification (not written yet).
- [ ] Play Console: data safety form (location, phone number, photos and IDs, purposes), foreground service declaration (type `location`, justification: active driver sharing location for matching), content rating.
- [ ] Crash reporting chosen and configured (none is integrated; Firebase Crashlytics would add a dependency and must appear in the data safety form).
- [ ] Translations reviewed (English strings exist; Filipino localisation not yet provided).

## Dashboard

- [ ] Built with production `VITE_*` values and deployed to Hosting; CSP verified in the browser console (no violations).
- [ ] Custom domain with HTTPS; `ADMIN_ORIGINS` updated.

## Operational readiness

- [ ] Support hours and escalation path for safety reports (URGENT cases).
- [ ] Driver onboarding sessions and printed requirements list.
- [ ] Pilot in one municipality with a small driver group; monitor matching success rate, offer timeouts, location freshness, cancellations and payment discrepancies before expanding.
- [ ] Incident runbook: how to suspend a driver, cancel or complete a stuck ride, and contact participants.
