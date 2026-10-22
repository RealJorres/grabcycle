package ph.grabcycle.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;
import ph.grabcycle.core.util.Durations;
import ph.grabcycle.core.util.GeoHash;
import ph.grabcycle.core.util.GeoMath;
import ph.grabcycle.core.util.Polyline;

class GeoTest {

    @Test
    void geohashMatchesReferenceVectors() {
        assertEquals("u4pruydqqvj", GeoHash.encode(57.64911, 10.40744, 11));
        assertEquals("wdq", GeoHash.encode(13.4467, 121.8406, 3));
        assertEquals(10, GeoHash.encode(13.4467, 121.8406, 10).length());
        assertThrows(IllegalArgumentException.class, () -> GeoHash.encode(91, 0, 5));
    }

    @Test
    void decodesGooglePolylineReference() {
        List<double[]> pts = Polyline.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
        assertEquals(3, pts.size());
        assertEquals(38.5, pts.get(0)[0], 1e-9);
        assertEquals(-120.2, pts.get(0)[1], 1e-9);
        assertEquals(40.7, pts.get(1)[0], 1e-9);
        assertEquals(-120.95, pts.get(1)[1], 1e-9);
        assertEquals(43.252, pts.get(2)[0], 1e-9);
        assertEquals(-126.453, pts.get(2)[1], 1e-9);
        assertTrue(Polyline.decode("").isEmpty());
        assertTrue(Polyline.decode(null).isEmpty());
        assertTrue(Polyline.decode("_p~iF~ps|U_").isEmpty(), "truncated input is rejected");
    }

    @Test
    void distancesAndFormatting() {
        double d = GeoMath.distanceMeters(13.4467, 121.8406, 13.4557, 121.8406);
        assertTrue(d > 990 && d < 1010);
        assertEquals("350 m", GeoMath.formatDistance(347));
        assertEquals("1.2 km", GeoMath.formatDistance(1234));
        assertEquals("12 km", GeoMath.formatDistance(12_340));
        assertEquals("—", GeoMath.formatDistance(-1));
    }

    @Test
    void etasAndCountdowns() {
        assertEquals("1 min", Durations.formatEta(20));
        assertEquals("9 min", Durations.formatEta(540));
        assertEquals("1 hr 15 min", Durations.formatEta(4500));
        assertEquals("2 hr", Durations.formatEta(7200));
        assertEquals(20, Durations.secondsRemaining(1_020_000, 1_000_000));
        assertEquals(1, Durations.secondsRemaining(1_000_200, 1_000_000));
        assertEquals(0, Durations.secondsRemaining(1_000_000, 1_005_000));
    }
}
