package ph.grabcycle.app.data;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.lifecycle.LiveData;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.messaging.FirebaseMessaging;

import java.util.HashMap;
import java.util.Map;

import ph.grabcycle.app.config.AppConfig;
import ph.grabcycle.app.model.EmergencyContact;
import ph.grabcycle.app.model.UserProfile;

/** The signed-in user's account profile and server-side account operations. */
public final class UserRepository {
    private static UserRepository instance;
    private final FirebaseFirestore db = FirebaseFirestore.getInstance();
    private final FunctionsClient functions = FunctionsClient.get();

    private UserRepository() {}

    public static synchronized UserRepository get() {
        if (instance == null) instance = new UserRepository();
        return instance;
    }

    @NonNull
    public LiveData<DocState<UserProfile>> profile(@NonNull String uid) {
        return new FirestoreDocLiveData<>(db.collection("users").document(uid), UserProfile.class);
    }

    /** One-shot read from the server (not cache) used for routing decisions. */
    @NonNull
    public Task<UserProfile> fetchProfile(@NonNull String uid) {
        return db.collection("users").document(uid).get(com.google.firebase.firestore.Source.SERVER)
                .continueWith(t -> {
                    if (!t.isSuccessful()) throw AppException.from(t.getException());
                    return t.getResult() != null && t.getResult().exists() ? t.getResult().toObject(UserProfile.class) : null;
                });
    }

    @NonNull
    public Task<MapReader> completeRegistration(@NonNull String accountType, @NonNull String fullName, @NonNull String locale) {
        Map<String, Object> p = new HashMap<>();
        p.put("accountType", accountType);
        p.put("fullName", fullName);
        p.put("termsVersion", AppConfig.TERMS_VERSION);
        p.put("privacyNoticeVersion", AppConfig.PRIVACY_NOTICE_VERSION);
        p.put("locale", locale);
        return functions.call("completeRegistration", p);
    }

    @NonNull
    public Task<MapReader> updateEmergencyContact(@Nullable EmergencyContact contact) {
        Map<String, Object> p = new HashMap<>();
        if (contact == null) {
            p.put("emergencyContact", null);
        } else {
            Map<String, Object> c = new HashMap<>();
            c.put("name", contact.name);
            c.put("phone", contact.phone);
            p.put("emergencyContact", c);
        }
        return functions.call("updateProfile", p);
    }

    @NonNull
    public Task<MapReader> requestDataAction(@NonNull String type, @Nullable String note) {
        Map<String, Object> p = new HashMap<>();
        p.put("type", type);
        p.put("note", note);
        return functions.call("requestDataAction", p);
    }

    /**
     * Registers this installation's FCM token with the backend.
     * getToken() is deprecated in firebase-messaging 25.1+ in favour of
     * installation-ID registration; it remains functional and is used until the
     * backend migrates its targeting (see docs/toolchain.md).
     */
    @SuppressWarnings("deprecation")
    @NonNull
    public Task<MapReader> registerDevice(@NonNull Context context) {
        return FirebaseMessaging.getInstance().getToken().continueWithTask(t -> {
            if (!t.isSuccessful() || t.getResult() == null) return Tasks.forException(AppException.from(t.getException()));
            return registerToken(context, t.getResult());
        });
    }

    @NonNull
    public Task<MapReader> registerToken(@NonNull Context context, @NonNull String token) {
        Map<String, Object> p = new HashMap<>();
        p.put("installationId", DeviceId.get(context));
        p.put("token", token);
        p.put("platform", "android");
        return functions.call("registerDevice", p);
    }

    @NonNull
    public Task<MapReader> unregisterDevice(@NonNull Context context) {
        Map<String, Object> p = new HashMap<>();
        p.put("installationId", DeviceId.get(context));
        return functions.call("unregisterDevice", p);
    }
}
