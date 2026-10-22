package ph.grabcycle.app.model;

import com.google.firebase.Timestamp;
import com.google.firebase.firestore.IgnoreExtraProperties;

/** A submitted or approved document version (file references are not used by the app). */
@IgnoreExtraProperties
public class DocumentVersion {
    public String submissionId;
    public String expiryDate;
    public String documentNumber;
    public Timestamp approvedAt;
    public Timestamp submittedAt;
}
