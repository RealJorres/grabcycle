package ph.grabcycle.app.model;

import com.google.firebase.Timestamp;
import com.google.firebase.firestore.IgnoreExtraProperties;

/** Account suspension notice. */
@IgnoreExtraProperties
public class Suspension {
    public String reasonCode;
    public String publicMessage;
    public Timestamp at;
}
