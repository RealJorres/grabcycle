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

    /**
     * Mirrors the backend derivation so a status stored before an expiry date
     * passed is shown as it applies today. A pending renewal takes precedence;
     * an approved version stays authoritative over a later rejected renewal.
     */
    public static DocumentStatus derive(boolean hasPending, boolean hasApproved, String approvedExpiryDate,
                                        String lastDecision, java.time.LocalDate today) {
        if (hasPending) return PENDING_REVIEW;
        if (hasApproved) {
            if (approvedExpiryDate != null && !ph.grabcycle.core.util.DateInputs.isNotExpired(approvedExpiryDate, today)) return EXPIRED;
            return APPROVED;
        }
        if ("REJECT".equals(lastDecision)) return REJECTED;
        if ("REQUEST_RESUBMISSION".equals(lastDecision)) return NEEDS_RESUBMISSION;
        return NOT_SUBMITTED;
    }

    public boolean canSubmit() {
        return this != PENDING_REVIEW;
    }

    public boolean needsAction() {
        return this == NOT_SUBMITTED || this == NEEDS_RESUBMISSION || this == REJECTED || this == EXPIRED;
    }
}
