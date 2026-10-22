package ph.grabcycle.app.ui.launch;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import com.google.firebase.auth.FirebaseAuthInvalidUserException;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.Source;

import ph.grabcycle.app.BuildConfig;
import ph.grabcycle.app.GrabCycleApp;
import ph.grabcycle.app.R;
import ph.grabcycle.app.data.AppException;
import ph.grabcycle.app.data.AuthRepository;
import ph.grabcycle.app.data.UserRepository;
import ph.grabcycle.app.databinding.ActivityLauncherBinding;
import ph.grabcycle.app.model.AppSettings;
import ph.grabcycle.app.model.UserProfile;
import ph.grabcycle.app.ui.auth.AuthActivity;
import ph.grabcycle.app.ui.auth.RegistrationActivity;
import ph.grabcycle.app.ui.common.AccountBlockedActivity;
import ph.grabcycle.app.ui.common.ErrorMessages;
import ph.grabcycle.app.ui.common.Insets;
import ph.grabcycle.app.ui.driver.DriverHomeActivity;
import ph.grabcycle.app.ui.passenger.PassengerHomeActivity;
import ph.grabcycle.core.model.AccountType;
import ph.grabcycle.core.model.ErrorReason;

/**
 * Routes the user based on server-side state: signed-in session (refreshed so
 * revoked or disabled accounts are caught), staff role, registration,
 * account status and account type. Nothing here trusts cached local flags.
 */
public class LauncherActivity extends AppCompatActivity {

    public static final String EXTRA_FROM_PUSH = "fromPush";

    private ActivityLauncherBinding b;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        b = ActivityLauncherBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.root, true, true);
        route();
    }

    private void route() {
        b.state.hide();
        b.brand.setVisibility(View.VISIBLE);
        if (!GrabCycleApp.isFirebaseReady()) {
            AccountBlockedActivity.start(this, AccountBlockedActivity.Mode.CONFIG_MISSING, null);
            finish();
            return;
        }
        AuthRepository auth = AuthRepository.get();
        if (auth.currentUser() == null) {
            go(AuthActivity.class);
            return;
        }
        // Force a token refresh: catches disabled users and revoked sessions.
        auth.refreshToken().addOnCompleteListener(tokenTask -> {
            if (!tokenTask.isSuccessful()) {
                Exception e = tokenTask.getException();
                if (e instanceof FirebaseAuthInvalidUserException) {
                    auth.auth().signOut();
                    AccountBlockedActivity.start(this, AccountBlockedActivity.Mode.SESSION_ENDED, null);
                    finish();
                } else {
                    showError(e);
                }
                return;
            }
            Object role = tokenTask.getResult().getClaims().get("staffRole");
            if (role != null) {
                AccountBlockedActivity.start(this, AccountBlockedActivity.Mode.STAFF, null);
                finish();
                return;
            }
            checkAppSettings(auth.uid());
        });
    }

    private void checkAppSettings(String uid) {
        FirebaseFirestore.getInstance().collection("config").document("app").get(Source.DEFAULT).addOnCompleteListener(t -> {
            AppSettings settings = t.isSuccessful() && t.getResult() != null && t.getResult().exists()
                    ? t.getResult().toObject(AppSettings.class) : null;
            if (settings != null && settings.maintenanceMode) {
                AccountBlockedActivity.start(this, AccountBlockedActivity.Mode.MAINTENANCE, null);
                finish();
                return;
            }
            if (settings != null && BuildConfig.VERSION_CODE < settings.minAndroidVersionCode) {
                AccountBlockedActivity.start(this, AccountBlockedActivity.Mode.UPDATE_REQUIRED, null);
                finish();
                return;
            }
            loadProfile(uid);
        });
    }

    private void loadProfile(String uid) {
        UserRepository.get().fetchProfile(uid).addOnCompleteListener(t -> {
            if (!t.isSuccessful()) {
                showError(t.getException());
                return;
            }
            UserProfile profile = t.getResult();
            if (profile == null) {
                go(RegistrationActivity.class);
                return;
            }
            if (!"ACTIVE".equals(profile.status)) {
                AccountBlockedActivity.start(this, AccountBlockedActivity.Mode.SUSPENDED,
                        profile.suspension != null ? profile.suspension.publicMessage : null);
                finish();
                return;
            }
            // Best effort; failures are retried at the next launch.
            UserRepository.get().registerDevice(getApplicationContext());
            AccountType type = AccountType.fromWire(profile.accountType);
            go(type == AccountType.DRIVER ? DriverHomeActivity.class : PassengerHomeActivity.class);
        });
    }

    private void showError(@Nullable Exception e) {
        b.brand.setVisibility(View.GONE);
        AppException ae = AppException.from(e);
        if (ae.getReason() == ErrorReason.NETWORK || ae.getReason() == ErrorReason.TIMEOUT) {
            b.state.showOffline(this::route);
        } else {
            b.state.showError(getString(R.string.launch_error_title), ErrorMessages.of(this, e), this::route);
        }
    }

    private void go(Class<?> target) {
        startActivity(new Intent(this, target).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK | Intent.FLAG_ACTIVITY_NEW_TASK));
        finish();
    }
}
