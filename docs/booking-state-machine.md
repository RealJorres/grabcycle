# State machines

Every status change is made by a Cloud Function inside a Firestore transaction that first checks the transition table below (`assert…Transition`). A transition not in the table fails with `INVALID_STATE_TRANSITION`, so a stale client, a duplicate tap or a race can never move a record backwards or skip a step. The tables are the single source of truth in code:

| Machine | Source |
|---|---|
| Ride | `backend/functions/src/domain/rideStateMachine.ts` |
| Payment | `backend/functions/src/domain/payment.ts` |
| Passenger verification | `backend/functions/src/domain/passengerVerification.ts` |
| Driver accreditation and documents | `backend/functions/src/domain/driverAccreditation.ts` |

Unit tests (`test/unit/stateMachines.test.ts`) pin every allowed and forbidden transition. The Android `:core` module and the dashboard mirror the read-only parts of these rules to decide what to *show*; they never decide outcomes.

## 1. Ride

```
REQUESTED ─▶ SEARCHING ─▶ ACCEPTED ─▶ DRIVER_EN_ROUTE ─▶ DRIVER_ARRIVED ─▶ IN_PROGRESS ─▶ COMPLETED
    │            │            │               │                  │
    │            │            └───────────────┴──────────────────┴─▶ CANCELLED_BY_PASSENGER / CANCELLED_BY_DRIVER
    └────────────┴─▶ NO_DRIVER_FOUND / EXPIRED / CANCELLED_BY_PASSENGER
Any non-terminal ─▶ CANCELLED_BY_ADMIN
```

| From | To | Actor | Trigger |
|---|---|---|---|
| REQUESTED | SEARCHING | System | `createRide` after the ride is created and the first offer is sent |
| SEARCHING | ACCEPTED | Driver | `respondToOffer(accept)` by the driver currently holding the offer, before it expires |
| ACCEPTED | DRIVER_EN_ROUTE | Driver | `updateRideProgress(EN_ROUTE)` |
| ACCEPTED, DRIVER_EN_ROUTE | DRIVER_ARRIVED | Driver | `updateRideProgress(ARRIVED)`; the driver's live location must be within `arrivalMaxDistanceM` (default 500 m) of the pickup |
| DRIVER_ARRIVED | IN_PROGRESS | Driver | `updateRideProgress(START)` |
| IN_PROGRESS | COMPLETED | Driver, Admin | `completeRide` / `adminCompleteRide` (audited); the server computes the final fare |
| REQUESTED, SEARCHING, ACCEPTED, DRIVER_EN_ROUTE, DRIVER_ARRIVED | CANCELLED_BY_PASSENGER | Passenger | `cancelRide` with a passenger reason code |
| ACCEPTED, DRIVER_EN_ROUTE, DRIVER_ARRIVED | CANCELLED_BY_DRIVER | Driver | `cancelRide` with a driver reason; `PASSENGER_NO_SHOW` only after `driverNoShowWaitMinutes` (default 5) at the pickup |
| any non-terminal | CANCELLED_BY_ADMIN | Admin | `adminCancelRide` (audited) |
| REQUESTED, SEARCHING | NO_DRIVER_FOUND | System | candidates exhausted (or the selected driver declined, timed out, or became unavailable with no fallback) |
| REQUESTED, SEARCHING | EXPIRED | System | `searchTimeoutSec` (default 180 s) reached without acceptance |

Terminal: COMPLETED, CANCELLED_BY_PASSENGER, CANCELLED_BY_DRIVER, CANCELLED_BY_ADMIN, NO_DRIVER_FOUND, EXPIRED.

**Offers within SEARCHING.** While searching, `ride.offer = { driverId, offeredAt, expiresAt, attempt }` names the one driver who may accept. An offer ends by acceptance, decline (`OFFER_DECLINED`), timeout (`OFFER_EXPIRED`, after `offerTimeoutSec`, default 20 s), or the driver going offline. The ride then moves to the next candidate. Every step writes a ride event (`rides/{id}/events`).

**Who sees what.** Passengers see the assigned driver's identity (name, photo, plate, body number) and live location only in ACCEPTED through IN_PROGRESS. Phone numbers (`rides/{id}/contact/info`) are readable only in those states and are deleted when the ride ends.

**Cancellation fee.** Disabled by default. When enabled in `config/policies.cancellation`, a passenger who cancels an assigned ride at least `passengerFeeAfterAcceptMinutes` after acceptance is charged `passengerFee` (recorded in `ride.cancellation.feeApplied`).

## 2. Payment

Cash only; online providers plug into the same machine through the `PROVIDER` actor.

| From | To | Actors |
|---|---|---|
| UNPAID | PAID | Driver (cash recorded, amount ≥ due minus tolerance), Admin, Provider |
| UNPAID | PENDING | Driver (cash recorded with a shortfall beyond `cashDiscrepancyTolerance`), Provider |
| PENDING | PAID | Admin, Provider |
| PENDING, UNPAID | FAILED | Provider, Admin |
| FAILED | UNPAID | Admin |
| UNPAID, PENDING, PAID | DISPUTED | Passenger, Driver, Admin |
| DISPUTED | PAID | Admin |
| DISPUTED, PAID | REFUNDED | Admin, Provider |

The payment record (`payments/{rideId}`) is created when the ride completes. Its amount due is the server's final fare: the quote plus the configured waiting fee and any validated adjustments. Every change appends to `history` and is audited. A dispute also opens a support case.

## 3. Passenger identity verification

| From | To | Actor |
|---|---|---|
| NOT_SUBMITTED, NEEDS_RESUBMISSION | SUBMITTED | Passenger |
| SUBMITTED | UNDER_REVIEW | Reviewer, Admin (claiming the case) |
| SUBMITTED, UNDER_REVIEW | APPROVED / REJECTED / NEEDS_RESUBMISSION | Reviewer, Admin |
| APPROVED | NEEDS_RESUBMISSION | Admin, System (approval validity lapsed or revoked) |
| APPROVED | SUSPENDED | Admin |
| SUSPENDED | APPROVED / NEEDS_RESUBMISSION | Admin |
| REJECTED | NEEDS_RESUBMISSION | Admin (reopen) |

- **Booking gate:** `createRide` and `findNearbyDrivers` require `status == APPROVED` and, if set, `validUntil > now`. Uploading documents never approves anyone.
- Approval requires every checklist item (name matches, photos clear, document unexpired, appears authentic). Rejections and resubmission requests require a reason and a message for the passenger.
- `validUntil` is the end of the ID's expiry date (Asia/Manila), optionally capped by `passengerApprovalValidityDays`. The daily `documentExpiryJob` moves lapsed approvals to NEEDS_RESUBMISSION. A passenger whose approval has lapsed can submit a renewal immediately, even before the job runs (effective status).
- Reviewers cannot decide their own case, and a claimed case can only be decided by the reviewer who claimed it.

## 4. Driver accreditation

### Documents (per requirement, `drivers/{uid}/documents/{code}`)

Each document keeps two independent versions: `approved` (the one that counts) and `pending` (a submission awaiting review). Its status is derived, not stored blindly:

| Condition | Status |
|---|---|
| a pending version exists | PENDING_REVIEW |
| approved version exists and its expiry date has passed | EXPIRED |
| approved version exists | APPROVED |
| last decision was REJECT | REJECTED |
| last decision was REQUEST_RESUBMISSION | NEEDS_RESUBMISSION |
| otherwise | NOT_SUBMITTED |

A renewal under review never invalidates the currently approved version until it expires, and a rejected renewal leaves the approved version in force. The reviewer confirms the expiry date against the printed document (`verifiedExpiryDate`).

### Driver status (`drivers/{uid}.status`)

PROFILE_INCOMPLETE → DOCUMENTS_PENDING → UNDER_REVIEW → APPROVED, with NEEDS_RESUBMISSION, REJECTED, SUSPENDED and EXPIRED as side states. It is recomputed from the profile, the vehicle and the documents whenever any of them changes. `adminDecideDriver` APPROVE succeeds only when every mandatory requirement and the vehicle are approved. SUSPEND takes an online driver offline immediately. REINSTATE does not silently restore availability; the driver must go online again.

### Eligibility to go online

Eligibility is computed at evaluation time and again inside the go-online transaction:

- the account is ACTIVE;
- the driver status is APPROVED (EXPIRED drivers fail on the document checks);
- the vehicle is APPROVED;
- every mandatory document has an approved, unexpired version;
- the driver has a fresh, accurate, non-mock location inside the service area, during operating hours.

`eligibility.reasons` lists every failed check (for example `DOCUMENT_EXPIRED:DRIVERS_LICENSE`), so the app can tell the driver exactly what to fix. A driver whose document expires mid-trip finishes the trip and is then taken offline.

### Availability (`drivers/{uid}.availability`)

```
OFFLINE ──setDriverAvailability(online)──▶ ONLINE ──offer──▶ OFFERED ──accept──▶ ON_TRIP
   ▲                                          │  ◀──decline/timeout──┘               │
   └────────── offline / sweeper / suspension ┴──────────── trip ends ◀──────────────┘
```

Each go-online issues a new presence session id. Location writes are accepted only with that id (see [ride-assignment-invariants.md](ride-assignment-invariants.md)). Going offline is refused during a trip.
