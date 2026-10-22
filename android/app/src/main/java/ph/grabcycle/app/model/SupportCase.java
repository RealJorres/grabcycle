package ph.grabcycle.app.model;

import com.google.firebase.Timestamp;
import com.google.firebase.firestore.IgnoreExtraProperties;

/** Support case visible to its reporter. */
@IgnoreExtraProperties
public class SupportCase {
    public String caseId;
    public String rideId;
    public String category;
    public String description;
    public String status;
    public String priority;
    public String publicResponse;
    public Timestamp createdAt;
    public Timestamp updatedAt;
}
