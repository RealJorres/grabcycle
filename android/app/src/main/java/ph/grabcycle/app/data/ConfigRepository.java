package ph.grabcycle.app.data;

import androidx.annotation.NonNull;
import androidx.lifecycle.LiveData;

import com.google.firebase.firestore.FirebaseFirestore;

import ph.grabcycle.app.model.AppSettings;
import ph.grabcycle.app.model.DocumentPolicy;
import ph.grabcycle.app.model.MatchingConfig;
import ph.grabcycle.app.model.PoliciesConfig;
import ph.grabcycle.app.model.ServiceArea;

/** Operator configuration documents (read-only for clients). */
public final class ConfigRepository {
    private static ConfigRepository instance;
    private final FirebaseFirestore db = FirebaseFirestore.getInstance();

    private ConfigRepository() {}

    public static synchronized ConfigRepository get() {
        if (instance == null) instance = new ConfigRepository();
        return instance;
    }

    @NonNull
    public LiveData<DocState<DocumentPolicy>> documentPolicy() {
        return new FirestoreDocLiveData<>(db.collection("config").document("documentPolicy"), DocumentPolicy.class);
    }

    @NonNull
    public LiveData<DocState<MatchingConfig>> matching() {
        return new FirestoreDocLiveData<>(db.collection("config").document("matching"), MatchingConfig.class);
    }

    @NonNull
    public LiveData<DocState<ServiceArea>> serviceArea() {
        return new FirestoreDocLiveData<>(db.collection("config").document("serviceArea"), ServiceArea.class);
    }

    @NonNull
    public LiveData<DocState<AppSettings>> app() {
        return new FirestoreDocLiveData<>(db.collection("config").document("app"), AppSettings.class);
    }

    @NonNull
    public LiveData<DocState<PoliciesConfig>> policies() {
        return new FirestoreDocLiveData<>(db.collection("config").document("policies"), PoliciesConfig.class);
    }
}
