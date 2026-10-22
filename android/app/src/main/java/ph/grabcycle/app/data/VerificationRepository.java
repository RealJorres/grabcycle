package ph.grabcycle.app.data;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.android.gms.tasks.Task;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Passenger identity verification submission. Approval is decided by staff on the server. */
public final class VerificationRepository {
    private static VerificationRepository instance;

    private VerificationRepository() {}

    public static synchronized VerificationRepository get() {
        if (instance == null) instance = new VerificationRepository();
        return instance;
    }

    @NonNull
    public Task<MapReader> submit(@NonNull String idType, @NonNull String nameOnId, @Nullable String idExpiry, @NonNull Map<String, String> uploadIdsBySide) {
        Map<String, Object> p = new HashMap<>();
        p.put("idType", idType);
        p.put("nameOnId", nameOnId);
        p.put("idExpiry", idExpiry);
        p.put("uploads", uploadRefs(uploadIdsBySide));
        return FunctionsClient.get().call("submitPassengerVerification", p);
    }

    @NonNull
    static List<Map<String, Object>> uploadRefs(@NonNull Map<String, String> uploadIdsBySide) {
        List<Map<String, Object>> uploads = new ArrayList<>();
        for (Map.Entry<String, String> e : uploadIdsBySide.entrySet()) {
            Map<String, Object> u = new HashMap<>();
            u.put("side", e.getKey());
            u.put("uploadId", e.getValue());
            uploads.add(u);
        }
        return uploads;
    }
}
