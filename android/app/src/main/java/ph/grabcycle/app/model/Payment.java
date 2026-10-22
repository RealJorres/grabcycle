package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

/** Payment record at payments/{rideId}. */
@IgnoreExtraProperties
public class Payment {
    public String rideId;
    public String status;
    public String method;
    public long amountDue;
    public Long amountCollected;
    public long discrepancy;
}
