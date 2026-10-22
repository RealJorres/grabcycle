package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;
import java.util.List;

@IgnoreExtraProperties
public class AreaPolygon {
    public String name;
    public List<GeoPoint2> points;
}
