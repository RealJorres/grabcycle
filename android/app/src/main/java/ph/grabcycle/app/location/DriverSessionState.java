package ph.grabcycle.app.location;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;

import ph.grabcycle.core.location.LocationQuality;

/**
 * Process-wide status of driver location sharing, observed by the driver
 * home screen to show connection and GPS quality honestly.
 */
public final class DriverSessionState {
    private DriverSessionState() {}

    public static final class Status {
        public final boolean running;
        public final boolean connected;
        @NonNull public final LocationQuality quality;
        public final long lastPublishedAt;
        @Nullable public final Float lastAccuracy;
        /** Set when the server revoked publishing (went offline, suspended, session ended). */
        public final boolean revoked;

        Status(boolean running, boolean connected, @NonNull LocationQuality quality, long lastPublishedAt, @Nullable Float lastAccuracy, boolean revoked) {
            this.running = running;
            this.connected = connected;
            this.quality = quality;
            this.lastPublishedAt = lastPublishedAt;
            this.lastAccuracy = lastAccuracy;
            this.revoked = revoked;
        }
    }

    private static final MutableLiveData<Status> STATUS =
            new MutableLiveData<>(new Status(false, false, LocationQuality.NONE, 0, null, false));

    @NonNull
    public static LiveData<Status> status() {
        return STATUS;
    }

    static void post(boolean running, boolean connected, @NonNull LocationQuality quality, long lastPublishedAt, @Nullable Float accuracy, boolean revoked) {
        STATUS.postValue(new Status(running, connected, quality, lastPublishedAt, accuracy, revoked));
    }
}
