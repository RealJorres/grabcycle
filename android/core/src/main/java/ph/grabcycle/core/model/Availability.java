package ph.grabcycle.core.model;

/** Driver availability as decided by the server. */
public enum Availability {
    OFFLINE,
    ONLINE,
    OFFERED,
    ON_TRIP,
    UNKNOWN;

    public static Availability fromWire(String value) {
        return Enums.parse(Availability.class, value, UNKNOWN);
    }

    /** Whether the device should be publishing its location. */
    public boolean sharesLocation() {
        return this == ONLINE || this == OFFERED || this == ON_TRIP;
    }
}
