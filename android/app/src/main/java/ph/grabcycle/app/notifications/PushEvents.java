package ph.grabcycle.app.notifications;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;

/**
 * In-process signal that a push arrived, so visible screens can re-fetch
 * authoritative state immediately. Carries no business state itself.
 */
public final class PushEvents {
    private PushEvents() {}

    public static final class Event {
        @NonNull public final String type;
        @Nullable public final String rideId;
        public final long receivedAt;

        Event(@NonNull String type, @Nullable String rideId, long receivedAt) {
            this.type = type;
            this.rideId = rideId;
            this.receivedAt = receivedAt;
        }
    }

    private static final MutableLiveData<Event> EVENTS = new MutableLiveData<>();

    @NonNull
    public static LiveData<Event> events() {
        return EVENTS;
    }

    static void post(@NonNull String type, @Nullable String rideId) {
        EVENTS.postValue(new Event(type, rideId, System.currentTimeMillis()));
    }
}
