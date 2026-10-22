package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

@IgnoreExtraProperties
public class OperatingHours {
    public boolean enabled;
    public long startHour;
    public long endHour;
}
