package ph.grabcycle.app.model;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import ph.grabcycle.app.data.MapReader;

/**
 * Contract tests: payloads mirror what the Cloud Functions return (see
 * backend services/quotes.ts, discovery.ts, rides.ts, availability.ts), and
 * malformed values must degrade to safe defaults instead of crashing.
 */
public class CallableParsersTest {

    private static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @Test
    public void mapReaderToleratesWrongTypesAndMissingValues() {
        MapReader r = new MapReader(map("s", 5, "n", "x", "b", "true", "list", "nope", "child", 3));
        assertNull(r.string("s"));
        assertEquals(7, r.getLong("n", 7));
        assertFalse(r.getBool("b", false));
        assertTrue(r.list("list").isEmpty());
        assertFalse(r.child("child").has("anything"));
        assertNull(new MapReader(null).string("x"));
        // Firebase delivers JSON numbers as Integer, Long or Double.
        assertEquals(12, new MapReader(map("v", 12.0)).getLong("v", 0));
    }

    @Test
    public void fareQuoteParsesServerQuote() {
        Map<String, Object> payload = map(
                "quoteId", "q1",
                "total", 4500,
                "currency", "PHP",
                "lines", Arrays.asList(map("code", "BASE", "label", "Base fare", "amount", 3000),
                        map("code", "DISTANCE", "label", "Distance", "amount", 1500)),
                "fareVersion", "v3",
                "fareLabel", "Sample rates",
                "fareIsSample", true,
                "distanceMeters", 2300,
                "distanceSource", "STRAIGHT_LINE_ESTIMATE",
                "durationSeconds", null,
                "polyline", null,
                "passengers", 2,
                "expiresAt", 1_800_000_000_000L,
                "notice", "Road distance is unavailable right now.");
        FareQuote q = FareQuote.from(new MapReader(payload));
        assertEquals("q1", q.quoteId);
        assertEquals(4500, q.total);
        assertEquals(2, q.lines.size());
        assertEquals("Distance", q.lines.get(1).label);
        assertTrue(q.fareIsSample);
        assertFalse(q.isRoadDistance());
        assertNull(q.durationSeconds);
        assertEquals(2, q.passengers);
        assertEquals(1_800_000_000_000L, q.expiresAt);
    }

    @Test
    public void nearbyDriversSkipsEntriesWithoutIdAndKeepsCoarseLocation() {
        Map<String, Object> payload = map(
                "drivers", Arrays.asList(
                        map("driverId", "d1", "displayName", "Pedro S.", "photoPath", null, "vehicleSummary", "Red Honda tricycle",
                                "approxLocation", map("lat", 13.447, "lng", 121.841), "distanceMeters", 400, "distanceKind", "STRAIGHT_LINE",
                                "ratingAverage", 4.8, "ratingCount", 12, "locationAgeSec", 4),
                        map("displayName", "No id")),
                "radiusMeters", 2000,
                "maxRadiusReached", false,
                "generatedAt", 1_700_000_000_000L,
                "refreshAfterSec", 15);
        NearbyDriver.Result res = NearbyDriver.parse(new MapReader(payload));
        assertEquals(1, res.drivers.size());
        NearbyDriver d = res.drivers.get(0);
        assertEquals("d1", d.driverId);
        assertEquals(13.447, d.approxLat, 1e-9);
        assertEquals(Double.valueOf(4.8), d.ratingAverage);
        assertEquals(Long.valueOf(12), d.ratingCount);
        assertEquals(2000, res.radiusMeters);
        assertEquals(15, res.refreshAfterSec);
    }

    @Test
    public void nearbyDriversHidesRatingsBelowThreshold() {
        Map<String, Object> payload = map("drivers", List.of(map("driverId", "d2", "ratingAverage", null, "ratingCount", null)));
        NearbyDriver d = NearbyDriver.parse(new MapReader(payload)).drivers.get(0);
        assertNull(d.ratingAverage);
        assertNull(d.ratingCount);
    }

    @Test
    public void rideSummaryAndAvailabilityParse() {
        RideSummary s = RideSummary.from(new MapReader(map("rideId", "r1", "status", "NO_DRIVER_FOUND", "statusReason", "SELECTED_DRIVER_UNAVAILABLE")));
        assertEquals("r1", s.rideId);
        assertEquals("SELECTED_DRIVER_UNAVAILABLE", s.statusReason);
        assertNull(s.offerExpiresAt);

        AvailabilityResult a = AvailabilityResult.from(new MapReader(map("availability", "ONLINE", "sessionId", "abc123",
                "locationUpdateIntervalSec", 4, "locationFreshnessSec", 20, "maxLocationAccuracyM", 50)));
        assertEquals("abc123", a.sessionId);
        assertEquals(4, a.locationUpdateIntervalSec);
        assertEquals(50, a.maxLocationAccuracyM);

        AvailabilityResult offline = AvailabilityResult.from(new MapReader(map("availability", "OFFLINE")));
        assertNull(offline.sessionId);
        assertEquals(5, offline.locationUpdateIntervalSec);
    }
}
