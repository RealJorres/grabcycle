# Data dictionary

All writes are made by Cloud Functions unless a row says otherwise. "Read" lists who the security rules allow to read. Money is always **integer centavos** (₱1.00 = 100). Times are Firestore `Timestamp`s unless noted as epoch milliseconds. Calendar dates such as document expiry are `"YYYY-MM-DD"` strings interpreted in **Asia/Manila**, valid through the end of that day. Type definitions live in `backend/functions/src/services/models.ts` and `domain/config.ts`.

## Cloud Firestore

### Accounts

| Path | Purpose | Key fields | Read |
|---|---|---|---|
| `users/{uid}` | Rider account profile | `accountType` PASSENGER/DRIVER (immutable); `status` ACTIVE/SUSPENDED; `displayName`, `firstName`; `phoneNumber` (E.164, from the Auth token); `locale`; `consents {termsVersion, privacyNoticeVersion, acceptedAt}`; `passengerVerification {status, caseId, validUntil (ms), publicMessage, submittedAt}`; `activeRideId`; `emergencyContact {name, phone}`; `fareDiscount {code, verifiedAt, expiresAt, verifiedBy}`; `ratingSummary {count, sum}`; `suspension {reasonCode, publicMessage, at}` | Owner, staff |
| `users/{uid}/devices/{installationId}` | FCM registration | `token`, `platform`, `updatedAt` | Nobody (server only) |
| `staff/{uid}` | Staff role directory mirroring the custom claim | `email`, `role`, `active`, `updatedBy` | Self, superadmin |

### Passenger verification

| Path | Purpose | Key fields | Read |
|---|---|---|---|
| `verificationCases/{caseId}` | One ID submission and its review | `uid`, `status`, `idType`, `idTypeLabel`, `nameOnId`, `idExpiry`, `files[] {side, storagePath, contentType, sizeBytes, sha256}`, `applicantName`, `applicantPhoneMasked`, `attempt`, `submittedAt`, `claimedBy`, `claimedAt`, `decision {decision, reasonCode, publicMessage, internalNote, checklist, reviewerUid, decidedAt}`, `filesDeleteAfter` | Reviewers, admins |

### Drivers

| Path | Purpose | Key fields | Read |
|---|---|---|---|
| `drivers/{uid}` | Accreditation and operating state | `status` (see state machines); `accountStatus`; `everApproved`; `applicationSubmittedAt`; `profile {municipality}`; `vehicle {plateNumber, bodyNumber, make, model, color, capacity, franchiseMunicipality, status, publicMessage, reviewedAt}`; `availability` OFFLINE/ONLINE/OFFERED/ON_TRIP; `currentOfferRideId`; `currentRideId`; `presenceSessionId`; `eligibility {eligible, reasons[], validUntil (ms), computedAt}`; `documentsSummary {code: status}`; `publicProfile {displayName, photoPath, vehicleSummary}`; `ratingSummary`; `missedOffers`; `stats {completedTrips, cancelledByDriver, declinedOffers}`; `decision` | Owner, staff |
| `drivers/{uid}/documents/{requirementCode}` | One accreditation requirement | `scope` DRIVER/VEHICLE; `label`; `status` (derived); `approved {submissionId, files[], expiryDate, documentNumber, approvedAt, reviewerUid}`; `pending {…, submittedAt}`; `lastDecision {decision, reasonCode, publicMessage, decidedAt}`; `pendingSubmittedAt`; `approvedExpiryDate` | Owner, reviewers |
| `drivers/{uid}/private/{docId}` | Sensitive driver details | | Owner, reviewers |

### Rides and payments

| Path | Purpose | Key fields | Read |
|---|---|---|---|
| `rides/{rideId}` | One trip request (id = sha256 of passenger uid + request id) | `passengerUid`, `driverUid`, `status`, `statusReason`, `mode` SELECTED/AUTO, `allowFallback`, `selectedDriverId`, `pickup {lat, lng, address, note}`, `destination`, `quote {quoteId, total, lines[], fareVersion, fareIsSample, distanceMeters, distanceSource, durationSeconds, passengers}`, `offer {driverId, offeredAt, expiresAt, attempt}`, `searchDeadline`, `passenger {firstName, ratingAvg}`, `driver {displayName, photoPath, plateNumber, bodyNumber, vehicleDescription, ratingAvg}` (set on acceptance), `driverEtaSeconds`, `finalFare {total, lines[], waitingMinutes}`, `payment {method, status}`, `cancellation {by, reasonCode, note, feeApplied}`, `rated {byPassenger, byDriver}`, per-status timestamps | Participants; the offered driver while SEARCHING; support |
| `rides/{id}/events/{eventId}` | Append-only timeline | `type`, `from`, `to`, `actor`, `actorUid`, `details`, `at` | Participants, support |
| `rides/{id}/contact/info` | Phone numbers for the trip | `passengerFirstName`, `passengerPhone`, `driverName`, `driverPhone` (created on acceptance, deleted when the ride ends) | Participants during ACCEPTED…IN_PROGRESS, support |
| `rides/{id}/private/matching` | Candidate bookkeeping | `candidates[]`, `tried[]`, `declined[]`, `timedOut[]`, `refreshes`, `radiusM` | Admins |
| `rides/{id}/private/trace` | Driver position at each progress step (dispute evidence) | `points[] {type, lat, lng, acc, at}` | Admins |
| `payments/{rideId}` | Payment for a completed ride | `method` CASH, `status`, `currency` PHP, `amountDue`, `amountCollected`, `discrepancy`, `recordedBy`, `recordedAt`, `history[] {status, by, at, note}` | Participants, support |
| `ratings/{rideId}_{role}` | One rating per side per ride | `raterUid`, `raterRole`, `rateeUid`, `stars` 1–5, `comment`, `tags[]`, `createdAt` | Rater, support |
| `fareQuotes/{quoteId}` | Server-computed quote bound to one passenger | quote snapshot + `passengerUid`, `pickup`, `destination`, `expiresAt` (TTL) | Nobody (server only) |

### Support, privacy and audit

| Path | Purpose | Key fields | Read |
|---|---|---|---|
| `supportCases/{caseId}` | User report | `reporterUid`, `reporterRole`, `rideId`, `category`, `description`, `status` OPEN/IN_PROGRESS/RESOLVED/CLOSED, `priority` NORMAL/HIGH/URGENT (SAFETY → URGENT), `publicResponse`, `assignedTo` | Reporter, support |
| `supportCases/{id}/notes/{noteId}` | Internal staff notes | `note`, `authorUid`, `createdAt` | Support |
| `dataRequests/{requestId}` | Data-subject requests | `uid`, `type` ACCESS/DELETION/CORRECTION, `note`, `status` RECEIVED/IN_PROGRESS/COMPLETED/REJECTED, `handledBy`, `resolutionNote`, `resolvedAt`, timestamps | Requester, admins |
| `auditLogs/{id}` | Append-only audit trail | `category`, `action`, `actorUid`, `actorRole`, `targetType`, `targetId`, `targetUid`, `reasonCode`, `details`, `at` | Admins; reviewers (REVIEW); support (SUPPORT) |
| `rateLimits/{key}` | Fixed-window counters | `count`, `windowStart`, `expiresAt` (TTL) | Nobody |
| `fileDeletionQueue/{id}` | Private files scheduled for deletion under the retention policy | `paths[]`, `reason`, `deleteAfter`, `createdAt` | Nobody (server only) |

### Configuration (`config/*`, changed only through `adminUpdateConfig`, history in `configHistory`)

| Document | Contents | Defaults |
|---|---|---|
| `config/serviceArea` | `polygons[] {name, points[] {lat, lng}}`, `municipalities[]`, `boundsMarginDeg`, `operatingHours {enabled, startHour, endHour}`, `isSample` | **None in production**; sample only via seed |
| `config/matching` | radii (`initialRadiusM` 2000, `radiusStepM` 1000, `maxRadiusM` 5000), `locationFreshnessSec` 30, `maxLocationAccuracyM` 100, `locationUpdateIntervalSec` 5, `offerTimeoutSec` 20, `searchTimeoutSec` 180, `maxCandidates` 10, `maxDiscoveryResults` 20, `arrivalMaxDistanceM` 500, `staleDriverAutoOfflineMin` 10, `missedOffersBeforeOffline` 3, `quoteTtlSec` 600, `rejectMockLocations` true | Engineering defaults apply when absent |
| `config/documentPolicy` | `passengerIdTypes[] {code, label, sides, hasExpiry, active}`, `driverRequirements[] {code, label, description, scope, mandatory, sides, hasExpiry, numberField, publishAsProfilePhoto, expiryReminderDays, regulatoryNote, active}`, `passengerApprovalValidityDays`, `maxUploadBytes`, `isSample` | **None in production**; sample only via seed |
| `config/policies` | `cancellation`, `ratings {minRatingsToDisplay 5, ratingWindowDays 7}`, `retention {rideRecordsDays 1825, rejectedDocumentsDays 90, stagingUploadsHours 24, auditLogDays 1825}`, `terms {termsVersion, privacyNoticeVersion}` | Defaults apply when absent |
| `config/payments` | `enabledMethods` [CASH], `cashDiscrepancyTolerance` 0 | Defaults apply when absent |
| `config/app` | `announcements[]`, `supportPhone`, `supportEmail`, `emergencyHotline` "911", `minAndroidVersionCode`, `maintenanceMode` | Defaults apply when absent |
| `config/fare` | `activeVersion`, `activatedAt`, `activatedBy` | **None**: quotes are refused until a fare version is active |
| `fareConfigs/{version}` | Immutable fare rules: `label`, `mode`, `baseFare`, distance/zone rules, `nightSurcharge`, `rounding`, `discounts[] {code, label, percent, enabled}`, waiting fee, adjustment reasons, `isSample` | Sample only via seed |
| `landmarks/{id}` | Curated places for search | `name`, `municipality`, `barangay`, `keywords[]`, `lat`, `lng`, `active`, `isSample` | Signed-in users |
| `configHistory/{id}` | Previous values for every config change | `key`, `revision`, `value`, `previous`, `updatedBy`, `at` | Admins |

## Realtime Database

| Path | Written by | Contents | Read |
|---|---|---|---|
| `config/bounds` | Functions (on service-area change) | `minLat`, `maxLat`, `minLng`, `maxLng` used by location rules | Rules only |
| `presence/{uid}` | Functions | `canPublish`, `sessionId`, `trackingPassengerUid` | Owner |
| `locations/{uid}` | **The driver's app** (under rules) and Functions | `lat`, `lng`, `acc` (m), `g` (geohash, 10 chars), `ts` (server ms), `cts` (capture ms), `sid`, `mock`, optional `hdg`, `spd` | Owner; the passenger of the driver's active ride; Functions |

## Cloud Storage

| Path | Contents | Access |
|---|---|---|
| `uploads/{uid}/{uploadId}` | Staging JPEG from the app (EXIF stripped) | Owner may create once (1 KB–6 MB, JPEG); removed after promotion or after `stagingUploadsHours` |
| `private/identity/{uid}/{caseId}/…` | Passenger ID images | No client access; staff view through `adminGetDocumentFile` (audited) |
| `private/accreditation/{uid}/…` | Driver document images | Same as above |
| `public/driverPhotos/{uid}/…` | Approved driver profile photo | Signed-in users |

## Firestore TTL and indexes

- TTL policies on `fareQuotes.expiresAt` and `rateLimits.expiresAt` (`backend/rules/firestore.indexes.json`); `maintenanceJob` also purges any leftovers.
- Composite indexes cover every query the apps and dashboard run: queues by status and time, per-user history, audit filters, the documents collection group, and config history.
