package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

/** Participant phone numbers; readable only while the trip is active. */
@IgnoreExtraProperties
public class RideContact {
    public String passengerFirstName;
    public String passengerPhone;
    public String driverName;
    public String driverPhone;
}
