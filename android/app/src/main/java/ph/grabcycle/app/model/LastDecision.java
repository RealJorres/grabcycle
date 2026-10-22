package ph.grabcycle.app.model;

import com.google.firebase.Timestamp;
import com.google.firebase.firestore.IgnoreExtraProperties;

@IgnoreExtraProperties
public class LastDecision {
    public String decision;
    public String reasonCode;
    public String publicMessage;
    public Timestamp decidedAt;
}
