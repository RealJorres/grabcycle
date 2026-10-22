# Architecture and security model

## Architecture at a glance

```
 Android app (Java/XML)                 Operations dashboard (React)
  passenger + driver                     staff only, Firebase Hosting
        │  Firebase SDKs + App Check (Play Integrity / reCAPTCHA Enterprise)
        ▼
 ┌──────────────── Firebase (asia-southeast1) ────────────────────────────┐
 │ Auth: phone (riders), email/password + staffRole claim (staff)         │
 │ Cloud Functions 2nd gen, Node 24: 47 callables + 5 scheduled jobs      │
 │   ── the only writer of Firestore, presence and private files ──       │
 │ Cloud Firestore: accounts, drivers, rides, payments, config, audit     │
 │ Realtime Database: presence/{uid}, locations/{uid} (live GPS, geohash) │
 │ Cloud Storage: uploads/{uid}/… (staging) → private/… (never readable)  │
 │ FCM: push for offers, ride updates, review outcomes                    │
 │ Secret Manager: MAPS_SERVER_KEY (Routes, Places, Geocoding)            │
 └────────────────────────────────────────────────────────────────────────┘
```

**Design rule: clients request, the backend decides.** Apps read their own data through listeners and call functions to change anything. Firestore rules deny every client write. The only client-writable data are a driver's own live location (RTDB, under strict rules) and a user's own staging uploads (Storage, create-only).

## Identities and roles

| Identity | How it is created | What it can do |
|---|---|---|
| Passenger | Phone sign-in, then `completeRegistration` (accepts the current terms and privacy-notice versions) | Book only after ID approval; read own records |
| Driver | Phone sign-in, then `completeRegistration` as DRIVER | Go online only when accredited; read own records and offered or assigned rides |
| Staff | Email/password account created by an operator; `staffRole` custom claim set by `provision-admin.ts` (first superadmin) or `adminSetStaffRole` (superadmin only) | Per-role permissions below |

The account type is chosen once and cannot change. Staff identities cannot also be riders (`setStaffRole` refuses accounts that have a `users/{uid}` profile), and nobody can act on their own account (reviews, status changes, role changes).

### Staff permissions (`backend/functions/src/lib/permissions.ts`)

| Permission | reviewer | support | admin | superadmin |
|---|:-:|:-:|:-:|:-:|
| review.read / review.decide | ✓ | | ✓ | ✓ |
| documents.view (identity and accreditation images) | ✓ | | ✓ | ✓ |
| users.read | ✓ | ✓ | ✓ | ✓ |
| users.suspend | | | ✓ | ✓ |
| rides.read, support.manage, reports.read | | ✓ | ✓ | ✓ |
| rides.intervene, payments.manage, config.manage, audit.read, privacy.manage | | | ✓ | ✓ |
| staff.manage | | | | ✓ |

Every callable checks the permission server-side. Firestore rules apply the same role split to direct reads (for example, support staff cannot read verification cases or document metadata). The dashboard hides controls a role cannot use; a contract test fails the build if its copy of the matrix drifts from the backend. Role changes revoke the person's refresh tokens so they take effect at once.

## Enforcement layers

1. **Authentication** on every callable (`UNAUTHENTICATED` otherwise). Caller identity comes only from the verified ID token, never from the payload.
2. **App Check.** `ENFORCE_APP_CHECK=true` in production makes Functions reject calls without a valid token. Enable enforcement for Firestore, RTDB and Storage in the console as well.
3. **Input validation.** Strict zod schemas (`z.strictObject`) reject unknown fields, enforce lengths, enums, ranges, phone and date formats, and ID patterns.
4. **Business rules** in transactions: state machines, the verification gate, accreditation eligibility, quote ownership and expiry, one active ride, the arrival-distance check, payment transitions.
5. **Rate limits** per user (Firestore fixed windows, checked before expensive work). Examples: 10 ride creations per 10 min, 60 quotes per 10 min, 10 ID submissions per day, 3 data requests per day, 600 document views per hour per staff member.
6. **Security rules**, deny by default:
   - *Firestore:* owner, participant and role-scoped reads only; ride contact numbers only during active trips; offers readable only by the offered driver; audit logs by category; `staff/` superadmin-only; no client writes anywhere.
   - *Realtime Database:* drivers write only their own location, only while the backend-issued presence session is active, only with the matching session id, inside the service bounds, with plausible movement (≤ ~0.001° plus ~0.0000004° per ms, about 160 km/h), at most every 2 s, `ts` = server time, and a capture time within ±60 s (queued offline writes are rejected). Passengers read a location only while that driver serves their ride.
   - *Storage:* users may only **create** JPEGs of 1 KB to 6 MB under `uploads/{their uid}/{uploadId}`, never overwrite, and only while their account is active. `private/**` is closed to all clients.
7. **Least-privilege secrets.** The only server secret is `MAPS_SERVER_KEY` in Secret Manager. The Android Maps key is restricted to the package name and signing certificate. No service-account keys exist in the repository or the apps.

## Document pipeline (identity and accreditation)

```
App ──JPEG (EXIF stripped, re-encoded on device)──▶ uploads/{uid}/{uploadId}   (staging, create-only)
     submitPassengerVerification / submitDriverDocument(uploadIds)
Function: verify owner, content type, size, JPEG magic bytes ──copy──▶ private/{identity|accreditation}/…
          record path + SHA-256 on the case/document, delete staging object
Staff ──adminGetDocumentFile (documents.view, rate-limited, AUDITED)──▶ bytes in memory, watermarked view
```

- Clients never receive a storage URL for private files. There are no download tokens and no signed URLs.
- Rejected and superseded files are queued for deletion after `retention.rejectedDocumentsDays`. Stale staging uploads are removed after `stagingUploadsHours` (`maintenanceJob`).
- Approved driver profile photos are copied to `public/driverPhotos/…`, which any signed-in user can read, so passengers can recognise their driver.

## Privacy by design

- Discovery returns only coarsened driver positions and no plate numbers. Plate, body number and photo are revealed after acceptance.
- Contact numbers exist only for the duration of an active ride.
- Staff lists mask phone numbers. The dashboard shows full numbers for active rides only on explicit request.
- Logs are structured and redact keys matching token, password, secret, phone, path, document or ID numbers, license, authorization and email.
- See [privacy-and-retention.md](privacy-and-retention.md).

## Audit trail

`auditLogs` is append-only (server writes only) with `category` (REVIEW, SUPPORT, SECURITY, OPERATIONS, CONFIG, PAYMENT), actor, role, target, reason and non-sensitive details. Audited actions include every review decision, document view, suspension, role change, configuration or fare change, ride intervention, payment resolution, driver online and offline, and privacy request, export and deletion.

## Web dashboard hardening

- Hosted with CSP (`default-src 'self'`, Firebase endpoints only), HSTS, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and a restrictive `Permissions-Policy` (`firebase.json`).
- Callable CORS is limited to `ADMIN_ORIGINS` for admin functions.
- Session persistence is browser-session only. Generic sign-in errors avoid account enumeration. Raw HTML rendering is banned by lint.
- Recommended before launch: enable multi-factor authentication for staff (Identity Platform). The dashboard does not support the MFA sign-in flow yet and tells the user so.

## Known gaps and residual risks

- App Check, phone auth abuse protection (SMS region policy, reCAPTCHA for phone auth) and FCM delivery have not been exercised against a real project.
- Mock-location detection relies on the Android `isMock` flag and plausibility rules. Rooted devices can defeat both; the residual risk is a driver falsifying their own position, mitigated by the arrival-distance check and passenger reports.
- `supportCases.assignedTo` (a staff uid) is visible to the reporter. It is not sensitive, but it could be removed from the reporter-readable document.
- Staff MFA is not enforced by code.
