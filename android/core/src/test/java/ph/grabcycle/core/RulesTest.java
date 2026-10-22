package ph.grabcycle.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import ph.grabcycle.core.location.LocationQuality;
import ph.grabcycle.core.model.Availability;
import ph.grabcycle.core.model.DocumentStatus;
import ph.grabcycle.core.model.ErrorReason;
import ph.grabcycle.core.model.RideStatus;
import ph.grabcycle.core.model.VerificationStatus;
import ph.grabcycle.core.notify.EventDeduper;
import ph.grabcycle.core.ride.DriverAction;
import ph.grabcycle.core.ride.RideRules;

class RulesTest {

    @Test
    void parsesUnknownServerValuesSafely() {
        assertEquals(RideStatus.IN_PROGRESS, RideStatus.fromWire("IN_PROGRESS"));
        assertEquals(RideStatus.UNKNOWN, RideStatus.fromWire("TELEPORTING"));
        assertEquals(RideStatus.UNKNOWN, RideStatus.fromWire(null));
        assertEquals(ErrorReason.PASSENGER_NOT_VERIFIED, ErrorReason.fromWire("PASSENGER_NOT_VERIFIED"));
        assertEquals(ErrorReason.UNKNOWN, ErrorReason.fromWire("SOMETHING_NEW"));
    }

    @Test
    void rideStatusGroups() {
        assertTrue(RideStatus.COMPLETED.isTerminal());
        assertTrue(RideStatus.NO_DRIVER_FOUND.isTerminal());
        assertFalse(RideStatus.UNKNOWN.isTerminal());
        assertTrue(RideStatus.DRIVER_ARRIVED.isAssigned());
        assertTrue(RideStatus.SEARCHING.isSearching());
        assertTrue(RideStatus.CANCELLED_BY_ADMIN.isCancelled());
    }

    @Test
    void driverActionsFollowTheStateMachine() {
        assertEquals(DriverAction.START_HEADING_TO_PICKUP, RideRules.driverPrimaryAction(RideStatus.ACCEPTED));
        assertEquals(DriverAction.MARK_ARRIVED, RideRules.driverPrimaryAction(RideStatus.DRIVER_EN_ROUTE));
        assertEquals(DriverAction.START_TRIP, RideRules.driverPrimaryAction(RideStatus.DRIVER_ARRIVED));
        assertEquals(DriverAction.COMPLETE_TRIP, RideRules.driverPrimaryAction(RideStatus.IN_PROGRESS));
        assertEquals(DriverAction.NONE, RideRules.driverPrimaryAction(RideStatus.COMPLETED));
        assertEquals("ARRIVED", RideRules.progressActionWire(DriverAction.MARK_ARRIVED));
        assertNull(RideRules.progressActionWire(DriverAction.COMPLETE_TRIP));
    }

    @Test
    void cancellationAndDisclosureRules() {
        assertTrue(RideRules.passengerCanCancel(RideStatus.SEARCHING));
        assertTrue(RideRules.passengerCanCancel(RideStatus.DRIVER_ARRIVED));
        assertFalse(RideRules.passengerCanCancel(RideStatus.IN_PROGRESS));
        assertFalse(RideRules.driverCanCancel(RideStatus.SEARCHING));
        assertFalse(RideRules.passengerSeesDriverLocation(RideStatus.SEARCHING));
        assertTrue(RideRules.passengerSeesDriverLocation(RideStatus.DRIVER_EN_ROUTE));
        assertFalse(RideRules.contactAvailable(RideStatus.COMPLETED));
        long arrived = 1_000_000L;
        assertFalse(RideRules.driverCanReportNoShow(RideStatus.DRIVER_ARRIVED, arrived, arrived + 4 * 60_000L, 5));
        assertTrue(RideRules.driverCanReportNoShow(RideStatus.DRIVER_ARRIVED, arrived, arrived + 5 * 60_000L, 5));
        assertFalse(RideRules.driverCanReportNoShow(RideStatus.DRIVER_EN_ROUTE, arrived, arrived + 9 * 60_000L, 5));
        assertTrue(RideRules.canRate(RideStatus.COMPLETED, false));
        assertFalse(RideRules.canRate(RideStatus.COMPLETED, true));
    }

    @Test
    void verificationGates() {
        long now = 5_000L;
        assertTrue(VerificationStatus.canBook(VerificationStatus.APPROVED, null, now));
        assertTrue(VerificationStatus.canBook(VerificationStatus.APPROVED, now + 1, now));
        assertFalse(VerificationStatus.canBook(VerificationStatus.APPROVED, now, now));
        assertFalse(VerificationStatus.canBook(VerificationStatus.UNDER_REVIEW, null, now));
        assertTrue(VerificationStatus.NEEDS_RESUBMISSION.canSubmit());
        assertFalse(VerificationStatus.SUBMITTED.canSubmit());
        assertFalse(VerificationStatus.SUSPENDED.canSubmit());
        assertEquals(VerificationStatus.NEEDS_RESUBMISSION, VerificationStatus.effective(VerificationStatus.APPROVED, now, now));
        assertEquals(VerificationStatus.APPROVED, VerificationStatus.effective(VerificationStatus.APPROVED, now + 1, now));
        assertEquals(VerificationStatus.SUSPENDED, VerificationStatus.effective(VerificationStatus.SUSPENDED, now - 1, now));
        assertFalse(DocumentStatus.PENDING_REVIEW.canSubmit());
        java.time.LocalDate today = java.time.LocalDate.of(2026, 10, 22);
        assertEquals(DocumentStatus.PENDING_REVIEW, DocumentStatus.derive(true, true, "2026-01-01", null, today));
        assertEquals(DocumentStatus.APPROVED, DocumentStatus.derive(false, true, "2026-10-22", "REJECT", today));
        assertEquals(DocumentStatus.EXPIRED, DocumentStatus.derive(false, true, "2026-10-21", null, today));
        assertEquals(DocumentStatus.APPROVED, DocumentStatus.derive(false, true, null, null, today));
        assertEquals(DocumentStatus.REJECTED, DocumentStatus.derive(false, false, null, "REJECT", today));
        assertEquals(DocumentStatus.NEEDS_RESUBMISSION, DocumentStatus.derive(false, false, null, "REQUEST_RESUBMISSION", today));
        assertEquals(DocumentStatus.NOT_SUBMITTED, DocumentStatus.derive(false, false, null, null, today));
        assertTrue(DocumentStatus.EXPIRED.needsAction());
        assertTrue(Availability.ON_TRIP.sharesLocation());
        assertFalse(Availability.OFFLINE.sharesLocation());
    }

    @Test
    void locationQualityThresholds() {
        assertEquals(LocationQuality.GOOD, LocationQuality.evaluate(20f, 2_000L, 100, 30));
        assertEquals(LocationQuality.FAIR, LocationQuality.evaluate(80f, 2_000L, 100, 30));
        assertEquals(LocationQuality.POOR, LocationQuality.evaluate(150f, 2_000L, 100, 30));
        assertEquals(LocationQuality.STALE, LocationQuality.evaluate(10f, 31_000L, 100, 30));
        assertEquals(LocationQuality.NONE, LocationQuality.evaluate(null, null, 100, 30));
        assertFalse(LocationQuality.POOR.publishable());
    }

    @Test
    void deduplicatesNotifications() {
        EventDeduper d = new EventDeduper(2);
        assertTrue(d.firstTime("a", 1));
        assertFalse(d.firstTime("a", 2));
        assertTrue(d.firstTime("b", 3));
        assertTrue(d.firstTime("c", 4));
        assertTrue(d.firstTime("a", 5), "evicted ids may be seen again");
        assertFalse(d.firstTime("", 6));
        assertTrue(EventDeduper.isStale(1_000, 40_000, 30_000));
        assertFalse(EventDeduper.isStale(1_000, 20_000, 30_000));
    }
}
