package ph.grabcycle.app.ui.common;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.StringRes;

import ph.grabcycle.app.R;
import ph.grabcycle.app.data.AppException;
import ph.grabcycle.core.model.ErrorReason;

/** Maps backend error reasons to clear, localized messages (never raw stack traces). */
public final class ErrorMessages {
    private ErrorMessages() {}

    @NonNull
    public static String of(@NonNull Context c, @Nullable Throwable error) {
        AppException e = AppException.from(error);
        return c.getString(resFor(e.getReason()));
    }

    @StringRes
    public static int resFor(@NonNull ErrorReason reason) {
        switch (reason) {
            case NETWORK: return R.string.err_network;
            case TIMEOUT: return R.string.err_timeout;
            case UNAUTHENTICATED: return R.string.err_unauthenticated;
            case PERMISSION_DENIED: return R.string.err_permission_denied;
            case RATE_LIMITED: return R.string.err_rate_limited;
            case SERVICE_UNAVAILABLE: return R.string.err_service_unavailable;
            case INVALID_ARGUMENT: return R.string.err_invalid_argument;
            case NOT_FOUND: return R.string.err_not_found;
            case INVALID_STATE_TRANSITION: return R.string.err_state_changed;
            case ACCOUNT_NOT_REGISTERED: return R.string.err_account_not_registered;
            case ACCOUNT_ALREADY_REGISTERED: return R.string.err_account_already_registered;
            case ACCOUNT_TYPE_MISMATCH: return R.string.err_account_type_mismatch;
            case ACCOUNT_SUSPENDED: return R.string.err_account_suspended;
            case PHONE_NOT_VERIFIED: return R.string.err_phone_not_verified;
            case CONSENT_REQUIRED: return R.string.err_consent_required;
            case PASSENGER_NOT_VERIFIED: return R.string.err_passenger_not_verified;
            case VERIFICATION_ALREADY_PENDING: return R.string.err_verification_pending;
            case VERIFICATION_NOT_ALLOWED: return R.string.err_verification_not_allowed;
            case UNSUPPORTED_DOCUMENT_TYPE: return R.string.err_unsupported_document;
            case UPLOAD_NOT_FOUND: return R.string.err_upload_not_found;
            case UPLOAD_INVALID: return R.string.err_upload_invalid;
            case DOCUMENT_REQUIREMENTS_INCOMPLETE: return R.string.err_documents_incomplete;
            case DOCUMENT_EXPIRED: return R.string.err_document_expired;
            case DRIVER_NOT_ELIGIBLE: return R.string.err_driver_not_eligible;
            case DRIVER_PROFILE_INCOMPLETE: return R.string.err_driver_profile_incomplete;
            case DRIVER_HAS_ACTIVE_TRIP: return R.string.err_driver_active_trip;
            case DRIVER_UNAVAILABLE: return R.string.err_driver_unavailable;
            case LOCATION_REQUIRED: return R.string.err_location_required;
            case OUTSIDE_SERVICE_AREA: return R.string.err_outside_service_area;
            case OUTSIDE_FARE_ZONES: return R.string.err_outside_fare_zones;
            case PICKUP_EQUALS_DESTINATION: return R.string.err_pickup_equals_destination;
            case QUOTE_EXPIRED: return R.string.err_quote_expired;
            case QUOTE_MISMATCH: return R.string.err_quote_mismatch;
            case SERVICE_CLOSED: return R.string.err_service_closed;
            case ACTIVE_RIDE_EXISTS: return R.string.err_active_ride_exists;
            case NO_DRIVERS_AVAILABLE: return R.string.err_no_drivers;
            case OFFER_EXPIRED: return R.string.err_offer_expired;
            case OFFER_NOT_FOUND: return R.string.err_offer_not_found;
            case RIDE_NOT_ACTIVE: return R.string.err_ride_not_active;
            case TOO_FAR_FROM_PICKUP: return R.string.err_too_far_from_pickup;
            case CANCELLATION_NOT_ALLOWED: return R.string.err_cancellation_not_allowed;
            case PAYMENT_ALREADY_RECORDED: return R.string.err_payment_recorded;
            case PAYMENT_INVALID_AMOUNT: return R.string.err_payment_amount;
            case RATING_NOT_ALLOWED: return R.string.err_rating_not_allowed;
            case RATING_ALREADY_SUBMITTED: return R.string.err_rating_submitted;
            case FARE_ADJUSTMENT_NOT_ALLOWED:
            case PAYMENT_METHOD_UNAVAILABLE:
            case INTERNAL:
            case UNKNOWN:
            default:
                return R.string.err_generic;
        }
    }
}
