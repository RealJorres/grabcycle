package ph.grabcycle.app.model;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import ph.grabcycle.app.data.MapReader;

/** Response of setDriverAvailability. The session id authorizes location publishing. */
public final class AvailabilityResult {
    public String availability;
    @Nullable public String sessionId;
    public long locationUpdateIntervalSec = 5;
    public long locationFreshnessSec = 30;
    public long maxLocationAccuracyM = 100;

    @NonNull
    public static AvailabilityResult from(@NonNull MapReader r) {
        AvailabilityResult a = new AvailabilityResult();
        a.availability = r.string("availability");
        a.sessionId = r.string("sessionId");
        a.locationUpdateIntervalSec = r.getLong("locationUpdateIntervalSec", 5);
        a.locationFreshnessSec = r.getLong("locationFreshnessSec", 30);
        a.maxLocationAccuracyM = r.getLong("maxLocationAccuracyM", 100);
        return a;
    }
}
