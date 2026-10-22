package ph.grabcycle.app.model;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.ArrayList;
import java.util.List;

import ph.grabcycle.app.data.MapReader;

/** Server-computed fare estimate (getFareQuote). The app only displays it. */
public final class FareQuote {
    public String quoteId;
    public long total;
    public List<FareLine> lines = new ArrayList<>();
    public String fareVersion;
    public String fareLabel;
    public boolean fareIsSample;
    public long distanceMeters;
    /** ROUTE or STRAIGHT_LINE_ESTIMATE. */
    public String distanceSource;
    @Nullable public Long durationSeconds;
    @Nullable public String polyline;
    public long passengers;
    public long expiresAt;
    @Nullable public String notice;

    public boolean isRoadDistance() {
        return "ROUTE".equals(distanceSource);
    }

    @NonNull
    public static FareQuote from(@NonNull MapReader r) {
        FareQuote q = new FareQuote();
        q.quoteId = r.string("quoteId");
        q.total = r.getLong("total", 0);
        for (MapReader l : r.list("lines")) {
            FareLine line = new FareLine();
            line.code = l.string("code");
            line.label = l.string("label");
            line.amount = l.getLong("amount", 0);
            q.lines.add(line);
        }
        q.fareVersion = r.string("fareVersion");
        q.fareLabel = r.string("fareLabel");
        q.fareIsSample = r.getBool("fareIsSample", false);
        q.distanceMeters = r.getLong("distanceMeters", 0);
        q.distanceSource = r.string("distanceSource");
        q.durationSeconds = r.optLong("durationSeconds");
        q.polyline = r.string("polyline");
        q.passengers = r.getLong("passengers", 1);
        q.expiresAt = r.getLong("expiresAt", 0);
        q.notice = r.string("notice");
        return q;
    }
}
