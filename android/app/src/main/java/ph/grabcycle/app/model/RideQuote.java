package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;
import java.util.List;

/** Fare quote snapshot the passenger accepted. */
@IgnoreExtraProperties
public class RideQuote {
    public String quoteId;
    public long total;
    public String currency;
    public List<FareLine> lines;
    public String fareVersion;
    public boolean fareIsSample;
    public long distanceMeters;
    public String distanceSource;
    public Long durationSeconds;
    public long passengers;
}
