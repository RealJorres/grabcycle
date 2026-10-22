package ph.grabcycle.app.ui.ride;

import androidx.annotation.NonNull;
import androidx.annotation.StringRes;

import ph.grabcycle.app.R;
import ph.grabcycle.core.model.RideStatus;

/** Human labels for ride timeline events and terminal reasons. */
public final class RideTexts {
    private RideTexts() {}

    @StringRes
    public static int eventLabel(@NonNull String type) {
        switch (type) {
            case "REQUESTED": return R.string.event_requested;
            case "OFFER_SENT": return R.string.event_offer_sent;
            case "OFFER_DECLINED": return R.string.event_offer_declined;
            case "OFFER_EXPIRED": return R.string.event_offer_expired;
            case "ACCEPTED": return R.string.event_accepted;
            case "DRIVER_EN_ROUTE": return R.string.event_en_route;
            case "DRIVER_ARRIVED": return R.string.event_arrived;
            case "IN_PROGRESS": return R.string.event_started;
            case "COMPLETED": return R.string.event_completed;
            case "CANCELLED_BY_PASSENGER": return R.string.event_cancelled_passenger;
            case "CANCELLED_BY_DRIVER": return R.string.event_cancelled_driver;
            case "CANCELLED_BY_ADMIN": return R.string.event_cancelled_admin;
            case "NO_DRIVER_FOUND": return R.string.event_no_driver;
            case "EXPIRED": return R.string.event_expired;
            default: return R.string.event_update;
        }
    }

    /** Explanation for a ride that ended without a trip. */
    @StringRes
    public static int endedMessage(@NonNull RideStatus status, String reason) {
        if (status == RideStatus.NO_DRIVER_FOUND) {
            if ("SELECTED_DRIVER_DECLINED".equals(reason)) return R.string.ride_ended_selected_declined;
            if ("SELECTED_DRIVER_DID_NOT_RESPOND".equals(reason)) return R.string.ride_ended_selected_timeout;
            if ("SELECTED_DRIVER_UNAVAILABLE".equals(reason)) return R.string.ride_ended_selected_unavailable;
            return R.string.ride_ended_no_driver;
        }
        if (status == RideStatus.EXPIRED) return R.string.ride_ended_expired;
        if (status == RideStatus.CANCELLED_BY_DRIVER) return R.string.ride_ended_driver_cancelled;
        if (status == RideStatus.CANCELLED_BY_ADMIN) return R.string.ride_ended_admin_cancelled;
        return R.string.ride_ended_cancelled;
    }
}
