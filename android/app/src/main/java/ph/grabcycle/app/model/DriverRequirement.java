package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;
import java.util.List;

@IgnoreExtraProperties
public class DriverRequirement {
    public String code;
    public String label;
    public String description;
    public String scope;
    public boolean mandatory;
    public List<String> sides;
    public boolean hasExpiry;
    public NumberField numberField;
    public boolean publishAsProfilePhoto;
    public String regulatoryNote;
    public boolean active;
}
