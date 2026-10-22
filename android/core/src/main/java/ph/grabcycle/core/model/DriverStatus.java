package ph.grabcycle.core.model;

/** Driver accreditation state (server-controlled). */
public enum DriverStatus {
    PROFILE_INCOMPLETE,
    DOCUMENTS_PENDING,
    UNDER_REVIEW,
    NEEDS_RESUBMISSION,
    APPROVED,
    REJECTED,
    SUSPENDED,
    EXPIRED,
    UNKNOWN;

    public static DriverStatus fromWire(String value) {
        return Enums.parse(DriverStatus.class, value, UNKNOWN);
    }

    /** States in which the driver still needs to act in onboarding. */
    public boolean needsDriverAction() {
        return this == PROFILE_INCOMPLETE || this == DOCUMENTS_PENDING || this == NEEDS_RESUBMISSION || this == EXPIRED;
    }
}
