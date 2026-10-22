package ph.grabcycle.app.data;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.lifecycle.LiveData;

import com.google.android.gms.tasks.Task;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.Query;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import ph.grabcycle.app.model.FareQuote;
import ph.grabcycle.app.model.NearbyDriver;
import ph.grabcycle.app.model.Payment;
import ph.grabcycle.app.model.Ride;
import ph.grabcycle.app.model.RideContact;
import ph.grabcycle.app.model.RideEvent;
import ph.grabcycle.app.model.RideSummary;
import ph.grabcycle.app.model.SelectedPlace;

/**
 * Fare quotes, discovery and the ride lifecycle. Every state change is a
 * backend request; the ride document listener is the single source of truth
 * the UI renders.
 */
public final class RideRepository {
    private static RideRepository instance;
    private final FirebaseFirestore db = FirebaseFirestore.getInstance();
    private final FunctionsClient functions = FunctionsClient.get();

    private RideRepository() {}

    public static synchronized RideRepository get() {
        if (instance == null) instance = new RideRepository();
        return instance;
    }

    // ---- Quotes & discovery ------------------------------------------------

    @NonNull
    public Task<FareQuote> quote(@NonNull SelectedPlace pickup, @NonNull SelectedPlace destination, int passengers) {
        Map<String, Object> p = new HashMap<>();
        p.put("pickup", pickup.toPayload());
        p.put("destination", destination.toPayload());
        p.put("passengers", passengers);
        return functions.call("getFareQuote", p, FareQuote::from);
    }

    @NonNull
    public Task<NearbyDriver.Result> nearbyDrivers(double lat, double lng, boolean expand) {
        Map<String, Object> pickup = new HashMap<>();
        pickup.put("lat", lat);
        pickup.put("lng", lng);
        Map<String, Object> p = new HashMap<>();
        p.put("pickup", pickup);
        p.put("expand", expand);
        return functions.call("findNearbyDrivers", p, NearbyDriver::parse);
    }

    // ---- Booking -----------------------------------------------------------

    /**
     * Books a ride. {@code requestId} is the idempotency key for this booking
     * intent: retries after a timeout MUST reuse it so the server returns the
     * same ride instead of creating another.
     */
    @NonNull
    public Task<RideSummary> createRide(@NonNull String requestId, @NonNull String quoteId, @Nullable String selectedDriverId,
                                        boolean allowFallback, @Nullable String pickupNote) {
        Map<String, Object> p = new HashMap<>();
        p.put("requestId", requestId);
        p.put("quoteId", quoteId);
        p.put("selectedDriverId", selectedDriverId);
        p.put("allowFallback", allowFallback);
        p.put("pickupNote", pickupNote);
        return functions.call("createRide", p, RideSummary::from);
    }

    @NonNull
    public Task<RideSummary> refresh(@NonNull String rideId) {
        Map<String, Object> p = new HashMap<>();
        p.put("rideId", rideId);
        return functions.call("refreshRide", p, RideSummary::from);
    }

    @NonNull
    public Task<MapReader> cancel(@NonNull String rideId, @NonNull String reasonCode, @Nullable String note) {
        Map<String, Object> p = new HashMap<>();
        p.put("rideId", rideId);
        p.put("reasonCode", reasonCode);
        p.put("note", note);
        return functions.call("cancelRide", p);
    }

    // ---- Driver actions ----------------------------------------------------

    @NonNull
    public Task<MapReader> respondToOffer(@NonNull String rideId, boolean accept, @Nullable String declineReason) {
        Map<String, Object> p = new HashMap<>();
        p.put("rideId", rideId);
        p.put("accept", accept);
        p.put("declineReason", declineReason);
        return functions.call("respondToOffer", p);
    }

    @NonNull
    public Task<MapReader> updateProgress(@NonNull String rideId, @NonNull String action) {
        Map<String, Object> p = new HashMap<>();
        p.put("rideId", rideId);
        p.put("action", action);
        return functions.call("updateRideProgress", p);
    }

    @NonNull
    public Task<MapReader> complete(@NonNull String rideId, @Nullable Long cashCollectedCentavos) {
        Map<String, Object> p = new HashMap<>();
        p.put("rideId", rideId);
        p.put("cashCollected", cashCollectedCentavos);
        p.put("adjustments", new ArrayList<>());
        return functions.call("completeRide", p);
    }

    @NonNull
    public Task<MapReader> recordCash(@NonNull String rideId, long amountCentavos) {
        Map<String, Object> p = new HashMap<>();
        p.put("rideId", rideId);
        p.put("amountCollected", amountCentavos);
        return functions.call("recordCashPayment", p);
    }

    // ---- After the trip ----------------------------------------------------

    @NonNull
    public Task<MapReader> rate(@NonNull String rideId, int stars, @Nullable String comment) {
        Map<String, Object> p = new HashMap<>();
        p.put("rideId", rideId);
        p.put("stars", stars);
        p.put("comment", comment);
        p.put("tags", new ArrayList<>());
        return functions.call("submitRating", p);
    }

    @NonNull
    public Task<MapReader> disputePayment(@NonNull String rideId, @NonNull String description) {
        Map<String, Object> p = new HashMap<>();
        p.put("rideId", rideId);
        p.put("description", description);
        return functions.call("disputePayment", p);
    }

    // ---- Listeners ---------------------------------------------------------

    @NonNull
    public LiveData<DocState<Ride>> ride(@NonNull String rideId) {
        return new FirestoreDocLiveData<>(db.collection("rides").document(rideId), Ride.class);
    }

    @NonNull
    public LiveData<DocState<List<RideEvent>>> events(@NonNull String rideId) {
        return new FirestoreQueryLiveData<>(db.collection("rides").document(rideId).collection("events").orderBy("at"), RideEvent.class);
    }

    @NonNull
    public LiveData<DocState<RideContact>> contact(@NonNull String rideId) {
        return new FirestoreDocLiveData<>(db.collection("rides").document(rideId).collection("contact").document("info"), RideContact.class);
    }

    @NonNull
    public LiveData<DocState<Payment>> payment(@NonNull String rideId) {
        return new FirestoreDocLiveData<>(db.collection("payments").document(rideId), Payment.class);
    }

    @NonNull
    public LiveData<DocState<List<Ride>>> history(@NonNull String uid, boolean asDriver, int limit) {
        Query q = db.collection("rides")
                .whereEqualTo(asDriver ? "driverUid" : "passengerUid", uid)
                .orderBy("requestedAt", Query.Direction.DESCENDING)
                .limit(limit);
        return new FirestoreQueryLiveData<>(q, Ride.class);
    }

    @NonNull
    public LiveData<DriverLocationLiveData.State> driverLocation(@NonNull String driverUid) {
        return new DriverLocationLiveData(driverUid);
    }
}
