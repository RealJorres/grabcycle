package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;
import java.util.List;

@IgnoreExtraProperties
public class FinalFare {
    public long total;
    public List<FareLine> lines;
    public long waitingMinutes;
}
