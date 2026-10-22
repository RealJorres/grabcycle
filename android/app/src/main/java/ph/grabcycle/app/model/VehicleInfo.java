package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

/** Registered tricycle details and review state. */
@IgnoreExtraProperties
public class VehicleInfo {
    public String plateNumber;
    public String bodyNumber;
    public String make;
    public String model;
    public String color;
    public long capacity;
    public String franchiseMunicipality;
    public String status;
    public String publicMessage;
}
