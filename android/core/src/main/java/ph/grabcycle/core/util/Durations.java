package ph.grabcycle.core.util;

/** Human-readable durations for real (route-based) ETAs only. */
public final class Durations {
    private Durations() {}

    /** 30 → "1 min", 540 → "9 min", 4500 → "1 hr 15 min". */
    public static String formatEta(long seconds) {
        long minutes = Math.max(1, Math.round(seconds / 60.0));
        if (minutes < 60) return minutes + " min";
        long h = minutes / 60;
        long m = minutes % 60;
        return m == 0 ? h + " hr" : h + " hr " + m + " min";
    }

    /** Remaining whole seconds until {@code expiresAtMs}, never negative. */
    public static long secondsRemaining(long expiresAtMs, long nowMs) {
        return Math.max(0, (long) Math.ceil((expiresAtMs - nowMs) / 1000.0));
    }
}
