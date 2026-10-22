package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

@IgnoreExtraProperties
public class Cancellation {
    public String by;
    public String reasonCode;
    public String note;
    public long feeApplied;
}
