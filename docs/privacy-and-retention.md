# Privacy and retention

> This document describes what the software does. It is not legal advice. Before launch, the operator must have counsel review it, together with the privacy notice and terms in `android/app/src/main/res/raw/` (both marked DRAFT), for compliance with the **Data Privacy Act of 2012 (RA 10173)**, its implementing rules, and National Privacy Commission issuances, including registration and breach-notification requirements.

## Personal data processed

| Data | Whose | Purpose | Where | Who can see it |
|---|---|---|---|---|
| Mobile number | All riders | Sign-in, trip contact | Firebase Auth; `users/{uid}`; ride contact doc during active trips | The user; the other trip participant during an active trip; staff (masked by default) |
| Name | All riders | Identification, trip display | `users`, `drivers`, ride snapshots | The user; trip counterpart (passengers see the driver's display name; drivers see the passenger's first name); staff |
| Government ID images and typed details | Passengers | Identity verification before booking (safety) | `private/identity/…` (Storage), `verificationCases` | Reviewers and admins only, through an audited viewer; never returned to apps |
| Accreditation documents (license, OR/CR, franchise, clearances, photos) | Drivers | Legal and safety accreditation | `private/accreditation/…`, `drivers/{uid}/documents` | Reviewers and admins (audited) |
| Profile photo | Drivers | Lets passengers recognise their driver | `public/driverPhotos/…` after approval | Signed-in users |
| Live location | Online drivers | Matching, live tracking | RTDB `locations/{uid}` (overwritten each update, removed on disconnect or offline) | The driver; the passenger of their active ride (precise); other passengers (coarsened, via discovery); Functions |
| Trip records | Both | Service delivery, receipts, disputes, safety | `rides`, events, trace points at progress steps, payments, ratings | Participants (their own trips); support and admins |
| Emergency contact | Passengers (optional) | Lets the passenger text trip details | `users/{uid}.emergencyContact` | The user; staff |
| Support reports | Both | Customer support and safety | `supportCases` | Reporter; support staff |
| Device push token | All | Notifications | `users/{uid}/devices` | Server only |
| Audit records | Staff and riders (as targets) | Accountability for staff actions | `auditLogs` | Admins; reviewers and support by category |

**Data minimisation in the design:** discovery never returns exact driver positions or plate numbers; phone numbers are shared only during an active trip and then deleted; ID numbers and document images never leave the backend except to authorised reviewers; logs redact phone numbers, tokens, paths and ID numbers; passengers' ratings are hidden until a driver has at least `minRatingsToDisplay` ratings, so individual raters cannot be identified.

## Retention

Retention periods are configuration (`config/policies.retention`), not code. The defaults below are engineering placeholders: **set them to the periods counsel approves.**

| Data | Default | Mechanism | Automated? |
|---|---|---|---|
| Ride records (ride, timeline, trace, contact, payment, ratings) | 1825 days after request | `maintenanceJob` → `purgeOldRides` (daily, 02:30 Manila) | Yes (tested) |
| Audit log entries | 1825 days | `maintenanceJob` → `purgeOldAuditLogs` | Yes (tested). Export to long-term storage first if a longer legal hold applies |
| Rejected or superseded document images | 90 days after the decision | Deletion queue (`fileDeletionQueue`) → `processFileDeletionQueue` | Yes (tested) |
| Staging uploads never submitted | 24 hours | `cleanupStagingUploads` | Yes (tested). Also add a bucket lifecycle rule on `uploads/` as a backstop |
| Fare quotes, rate-limit counters | Minutes to hours | Firestore TTL policies + `purgeEphemeral` | Yes (tested) |
| Live driver location | Until the next update, disconnect or going offline | RTDB overwrite + `onDisconnect` removal + offline revocation | Yes |
| Ride contact numbers | Until the ride ends | Deleted in the ending transaction | Yes |
| **Approved** passenger ID images | While the account exists | None | **No.** Decide a policy (for example, delete N days after approval, keeping the decision record) |
| **Approved** driver documents | While the document is the approved version | Replaced versions go through the deletion queue | Partly |
| Accounts (profile, Auth user, devices, files) | Until a deletion request | Staff run `adminDeleteUserData` from the dashboard (see below) | On request (tested) |

## Data-subject requests

Users file requests in the app (Profile → Privacy and your data). The backend records them in `dataRequests` (type ACCESS, CORRECTION or DELETION; rate-limited to 3 per day) and audits them. Staff with `privacy.manage` (admin, superadmin) handle them on the dashboard's **Privacy requests** page:

| Request | Tool | What it does |
|---|---|---|
| Access | `adminExportUserData` → JSON download | The person's account, driver record, document statuses (no file locations or reviewer identities), identity-verification outcomes (no internal notes), rides, payments, ratings they gave, and support cases. Staff deliver it through an agreed secure channel |
| Deletion | `adminDeleteUserData` (the account id must be typed to confirm) | Refused while the person has an active trip or an open payment dispute. Otherwise deletes the Auth user, presence and live location, `users/{uid}` and `drivers/{uid}` with all subcollections, identity and accreditation files, staged uploads and the public photo. Records within their retention period are **anonymised**: names on rides, pickup notes, rating comments, support descriptions and verification-case names are replaced, and file lists cleared. Safe to re-run |
| Correction / any | `adminResolveDataRequest` | Closes the request as COMPLETED or REJECTED with an audited note. Verified names come from reviewed IDs, so a corrected name normally requires a new ID submission |

The operator still needs a written procedure with response deadlines, identity confirmation steps before exporting, and counsel's view on which fields must be retained (for example, for tax or transport regulation) versus anonymised.

## Security and breach response

Controls are described in [security-model.md](security-model.md). Operationally:

- Keep the audit log monitored (for example, alerts on unusual `DOCUMENT_VIEWED` volume per staff member).
- Prepare an incident and breach-notification runbook that meets NPC timelines, naming who decides, who notifies, and how affected users are contacted.
- Limit staff roles to the minimum and review the Staff page periodically. Role removal revokes sessions immediately.
