package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;
import java.util.List;

/** Operator-configured document requirements at config/documentPolicy. */
@IgnoreExtraProperties
public class DocumentPolicy {
    public List<PassengerIdType> passengerIdTypes;
    public List<DriverRequirement> driverRequirements;
    public Long passengerApprovalValidityDays;
    public long maxUploadBytes;
    public String privacyNoticeVersion;
    public boolean isSample;
}
