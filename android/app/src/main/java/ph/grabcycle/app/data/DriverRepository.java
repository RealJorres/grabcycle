package ph.grabcycle.app.data;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.lifecycle.LiveData;

import com.google.android.gms.tasks.Task;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.Query;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import ph.grabcycle.app.model.AvailabilityResult;
import ph.grabcycle.app.model.DriverDocument;
import ph.grabcycle.app.model.DriverProfile;
import ph.grabcycle.app.model.Payment;
import ph.grabcycle.app.model.Ride;

/** Driver onboarding, accreditation status and availability. */
public final class DriverRepository {
    private static DriverRepository instance;
    private final FirebaseFirestore db = FirebaseFirestore.getInstance();
    private final FunctionsClient functions = FunctionsClient.get();

    private DriverRepository() {}

    public static synchronized DriverRepository get() {
        if (instance == null) instance = new DriverRepository();
        return instance;
    }

    @NonNull
    public LiveData<DocState<DriverProfile>> driver(@NonNull String uid) {
        return new FirestoreDocLiveData<>(db.collection("drivers").document(uid), DriverProfile.class);
    }

    @NonNull
    public LiveData<DocState<List<DriverDocument>>> documents(@NonNull String uid) {
        return new FirestoreQueryLiveData<>(db.collection("drivers").document(uid).collection("documents"), DriverDocument.class);
    }

    @NonNull
    public Task<MapReader> saveProfile(@NonNull String municipality, @NonNull Map<String, Object> vehicle) {
        Map<String, Object> p = new HashMap<>();
        p.put("municipality", municipality);
        p.put("vehicle", vehicle);
        return functions.call("saveDriverProfile", p);
    }

    @NonNull
    public Task<MapReader> submitDocument(@NonNull String requirementCode, @NonNull Map<String, String> uploadIdsBySide,
                                          @Nullable String expiryDate, @Nullable String documentNumber) {
        Map<String, Object> p = new HashMap<>();
        p.put("requirementCode", requirementCode);
        p.put("uploads", VerificationRepository.uploadRefs(uploadIdsBySide));
        p.put("expiryDate", expiryDate);
        p.put("documentNumber", documentNumber);
        return functions.call("submitDriverDocument", p);
    }

    @NonNull
    public Task<MapReader> submitApplication() {
        return functions.call("submitDriverApplication", Collections.emptyMap());
    }

    @NonNull
    public Task<MapReader> refreshEligibility() {
        return functions.call("refreshDriverEligibility", Collections.emptyMap());
    }

    /** Requests an availability change; the backend decides. */
    @NonNull
    public Task<AvailabilityResult> setAvailability(boolean online, double lat, double lng, float accuracy, boolean mock) {
        Map<String, Object> p = new HashMap<>();
        p.put("online", online);
        if (online) {
            Map<String, Object> loc = new HashMap<>();
            loc.put("lat", lat);
            loc.put("lng", lng);
            loc.put("accuracy", (double) accuracy);
            loc.put("mock", mock);
            p.put("location", loc);
        } else {
            p.put("location", null);
        }
        return functions.call("setDriverAvailability", p, AvailabilityResult::from);
    }

    @NonNull
    public LiveData<DocState<List<Ride>>> recentTrips(@NonNull String uid, int limit) {
        Query q = db.collection("rides").whereEqualTo("driverUid", uid).orderBy("requestedAt", Query.Direction.DESCENDING).limit(limit);
        return new FirestoreQueryLiveData<>(q, Ride.class);
    }

    @NonNull
    public LiveData<DocState<List<Payment>>> recentPayments(@NonNull String uid, int limit) {
        Query q = db.collection("payments").whereEqualTo("driverUid", uid).orderBy("createdAt", Query.Direction.DESCENDING).limit(limit);
        return new FirestoreQueryLiveData<>(q, Payment.class);
    }
}
