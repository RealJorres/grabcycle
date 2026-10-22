package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

/** Location and matching parameters at config/matching (defaults mirror the backend). */
@IgnoreExtraProperties
public class MatchingConfig {
    public long locationUpdateIntervalSec = 5;
    public long locationFreshnessSec = 30;
    public long maxLocationAccuracyM = 100;
    public long offerTimeoutSec = 20;
    public long searchTimeoutSec = 180;
    public long initialRadiusM = 2000;
    public long maxRadiusM = 5000;
}
