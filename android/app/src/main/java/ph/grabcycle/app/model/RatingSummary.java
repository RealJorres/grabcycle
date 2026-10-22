package ph.grabcycle.app.model;

import androidx.annotation.Nullable;

import com.google.firebase.firestore.Exclude;
import com.google.firebase.firestore.IgnoreExtraProperties;

/** Aggregate of legitimate post-trip ratings. */
@IgnoreExtraProperties
public class RatingSummary {
    public long count;
    public long sum;

    /** Average rounded to one decimal, or null until enough ratings exist to be meaningful. */
    @Exclude
    @Nullable
    public Double averageIfAtLeast(int minCount) {
        if (count < minCount || count == 0) return null;
        return Math.round((sum / (double) count) * 10) / 10.0;
    }
}
