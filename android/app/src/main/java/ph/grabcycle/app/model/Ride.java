package ph.grabcycle.app.model;

import com.google.firebase.Timestamp;
import com.google.firebase.firestore.IgnoreExtraProperties;

/** Ride at rides/{rideId}. The backend is authoritative for every field. */
@IgnoreExtraProperties
public class Ride {
    public String rideId;
    public String requestId;
    public String passengerUid;
    public String driverUid;
    public String status;
    public String statusReason;
    public String mode;
    public boolean allowFallback;
    public String selectedDriverId;
    public RidePlace pickup;
    public RidePlace destination;
    public RideQuote quote;
    public RideOffer offer;
    public Timestamp searchDeadline;
    public RidePassenger passenger;
    public RideDriver driver;
    public Long driverEtaSeconds;
    public FinalFare finalFare;
    public RidePayment payment;
    public Cancellation cancellation;
    public Rated rated;
    public Boolean arrivalVerified;
    public Timestamp requestedAt;
    public Timestamp acceptedAt;
    public Timestamp enRouteAt;
    public Timestamp arrivedAt;
    public Timestamp startedAt;
    public Timestamp completedAt;
    public Timestamp cancelledAt;
    public Timestamp endedAt;
    public Timestamp updatedAt;
}
