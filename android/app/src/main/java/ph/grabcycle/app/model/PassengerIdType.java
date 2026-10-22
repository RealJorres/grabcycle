package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;
import java.util.List;

@IgnoreExtraProperties
public class PassengerIdType {
    public String code;
    public String label;
    public List<String> sides;
    public boolean hasExpiry;
    public boolean active;
}
