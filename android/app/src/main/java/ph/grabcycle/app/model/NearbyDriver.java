package ph.grabcycle.app.model;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.ArrayList;
import java.util.List;

import ph.grabcycle.app.data.MapReader;

/** One eligible driver from nearby discovery. Positions are coarse (~100 m) by design. */
public final class NearbyDriver {
    public String driverId;
    public String displayName;
    @Nullable public String photoPath;
    public String vehicleSummary;
    public double approxLat;
    public double approxLng;
    /** Rounded straight-line distance (not road distance). */
    public long distanceMeters;
    @Nullable public Double ratingAverage;
    @Nullable public Long ratingCount;
    public long locationAgeSec;

    public static final class Result {
        public List<NearbyDriver> drivers = new ArrayList<>();
        public long radiusMeters;
        public boolean maxRadiusReached;
        public long refreshAfterSec = 10;
        public long generatedAt;
    }

    @NonNull
    public static Result parse(@NonNull MapReader r) {
        Result res = new Result();
        for (MapReader d : r.list("drivers")) {
            NearbyDriver n = new NearbyDriver();
            n.driverId = d.string("driverId");
            n.displayName = d.string("displayName");
            n.photoPath = d.string("photoPath");
            n.vehicleSummary = d.string("vehicleSummary");
            n.approxLat = d.child("approxLocation").getDouble("lat", 0);
            n.approxLng = d.child("approxLocation").getDouble("lng", 0);
            n.distanceMeters = d.getLong("distanceMeters", 0);
            n.ratingAverage = d.optDouble("ratingAverage");
            n.ratingCount = d.optLong("ratingCount");
            n.locationAgeSec = d.getLong("locationAgeSec", 0);
            if (n.driverId != null) res.drivers.add(n);
        }
        res.radiusMeters = r.getLong("radiusMeters", 0);
        res.maxRadiusReached = r.getBool("maxRadiusReached", false);
        res.refreshAfterSec = r.getLong("refreshAfterSec", 10);
        res.generatedAt = r.getLong("generatedAt", 0);
        return res;
    }
}
