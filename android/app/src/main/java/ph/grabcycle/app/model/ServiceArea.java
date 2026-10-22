package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;
import java.util.List;

/** Operator-configured service area at config/serviceArea. */
@IgnoreExtraProperties
public class ServiceArea {
    public String name;
    public List<AreaPolygon> polygons;
    public List<String> municipalities;
    public OperatingHours operatingHours;
    public boolean isSample;
}
