package ph.grabcycle.core.util;

import java.util.Locale;

/** Small geographic helpers used for display. Matching distances are computed on the server. */
public final class GeoMath {
    private GeoMath() {}

    private static final double EARTH_RADIUS_M = 6_371_008.8;

    public static double distanceMeters(double lat1, double lng1, double lat2, double lng2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
    }

    /** "350 m", "1.2 km", "12 km". */
    public static String formatDistance(double meters) {
        if (meters < 0 || Double.isNaN(meters)) return "—";
        if (meters < 1000) return Math.max(10, Math.round(meters / 10) * 10) + " m";
        double km = meters / 1000.0;
        return km < 10 ? String.format(Locale.US, "%.1f km", km) : Math.round(km) + " km";
    }

    public static boolean isValid(double lat, double lng) {
        return !Double.isNaN(lat) && !Double.isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    }
}
