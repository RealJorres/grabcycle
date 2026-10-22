package ph.grabcycle.core.model;

/**
 * Ride lifecycle states. Mirrors the backend state machine
 * (backend/functions/src/domain/rideStateMachine.ts); the server is
 * authoritative and the app only renders these values.
 */
public enum RideStatus {
    REQUESTED,
    SEARCHING,
    ACCEPTED,
    DRIVER_EN_ROUTE,
    DRIVER_ARRIVED,
    IN_PROGRESS,
    COMPLETED,
    CANCELLED_BY_PASSENGER,
    CANCELLED_BY_DRIVER,
    CANCELLED_BY_ADMIN,
    NO_DRIVER_FOUND,
    EXPIRED,
    /** A value this app version does not know yet. Treated conservatively. */
    UNKNOWN;

    public static RideStatus fromWire(String value) {
        return Enums.parse(RideStatus.class, value, UNKNOWN);
    }

    public boolean isTerminal() {
        switch (this) {
            case COMPLETED:
            case CANCELLED_BY_PASSENGER:
            case CANCELLED_BY_DRIVER:
            case CANCELLED_BY_ADMIN:
            case NO_DRIVER_FOUND:
            case EXPIRED:
                return true;
            default:
                return false;
        }
    }

    public boolean isSearching() {
        return this == REQUESTED || this == SEARCHING;
    }

    /** A driver is committed to the ride. */
    public boolean isAssigned() {
        return this == ACCEPTED || this == DRIVER_EN_ROUTE || this == DRIVER_ARRIVED || this == IN_PROGRESS;
    }

    public boolean isCancelled() {
        return this == CANCELLED_BY_PASSENGER || this == CANCELLED_BY_DRIVER || this == CANCELLED_BY_ADMIN;
    }
}
