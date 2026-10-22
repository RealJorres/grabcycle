package ph.grabcycle.core.ride;

import ph.grabcycle.core.model.RideStatus;

/**
 * UI rules derived from the ride state. These only decide what to SHOW; the
 * backend enforces every transition and will reject anything invalid.
 */
public final class RideRules {
    private RideRules() {}

    public static DriverAction driverPrimaryAction(RideStatus status) {
        switch (status) {
            case ACCEPTED:
                return DriverAction.START_HEADING_TO_PICKUP;
            case DRIVER_EN_ROUTE:
                return DriverAction.MARK_ARRIVED;
            case DRIVER_ARRIVED:
                return DriverAction.START_TRIP;
            case IN_PROGRESS:
                return DriverAction.COMPLETE_TRIP;
            default:
                return DriverAction.NONE;
        }
    }

    /** Wire value for updateRideProgress, or null when the action is not a progress step. */
    public static String progressActionWire(DriverAction action) {
        switch (action) {
            case START_HEADING_TO_PICKUP:
                return "EN_ROUTE";
            case MARK_ARRIVED:
                return "ARRIVED";
            case START_TRIP:
                return "START";
            default:
                return null;
        }
    }

    public static boolean passengerCanCancel(RideStatus status) {
        return status.isSearching() || status == RideStatus.ACCEPTED || status == RideStatus.DRIVER_EN_ROUTE || status == RideStatus.DRIVER_ARRIVED;
    }

    public static boolean driverCanCancel(RideStatus status) {
        return status == RideStatus.ACCEPTED || status == RideStatus.DRIVER_EN_ROUTE || status == RideStatus.DRIVER_ARRIVED;
    }

    /** No-show may be reported only after arriving and waiting the configured minutes. */
    public static boolean driverCanReportNoShow(RideStatus status, Long arrivedAtMs, long nowMs, int waitMinutes) {
        return status == RideStatus.DRIVER_ARRIVED && arrivedAtMs != null && nowMs - arrivedAtMs >= waitMinutes * 60_000L;
    }

    /** The passenger may see the assigned driver's live position only during these stages. */
    public static boolean passengerSeesDriverLocation(RideStatus status) {
        return status.isAssigned();
    }

    /** Contact details (call/SMS) are offered only while a trip is active. */
    public static boolean contactAvailable(RideStatus status) {
        return status.isAssigned();
    }

    public static boolean canRate(RideStatus status, boolean alreadyRated) {
        return status == RideStatus.COMPLETED && !alreadyRated;
    }
}
