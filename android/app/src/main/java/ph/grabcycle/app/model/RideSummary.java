package ph.grabcycle.app.model;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import ph.grabcycle.app.data.MapReader;

/** Authoritative booking result returned by createRide / refreshRide. */
public final class RideSummary {
    public String rideId;
    public String status;
    @Nullable public String statusReason;
    @Nullable public Long offerExpiresAt;

    @NonNull
    public static RideSummary from(@NonNull MapReader r) {
        RideSummary s = new RideSummary();
        s.rideId = r.string("rideId");
        s.status = r.string("status");
        s.statusReason = r.string("statusReason");
        s.offerExpiresAt = r.optLong("offerExpiresAt");
        return s;
    }
}
