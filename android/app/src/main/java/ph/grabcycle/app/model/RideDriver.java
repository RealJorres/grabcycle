package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

/** Driver identification shown to the passenger after acceptance. */
@IgnoreExtraProperties
public class RideDriver {
    public String displayName;
    public String photoPath;
    public String plateNumber;
    public String bodyNumber;
    public String vehicleDescription;
    public Double ratingAvg;
}
