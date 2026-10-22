package ph.grabcycle.app.model;

import com.google.firebase.Timestamp;
import com.google.firebase.firestore.IgnoreExtraProperties;

/** Latest reviewer decision on the driver account. */
@IgnoreExtraProperties
public class Decision {
    public String decision;
    public String reasonCode;
    public String publicMessage;
    public Timestamp decidedAt;
}
