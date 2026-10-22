package ph.grabcycle.core.model;

/** Payment state, independent from ride state. */
public enum PaymentStatus {
    UNPAID,
    PENDING,
    PAID,
    FAILED,
    REFUNDED,
    DISPUTED,
    UNKNOWN;

    public static PaymentStatus fromWire(String value) {
        return Enums.parse(PaymentStatus.class, value, UNKNOWN);
    }
}
