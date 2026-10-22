package ph.grabcycle.core.location;

/**
 * Classifies a device location fix for display and for deciding whether a
 * driver update is worth publishing. Thresholds come from server config.
 */
public enum LocationQuality {
    GOOD,
    FAIR,
    POOR,
    STALE,
    NONE;

    public static LocationQuality evaluate(Float accuracyM, Long ageMs, int maxAccuracyM, int freshnessSec) {
        if (accuracyM == null || ageMs == null) return NONE;
        if (ageMs > freshnessSec * 1000L) return STALE;
        if (accuracyM > maxAccuracyM) return POOR;
        return accuracyM <= maxAccuracyM / 2f ? GOOD : FAIR;
    }

    /** Only GOOD/FAIR fixes are published; the server applies the same thresholds. */
    public boolean publishable() {
        return this == GOOD || this == FAIR;
    }
}
