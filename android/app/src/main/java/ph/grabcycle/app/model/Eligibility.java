package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;
import java.util.List;

/** Server-computed availability eligibility. */
@IgnoreExtraProperties
public class Eligibility {
    public boolean eligible;
    public List<String> reasons;
    public Long validUntil;
}
