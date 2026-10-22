package ph.grabcycle.core.model;

/** Passenger identity verification state (server-controlled). */
public enum VerificationStatus {
    NOT_SUBMITTED,
    SUBMITTED,
    UNDER_REVIEW,
    NEEDS_RESUBMISSION,
    APPROVED,
    REJECTED,
    SUSPENDED,
    UNKNOWN;

    public static VerificationStatus fromWire(String value) {
        return Enums.parse(VerificationStatus.class, value, UNKNOWN);
    }

    /** Whether the passenger may submit (or resubmit) documents. */
    public boolean canSubmit() {
        return this == NOT_SUBMITTED || this == NEEDS_RESUBMISSION;
    }

    /**
     * Status as it applies now: an approval whose validity has lapsed acts as
     * NEEDS_RESUBMISSION (mirrors the backend), so a renewal can be submitted.
     */
    public static VerificationStatus effective(VerificationStatus status, Long validUntilMs, long nowMs) {
        if (status == APPROVED && validUntilMs != null && validUntilMs <= nowMs) return NEEDS_RESUBMISSION;
        return status;
    }

    public boolean isPendingReview() {
        return this == SUBMITTED || this == UNDER_REVIEW;
    }

    /**
     * Booking eligibility as displayed by the client. The server re-checks
     * approval and validity on every booking request.
     */
    public static boolean canBook(VerificationStatus status, Long validUntilMs, long nowMs) {
        return status == APPROVED && (validUntilMs == null || validUntilMs > nowMs);
    }
}
