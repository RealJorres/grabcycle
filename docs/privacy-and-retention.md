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
| Accounts (profile, Auth user, devices, uploads) | Until a deletion request | Manual (see below) | **No** |

## Data-subject requests

Users file requests in the app (Profile → Privacy and your data). The backend records them in `dataRequests` (type ACCESS, CORRECTION or DELETION; rate-limited to 3 per day) and audits them. **Fulfilment is a manual staff process today.** Before launch, the operator needs:

1. A documented procedure and response deadline for each request type.
2. For **access**: an export of the user's `users` document, rides, payments, ratings, support cases and verification status (not internal reviewer notes, if counsel agrees that is permissible).
3. For **deletion**: checks for active trips, open disputes and legal holds; deletion of the Auth user, `users/{uid}` and subcollections, `drivers/{uid}` and subcollections, private and public files, and devices; anonymisation (rather than deletion) of ride records still within their retention period. **This deletion function is not implemented yet** and should be built and tested as an admin callable before launch.
4. For **correction**: verified names come from reviewed IDs, so a corrected name normally requires a new ID submission.

## Security and breach response

Controls are described in [security-model.md](security-model.md). Operationally:

- Keep the audit log monitored (for example, alerts on unusual `DOCUMENT_VIEWED` volume per staff member).
- Prepare an incident and breach-notification runbook that meets NPC timelines, naming who decides, who notifies, and how affected users are contacted.
- Limit staff roles to the minimum and review the Staff page periodically. Role removal revokes sessions immediately.
