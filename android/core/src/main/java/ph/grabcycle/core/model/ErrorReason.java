package ph.grabcycle.core.model;

/**
 * Stable machine-readable reasons returned by the backend in
 * {@code HttpsError.details.reason}. The UI maps them to localized messages.
 */
public enum ErrorReason {
    UNAUTHENTICATED,
    PERMISSION_DENIED,
    INVALID_ARGUMENT,
    NOT_FOUND,
    RATE_LIMITED,
    INTERNAL,
    SERVICE_UNAVAILABLE,
    INVALID_STATE_TRANSITION,
    ACCOUNT_NOT_REGISTERED,
    ACCOUNT_ALREADY_REGISTERED,
    ACCOUNT_TYPE_MISMATCH,
    ACCOUNT_SUSPENDED,
    PHONE_NOT_VERIFIED,
    CONSENT_REQUIRED,
    PASSENGER_NOT_VERIFIED,
    VERIFICATION_ALREADY_PENDING,
    VERIFICATION_NOT_ALLOWED,
    UNSUPPORTED_DOCUMENT_TYPE,
    UPLOAD_NOT_FOUND,
    UPLOAD_INVALID,
    DOCUMENT_REQUIREMENTS_INCOMPLETE,
    DOCUMENT_EXPIRED,
    DRIVER_NOT_ELIGIBLE,
    DRIVER_PROFILE_INCOMPLETE,
    DRIVER_HAS_ACTIVE_TRIP,
    DRIVER_UNAVAILABLE,
    LOCATION_REQUIRED,
    OUTSIDE_SERVICE_AREA,
    OUTSIDE_FARE_ZONES,
    PICKUP_EQUALS_DESTINATION,
    QUOTE_EXPIRED,
    QUOTE_MISMATCH,
    FARE_ADJUSTMENT_NOT_ALLOWED,
    SERVICE_CLOSED,
    ACTIVE_RIDE_EXISTS,
    NO_DRIVERS_AVAILABLE,
    OFFER_EXPIRED,
    OFFER_NOT_FOUND,
    RIDE_NOT_ACTIVE,
    TOO_FAR_FROM_PICKUP,
    CANCELLATION_NOT_ALLOWED,
    PAYMENT_ALREADY_RECORDED,
    PAYMENT_INVALID_AMOUNT,
    RATING_NOT_ALLOWED,
    RATING_ALREADY_SUBMITTED,
    PAYMENT_METHOD_UNAVAILABLE,
    /** Client-side: no network connectivity. */
    NETWORK,
    /** Client-side: request timed out. */
    TIMEOUT,
    UNKNOWN;

    public static ErrorReason fromWire(String value) {
        return Enums.parse(ErrorReason.class, value, UNKNOWN);
    }

    /** Errors where an automatic or user-triggered retry is reasonable. */
    public boolean isRetryable() {
        return this == NETWORK || this == TIMEOUT || this == SERVICE_UNAVAILABLE || this == INTERNAL || this == RATE_LIMITED;
    }
}
