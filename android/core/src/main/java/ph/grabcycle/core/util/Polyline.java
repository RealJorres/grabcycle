package ph.grabcycle.core.util;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Decoder for Google's encoded polyline format (route lines from the Routes API). */
public final class Polyline {
    private Polyline() {}

    /** Returns [lat, lng] pairs; an empty list for null/invalid input. */
    public static List<double[]> decode(String encoded) {
        if (encoded == null || encoded.isEmpty()) return Collections.emptyList();
        List<double[]> points = new ArrayList<>();
        int index = 0;
        int lat = 0;
        int lng = 0;
        int len = encoded.length();
        try {
            while (index < len) {
                int[] r = next(encoded, index);
                lat += r[0];
                index = r[1];
                r = next(encoded, index);
                lng += r[0];
                index = r[1];
                points.add(new double[] {lat / 1e5, lng / 1e5});
            }
        } catch (IndexOutOfBoundsException e) {
            return Collections.emptyList();
        }
        return points;
    }

    private static int[] next(String s, int index) {
        int result = 0;
        int shift = 0;
        int b;
        do {
            b = s.charAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        int delta = (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
        return new int[] {delta, index};
    }
}
