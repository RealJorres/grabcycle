package ph.grabcycle.app.data;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.lifecycle.LiveData;

import com.google.android.gms.tasks.Task;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.Query;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import ph.grabcycle.app.model.SupportCase;

/** Support / incident reports. */
public final class SupportRepository {
    private static SupportRepository instance;

    private SupportRepository() {}

    public static synchronized SupportRepository get() {
        if (instance == null) instance = new SupportRepository();
        return instance;
    }

    @NonNull
    public Task<MapReader> create(@Nullable String rideId, @NonNull String category, @NonNull String description) {
        Map<String, Object> p = new HashMap<>();
        p.put("rideId", rideId);
        p.put("category", category);
        p.put("description", description);
        return FunctionsClient.get().call("createSupportCase", p);
    }

    @NonNull
    public LiveData<DocState<List<SupportCase>>> myCases(@NonNull String uid) {
        Query q = FirebaseFirestore.getInstance().collection("supportCases")
                .whereEqualTo("reporterUid", uid)
                .orderBy("createdAt", Query.Direction.DESCENDING)
                .limit(30);
        return new FirestoreQueryLiveData<>(q, SupportCase.class);
    }
}
