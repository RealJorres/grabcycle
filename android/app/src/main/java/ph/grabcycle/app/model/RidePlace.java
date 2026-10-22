package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

@IgnoreExtraProperties
public class RidePlace {
    public double lat;
    public double lng;
    public String address;
    public String placeId;
    public String note;
}
