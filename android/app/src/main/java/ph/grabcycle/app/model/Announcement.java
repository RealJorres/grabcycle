package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

@IgnoreExtraProperties
public class Announcement {
    public String id;
    public String title;
    public String body;
    public String audience;
    public boolean active;
}
