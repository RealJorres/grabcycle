package ph.grabcycle.app.data;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.firebase.FirebaseNetworkException;
import com.google.firebase.functions.FirebaseFunctionsException;

import java.util.Collections;
import java.util.Map;

import ph.grabcycle.core.model.ErrorReason;

/**
 * A failure with a stable {@link ErrorReason}. Backend errors carry
 * {@code details.reason}; transport problems map to NETWORK / TIMEOUT.
 * Messages shown to users come from string resources, never raw server text
 * for unexpected errors.
 */
public class AppException extends Exception {
    private final ErrorReason reason;
    private final Map<String, Object> details;

    public AppException(@NonNull ErrorReason reason, @Nullable String message, @Nullable Map<String, Object> details, @Nullable Throwable cause) {
        super(message, cause);
        this.reason = reason;
        this.details = details != null ? details : Collections.emptyMap();
    }

    @NonNull
    public ErrorReason getReason() {
        return reason;
    }

    @NonNull
    public Map<String, Object> getDetails() {
        return details;
    }

    @SuppressWarnings("unchecked")
    @NonNull
    public static AppException from(@Nullable Throwable error) {
        if (error instanceof AppException) return (AppException) error;
        Throwable root = error;
        while (root != null && root.getCause() != null && !(root instanceof FirebaseFunctionsException)) {
            if (root instanceof FirebaseNetworkException) break;
            root = root.getCause();
        }
        if (root instanceof FirebaseNetworkException) {
            return new AppException(ErrorReason.NETWORK, root.getMessage(), null, error);
        }
        if (root instanceof FirebaseFunctionsException) {
            FirebaseFunctionsException fe = (FirebaseFunctionsException) root;
            Map<String, Object> details = fe.getDetails() instanceof Map ? (Map<String, Object>) fe.getDetails() : null;
            Object reasonValue = details != null ? details.get("reason") : null;
            ErrorReason reason = reasonValue instanceof String ? ErrorReason.fromWire((String) reasonValue) : fromCode(fe.getCode());
            return new AppException(reason, fe.getMessage(), details, error);
        }
        return new AppException(ErrorReason.UNKNOWN, error != null ? error.getMessage() : null, null, error);
    }

    private static ErrorReason fromCode(FirebaseFunctionsException.Code code) {
        switch (code) {
            case UNAVAILABLE:
                return ErrorReason.NETWORK;
            case DEADLINE_EXCEEDED:
                return ErrorReason.TIMEOUT;
            case UNAUTHENTICATED:
                return ErrorReason.UNAUTHENTICATED;
            case PERMISSION_DENIED:
                return ErrorReason.PERMISSION_DENIED;
            case RESOURCE_EXHAUSTED:
                return ErrorReason.RATE_LIMITED;
            case INVALID_ARGUMENT:
                return ErrorReason.INVALID_ARGUMENT;
            case NOT_FOUND:
                return ErrorReason.NOT_FOUND;
            default:
                return ErrorReason.INTERNAL;
        }
    }
}
