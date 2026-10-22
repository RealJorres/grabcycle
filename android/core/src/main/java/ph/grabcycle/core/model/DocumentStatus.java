package ph.grabcycle.core.model;

/** Review state of one accreditation document. */
public enum DocumentStatus {
    NOT_SUBMITTED,
    PENDING_REVIEW,
    APPROVED,
    NEEDS_RESUBMISSION,
    REJECTED,
    EXPIRED,
    UNKNOWN;

    public static DocumentStatus fromWire(String value) {
        return Enums.parse(DocumentStatus.class, value, UNKNOWN);
    }

    public boolean canSubmit() {
        return this != PENDING_REVIEW;
    }

    public boolean needsAction() {
        return this == NOT_SUBMITTED || this == NEEDS_RESUBMISSION || this == REJECTED || this == EXPIRED;
    }
}
