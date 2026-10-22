package ph.grabcycle.app.model;

import com.google.firebase.Timestamp;
import com.google.firebase.firestore.IgnoreExtraProperties;
import java.util.Map;

/** Driver operational and accreditation record at drivers/{uid}. Written only by the backend. */
@IgnoreExtraProperties
public class DriverProfile {
    public String uid;
    public String displayName;
    public String firstName;
    public String status;
    public boolean everApproved;
    public Timestamp applicationSubmittedAt;
    public String accountStatus;
    public DriverProfileInfo profile;
    public VehicleInfo vehicle;
    public String availability;
    public String currentOfferRideId;
    public String currentRideId;
    public String presenceSessionId;
    public Eligibility eligibility;
    public Map<String, String> documentsSummary;
    public PublicProfile publicProfile;
    public RatingSummary ratingSummary;
    public DriverStats stats;
    public Decision decision;
}
