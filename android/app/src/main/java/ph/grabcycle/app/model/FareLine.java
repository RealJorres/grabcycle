package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

/** One line of a fare breakdown (amount in centavos). */
@IgnoreExtraProperties
public class FareLine {
    public String code;
    public String label;
    public long amount;
}
