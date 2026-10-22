package ph.grabcycle.core.util;

/**
 * Standard base32 geohash encoder. Drivers publish a geohash with each
 * location so the backend can run range queries for nearby-driver discovery.
 */
public final class GeoHash {
    private GeoHash() {}

    private static final char[] BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz".toCharArray();

    public static String encode(double lat, double lng, int precision) {
        if (precision < 1 || precision > 22) throw new IllegalArgumentException("precision");
        if (!GeoMath.isValid(lat, lng)) throw new IllegalArgumentException("coordinates");
        double[] latRange = {-90.0, 90.0};
        double[] lngRange = {-180.0, 180.0};
        StringBuilder hash = new StringBuilder(precision);
        boolean evenBit = true;
        int bit = 0;
        int ch = 0;
        while (hash.length() < precision) {
            if (evenBit) {
                double mid = (lngRange[0] + lngRange[1]) / 2;
                if (lng >= mid) {
                    ch = (ch << 1) | 1;
                    lngRange[0] = mid;
                } else {
                    ch = ch << 1;
                    lngRange[1] = mid;
                }
            } else {
                double mid = (latRange[0] + latRange[1]) / 2;
                if (lat >= mid) {
                    ch = (ch << 1) | 1;
                    latRange[0] = mid;
                } else {
                    ch = ch << 1;
                    latRange[1] = mid;
                }
            }
            evenBit = !evenBit;
            if (++bit == 5) {
                hash.append(BASE32[ch]);
                bit = 0;
                ch = 0;
            }
        }
        return hash.toString();
    }
}
