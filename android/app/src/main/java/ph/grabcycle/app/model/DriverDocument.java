package ph.grabcycle.app.model;

import com.google.firebase.firestore.IgnoreExtraProperties;

/** Per-requirement accreditation document state at drivers/{uid}/documents/{code}. */
@IgnoreExtraProperties
public class DriverDocument {
    public String driverUid;
    public String requirementCode;
    public String scope;
    public String label;
    public String status;
    public DocumentVersion approved;
    public DocumentVersion pending;
    public LastDecision lastDecision;
    public String approvedExpiryDate;
}
