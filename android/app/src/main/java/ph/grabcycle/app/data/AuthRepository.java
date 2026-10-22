package ph.grabcycle.app.data;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.auth.AuthResult;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.auth.GetTokenResult;
import com.google.firebase.auth.PhoneAuthCredential;

import ph.grabcycle.app.location.DriverLocationService;

/** Firebase Authentication access (phone sign-in for passengers and drivers). */
public final class AuthRepository {
    private static AuthRepository instance;
    private final FirebaseAuth auth = FirebaseAuth.getInstance();

    private AuthRepository() {}

    public static synchronized AuthRepository get() {
        if (instance == null) instance = new AuthRepository();
        return instance;
    }

    @NonNull
    public FirebaseAuth auth() {
        return auth;
    }

    @Nullable
    public FirebaseUser currentUser() {
        return auth.getCurrentUser();
    }

    @Nullable
    public String uid() {
        FirebaseUser u = auth.getCurrentUser();
        return u != null ? u.getUid() : null;
    }

    @NonNull
    public Task<AuthResult> signIn(@NonNull PhoneAuthCredential credential) {
        return auth.signInWithCredential(credential);
    }

    /** Forces a token refresh so revoked sessions and changed claims are detected. */
    @NonNull
    public Task<GetTokenResult> refreshToken() {
        FirebaseUser u = auth.getCurrentUser();
        if (u == null) return Tasks.forException(new AppException(ph.grabcycle.core.model.ErrorReason.UNAUTHENTICATED, "Not signed in", null, null));
        return u.getIdToken(true);
    }

    /**
     * Signs out: stops location sharing, unregisters this device from push
     * notifications (best effort) and clears the Firebase session.
     */
    @NonNull
    public Task<Void> signOut(@NonNull Context context) {
        DriverLocationService.stop(context);
        return UserRepository.get().unregisterDevice(context).continueWith(t -> {
            auth.signOut();
            return null;
        });
    }
}
