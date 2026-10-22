package ph.grabcycle.app.model;

import com.google.firebase.Timestamp;
import com.google.firebase.firestore.IgnoreExtraProperties;

@IgnoreExtraProperties
public class RideOffer {
    public String driverId;
    public Timestamp offeredAt;
    public Timestamp expiresAt;
    public long attempt;
}
