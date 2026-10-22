package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

/** Trusted contact the passenger can message from the trip screen. */
@IgnoreExtraProperties
public class EmergencyContact {
    public String name;
    public String phone;
}
