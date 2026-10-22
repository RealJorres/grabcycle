package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;
import java.util.List;

/** General app settings at config/app. */
@IgnoreExtraProperties
public class AppSettings {
    public List<Announcement> announcements;
    public String supportPhone;
    public String supportEmail;
    public String emergencyHotline;
    public long minAndroidVersionCode;
    public boolean maintenanceMode;
}
