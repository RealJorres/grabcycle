package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

@IgnoreExtraProperties
public class NumberField {
    public String label;
    public String pattern;
    public boolean required;
}
