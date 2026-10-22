package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

/** Account profile at users/{uid}. Written only by the backend. */
@IgnoreExtraProperties
public class UserProfile {
    public String uid;
    public String accountType;
    public String status;
    public String displayName;
    public String firstName;
    public String phoneNumber;
    public String locale;
    public PassengerVerificationState passengerVerification;
    public String activeRideId;
    public EmergencyContact emergencyContact;
    public FareDiscount fareDiscount;
    public RatingSummary ratingSummary;
    public Suspension suspension;
}
