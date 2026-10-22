package ph.grabcycle.app.model;

import com.google.firebase.Timestamp;
import com.google.firebase.firestore.IgnoreExtraProperties;

/** Server-verified fare discount entitlement. */
@IgnoreExtraProperties
public class FareDiscount {
    public String code;
    public Timestamp expiresAt;
}
