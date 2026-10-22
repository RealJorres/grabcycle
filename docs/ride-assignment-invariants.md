# Ride assignment invariants

These are the guarantees the matching code is built around. Each one names where it is enforced and which test proves it (`backend/functions/test/integration/…`, run against the Firestore, Realtime Database and Auth emulators).

## Invariants

| # | Invariant | How it is enforced | Proven by |
|---|---|---|---|
| I1 | **A driver is committed to at most one ride at a time** (one offer *or* one trip). | `drivers/{uid}.currentOfferRideId` and `currentRideId` are set only inside the Firestore transaction that also writes the ride. The transaction re-reads the driver and refuses unless both are null (`isReservable`). Firestore serializes transactions that touch the same document, so the loser re-reads the reservation and skips that driver. | `concurrency.test.ts`: many passengers selecting the same driver at once (exactly one reservation succeeds); concurrent automatic matching never double-books |
| I2 | **A ride has at most one offered driver and at most one assigned driver.** | `ride.offer` and `ride.driverUid` are written in the same transaction as the driver reservation, guarded by the ride state machine (offer only in SEARCHING; acceptance only SEARCHING → ACCEPTED). | `rides.test.ts` matching and offers; `concurrency.test.ts` concurrent accept taps |
| I3 | **A booking request creates at most one ride**, however often it is retried. | Ride id = `sha256(passengerUid:requestId)`. The app generates `requestId` once per booking intent and reuses it on retry. `createRide` returns the existing ride if the id exists, and the creating transaction re-checks existence. | `concurrency.test.ts`: duplicate concurrent submissions create one ride; `rides.test.ts`: idempotent per request id |
| I4 | **A passenger has at most one active ride.** | `users/{uid}.activeRideId` is checked and set in the creating transaction and cleared when the ride ends. | `rides.test.ts`: one active ride per passenger |
| I5 | **Only eligible drivers with fresh, trustworthy locations are offered rides.** | Candidate filter (`rankCandidates`): account ACTIVE, status APPROVED, availability ONLINE, no current offer or trip, eligibility current; location present, not from the future, fresher than `locationFreshnessSec` (30 s), accuracy ≤ `maxLocationAccuracyM` (100 m), not a mock location, and **tagged with the driver's current presence session id**. Each check is repeated inside the reservation transaction. | `discovery.test.ts`; `rides.test.ts`: stale driver locations are not matched |
| I6 | **An offer can only be accepted by its driver, once, before it expires.** | `respondToOffer` checks `ride.status == SEARCHING`, `ride.offer.driverId == caller`, `now < offer.expiresAt`, `driver.currentOfferRideId == rideId`, and eligibility, all in one transaction. | `rides.test.ts`; `concurrency.test.ts`: accept, complete and payment applied exactly once |
| I7 | **Searches end.** A ride never stays in SEARCHING indefinitely. | `searchDeadline = requestedAt + searchTimeoutSec` (180 s); offers expire after `offerTimeoutSec` (20 s). Expiry is applied lazily by `advanceRide` (passenger polling via `refreshRide`, declines, the next offer) and by `sweepRidesJob` every minute. | `rides.test.ts`: the sweeper and passenger polling expire offers and enforce the deadline |
| I8 | **Fares cannot come from the client.** | `createRide` takes a `quoteId`, not an amount. Quotes are server-computed, versioned (`fareVersion`), bound to one passenger, and expire after `quoteTtlSec` (10 min). | `discovery.test.ts`: client-supplied fares are impossible |
| I9 | **A selected driver is honoured exactly.** If the passenger chose a driver and did not allow fallback, the ride is never silently given to someone else. | `mode == SELECTED && !allowFallback` limits candidates to that driver; a decline, timeout or unavailability ends with NO_DRIVER_FOUND and a specific `statusReason`. | `rides.test.ts`: a selected driver who declines ends the request unless fallback was allowed |
| I10 | **Every transition is legal and recorded.** | `assertRideTransition` in every write transaction; each change appends a `rides/{id}/events` entry; staff interventions are audited. | `stateMachines.test.ts`; `rides.test.ts` |

## Matching flow

1. **Quote.** `getFareQuote(pickup, destination, passengers)` validates both points against the service area, computes distance (road distance from the Routes API when configured, otherwise a clearly labelled straight-line estimate), applies the active fare version, and stores a quote.
2. **Discovery (optional).** `findNearbyDrivers` returns up to `maxDiscoveryResults` eligible drivers (I5), nearest first, with **coarsened** positions and no plate numbers. The radius grows from `initialRadiusM` (2 km) by `radiusStepM` (1 km) to `maxRadiusM` (5 km).
3. **Geohash query.** Live locations live in the Realtime Database at `locations/{uid}` with a 10-character geohash `g`. Candidates come from `geohashQueryBounds` range queries on `g` (indexed), de-duplicated, then filtered by true great-circle distance, because geohash cells overshoot the circle.
4. **Create.** `createRide` re-checks the passenger (active, verified, approval still valid, no other active ride), the quote, the service area and operating hours, then builds an ordered candidate list (the selected driver, optionally followed by fallbacks, or the nearest drivers). It creates the ride and reserves the first reservable candidate in transactions.
5. **Offer loop.** `offerToNextCandidate` walks the list, skipping anyone no longer reservable. When the list is exhausted and fallback is allowed, it refreshes candidates up to 3 times, excluding drivers already tried. It ends with NO_DRIVER_FOUND or EXPIRED otherwise.
6. **Missed offers.** A driver who lets `missedOffersBeforeOffline` (3) offers in a row time out is set offline, so unattended phones stop absorbing requests.

## Live location and presence

- Only the backend can grant publishing rights: `presence/{uid} = { canPublish, sessionId, trackingPassengerUid }` is written by Cloud Functions when a driver goes online and revoked when they go offline, are suspended, or are swept for staleness.
- Realtime Database rules accept a write to `locations/{uid}` only from that driver, only while `canPublish` is true, only with `sid == presence.sessionId`, with coordinates inside the service bounds and physically plausible movement, at most once every 2 s, with server timestamp `ts == now`, and with a client capture time `cts` within ±60 s of server time. That last check rejects writes the SDK queued while offline and flushed later.
- The app registers an `onDisconnect` removal, so a dropped connection removes the location instead of leaving a stale driver matchable. The scheduled `sweepDriversJob` (every 5 min) sets drivers offline after `staleDriverAutoOfflineMin` (10 min) without fresh locations and revokes stray publishing rights.
- Passengers can read a driver's location only while that driver is assigned to their active ride (`trackingPassengerUid`).

## Failure handling

- **Network loss on the passenger side:** retries reuse the same `requestId` (I3). The ride screen is driven by the Firestore listener, and cached data is marked as such.
- **Driver phone dies mid-trip:** the trip stays assigned (no silent reassignment). The passenger sees the location marked stale, support can contact both parties, and an admin can complete or cancel the ride (audited).
- **Function timeouts or contention:** Firestore transaction aborts surface as `SERVICE_UNAVAILABLE` (retryable). All steps re-validate current state, so a retry or duplicate trigger is harmless.
