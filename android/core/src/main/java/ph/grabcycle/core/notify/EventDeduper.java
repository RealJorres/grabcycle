package ph.grabcycle.core.notify;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Remembers recently handled push-notification event ids so duplicate
 * deliveries are ignored. Notifications are alerts only: whatever the
 * outcome here, the app re-reads authoritative state from the backend.
 */
public final class EventDeduper {
    private final Map<String, Long> seen;

    public EventDeduper(final int capacity) {
        this.seen = new LinkedHashMap<String, Long>(capacity, 0.75f, false) {
            private static final long serialVersionUID = 1L;

            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Long> eldest) {
                return size() > capacity;
            }
        };
    }

    /** Returns true the first time an event id is seen; false for duplicates or blank ids. */
    public synchronized boolean firstTime(String eventId, long nowMs) {
        if (eventId == null || eventId.isEmpty()) return false;
        if (seen.containsKey(eventId)) return false;
        seen.put(eventId, nowMs);
        return true;
    }

    /**
     * Messages older than {@code maxAgeMs} (e.g. an expired ride offer that
     * arrived late) should not interrupt the user.
     */
    public static boolean isStale(long sentAtMs, long nowMs, long maxAgeMs) {
        return sentAtMs > 0 && nowMs - sentAtMs > maxAgeMs;
    }
}
