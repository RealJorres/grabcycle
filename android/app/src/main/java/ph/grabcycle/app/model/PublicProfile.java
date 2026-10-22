package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

/** Driver details passengers may see. */
@IgnoreExtraProperties
public class PublicProfile {
    public String displayName;
    public String photoPath;
    public String vehicleSummary;
}
