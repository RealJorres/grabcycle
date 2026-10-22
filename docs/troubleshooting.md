# Troubleshooting

Every backend rejection carries a stable `details.reason` (see `backend/functions/src/domain/errors.ts`). The apps map reasons to user-facing text; staff can match them to the cause below.

## Passengers

| Symptom / reason | Likely cause | What to do |
|---|---|---|
| "Verify your ID to book" / `PASSENGER_NOT_VERIFIED` | Verification not approved, or the approval lapsed (`validUntil` passed) | Check the user page in the dashboard. A lapsed approval shows as *Your verification has expired*; the passenger submits a current ID |
| `VERIFICATION_ALREADY_PENDING` | A case is already SUBMITTED or UNDER_REVIEW | Wait for the reviewer; staff can find it in Passenger IDs |
| `DOCUMENT_EXPIRED` on submission | The typed expiry date is before today (Manila time) | Use a valid ID |
| "No drivers available" / `NO_DRIVERS_AVAILABLE` | No eligible driver with a **fresh** location within 5 km | Check Overview → Drivers online. Drivers whose phones lost signal for more than 30 s are not matchable |
| `DRIVER_UNAVAILABLE` | The chosen driver went offline, took another ride, or lost location freshness | Choose another driver or book the nearest |
| `QUOTE_EXPIRED` / `QUOTE_MISMATCH` | Quotes live 10 minutes and belong to one passenger | The app re-quotes automatically; the passenger confirms the new price |
| `OUTSIDE_SERVICE_AREA` | Pickup or destination outside `config/serviceArea` polygons | Check the polygon; offshore islands need their own polygons |
| `SERVICE_CLOSED` | Operating hours enabled and the current Manila time is outside them | `config/serviceArea.operatingHours` |
| Fare says "estimate" | Routes API unavailable or `MAPS_SERVER_KEY` not configured; straight-line distance used | Configure the server key (Secret Manager) and enable the Routes API |
| Driver location "not updated since …" | The driver's phone is offline or has a weak GPS signal | Wait; the passenger can call the driver. Support sees the same freshness |

## Drivers

| Symptom / reason | Likely cause | What to do |
|---|---|---|
| `DRIVER_NOT_ELIGIBLE` with reasons | Listed in `details.reasons`: `DOCUMENT_MISSING:<code>`, `DOCUMENT_EXPIRED:<code>`, `VEHICLE_NOT_APPROVED`, `DRIVER_NOT_APPROVED`, `DRIVER_SUSPENDED`, `ACCOUNT_NOT_ACTIVE` | The app lists each item; renew or resubmit the named document |
| `LOCATION_REQUIRED` | No location fix, accuracy above 100 m, or a mock-location app is active | Turn on precise location, move outdoors, uninstall location-spoofing apps |
| Goes offline by itself | No fresh location for 10 minutes (`sweepDriversJob`), 3 ignored offers in a row, or eligibility lost (a document expired) | Check the notification; go online again when ready |
| Location writes rejected (`PERMISSION_DENIED` in Logcat) | The presence session ended (offline, suspended, new session on another device) or the write was queued offline for more than 60 s | The app stops sharing; go online again |
| `TOO_FAR_FROM_PICKUP` on "I've arrived" | The live location is more than 500 m from the pickup | Move closer or wait for a better fix |
| `DRIVER_HAS_ACTIVE_TRIP` when going offline | Trips must be completed or cancelled first | Finish the trip |
| Cash shortfall shows PENDING | Amount entered was below the final fare (tolerance 0 by default) | Support resolves it under Rides → Payments needing attention |

## Staff dashboard

| Symptom | Cause | Fix |
|---|---|---|
| "Dashboard not configured" | The build had no `VITE_FIREBASE_*` variables | Set them (see `admin/.env.example`) and rebuild |
| "No staff access" after sign-in | The account has no `staffRole` claim, or it was just changed | A superadmin grants a role; sign in again so the token refreshes |
| Lists show "Missing or insufficient permissions" | The role cannot read that collection (for example, support cannot read verification cases), or the Firestore rules were not deployed | Check the role. Deploy rules with `firebase deploy --only firestore` |
| Every admin action fails with `internal`; the browser console shows a CORS error | `ADMIN_ORIGINS` is not a JSON array, so the functions runtime cannot parse it and disables CORS for admin functions; or the dashboard runs on an origin that is not listed | Write it as `ADMIN_ORIGINS=["https://…","https://…"]` in `backend/functions/.env.<project>` and restart the emulator or redeploy. The local emulator allows any origin once the value parses; deployed functions enforce the list |
| Query error "requires an index" | Indexes not deployed or still building | `firebase deploy --only firestore:indexes`; wait for the build in the console |
| "Your role does not allow this action" | The callable rejected the permission (server-side matrix) | Expected for that role |
| Cannot decide a case | Another reviewer claimed it, or it is your own account | Ask the claimant or an admin |
| Config save fails with field errors | Server-side schema validation; sample flags are refused in production | Fix the listed paths |

## Development environment

| Problem | Fix |
|---|---|
| `npm run test:emulator` fails with a connection error to localhost | Something intercepts loopback traffic (for example, a corporate proxy without `NO_PROXY=localhost,127.0.0.1`). Exclude loopback from the proxy |
| Emulators fail to start: Java not found | Install Java 21 and put it on `PATH` |
| Android build: "google-services.json is missing" warning | Expected without Firebase config. The app compiles but shows a configuration screen at runtime. See setup.md |
| Gradle cannot download AGP or Google libraries | `dl.google.com` (Google Maven) or `services.gradle.org` is blocked; allow them |
| Android app cannot reach emulators | Use `10.0.2.2` from the Android emulator; for a USB device use the host LAN IP and start emulators with `--host 0.0.0.0` on a trusted network. Emulator mode works only in debug builds |
| Phone sign-in code never arrives in the emulator | It is shown in the Emulator UI (Auth), not sent by SMS |
| App Check errors on a debug build against a real project | Register the debug token printed in Logcat (Firebase console → App Check → Manage debug tokens) |
