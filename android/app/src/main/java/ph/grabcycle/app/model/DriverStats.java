package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

@IgnoreExtraProperties
public class DriverStats {
    public long completedTrips;
    public long cancelledByDriver;
    public long declinedOffers;
}
