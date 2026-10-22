package ph.grabcycle.app.model;

import com.google.firebase.Timestamp;
import com.google.firebase.firestore.IgnoreExtraProperties;

/** Passenger-visible verification summary (no reviewer notes, no document references). */
@IgnoreExtraProperties
public class PassengerVerificationState {
    public String status;
    public String caseId;
    public Long validUntil;
    public String publicMessage;
    public Timestamp submittedAt;
    public Timestamp updatedAt;
}
