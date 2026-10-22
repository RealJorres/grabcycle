package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

/** Operating policies at config/policies (subset used by the app). */
@IgnoreExtraProperties
public class PoliciesConfig {
    public CancellationPolicy cancellation = new CancellationPolicy();
    public RatingPolicy ratings = new RatingPolicy();
    public Terms terms = new Terms();

    @IgnoreExtraProperties
    public static class CancellationPolicy {
        public boolean passengerFeeEnabled;
        public long passengerFee;
        public long passengerFeeAfterAcceptMinutes;
        public long driverNoShowWaitMinutes = 5;
    }

    @IgnoreExtraProperties
    public static class RatingPolicy {
        public long minRatingsToDisplay = 5;
        public long ratingWindowDays = 7;
    }

    @IgnoreExtraProperties
    public static class Terms {
        public String termsVersion;
        public String privacyNoticeVersion;
    }
}
