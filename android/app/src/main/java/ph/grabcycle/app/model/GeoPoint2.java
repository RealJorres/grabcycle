package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

/** A {lat, lng} vertex. */
@IgnoreExtraProperties
public class GeoPoint2 {
    public double lat;
    public double lng;
}
