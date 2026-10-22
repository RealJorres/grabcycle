package ph.grabcycle.app.model;

import com.google.firebase.Timestamp;
import com.google.firebase.firestore.IgnoreExtraProperties;

/** Immutable ride timeline entry. */
@IgnoreExtraProperties
public class RideEvent {
    public String type;
    public String from;
    public String to;
    public String actor;
    public Timestamp at;
}
