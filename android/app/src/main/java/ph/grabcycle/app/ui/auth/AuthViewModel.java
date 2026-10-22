package ph.grabcycle.app.ui.auth;

import android.app.Activity;
import android.os.SystemClock;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.StringRes;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.ViewModel;

import com.google.firebase.FirebaseException;
import com.google.firebase.FirebaseNetworkException;
import com.google.firebase.FirebaseTooManyRequestsException;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException;
import com.google.firebase.auth.FirebaseAuthInvalidUserException;
import com.google.firebase.auth.PhoneAuthCredential;
import com.google.firebase.auth.PhoneAuthOptions;
import com.google.firebase.auth.PhoneAuthProvider;

import java.util.concurrent.TimeUnit;

import ph.grabcycle.app.R;
import ph.grabcycle.app.data.AuthRepository;
import ph.grabcycle.core.util.PhoneNumbers;

/**
 * Phone-number sign-in state machine: enter number → SMS code → signed in.
 * Handles resend cooldown, auto-retrieval, wrong/expired codes, SMS quota
 * and rate limits with explicit messages.
 */
public class AuthViewModel extends ViewModel {

    public enum Step { PHONE, CODE, SIGNED_IN }

    public static final class UiState {
        @NonNull public final Step step;
        public final boolean loading;
        @Nullable @StringRes public final Integer error;
        @Nullable public final String phoneE164;
        /** {@link SystemClock#elapsedRealtime()} when resending becomes possible. */
        public final long resendAvailableAt;

        UiState(@NonNull Step step, boolean loading, @Nullable Integer error, @Nullable String phoneE164, long resendAvailableAt) {
            this.step = step;
            this.loading = loading;
            this.error = error;
            this.phoneE164 = phoneE164;
            this.resendAvailableAt = resendAvailableAt;
        }
    }

    public static final long RESEND_COOLDOWN_MS = 60_000;

    private final MutableLiveData<UiState> state = new MutableLiveData<>(new UiState(Step.PHONE, false, null, null, 0));
    @Nullable private String verificationId;
    @Nullable private PhoneAuthProvider.ForceResendingToken resendToken;

    @NonNull
    public LiveData<UiState> state() {
        return state;
    }

    private UiState current() {
        UiState s = state.getValue();
        return s != null ? s : new UiState(Step.PHONE, false, null, null, 0);
    }

    private void set(Step step, boolean loading, @Nullable Integer error) {
        UiState c = current();
        state.setValue(new UiState(step, loading, error, c.phoneE164, c.resendAvailableAt));
    }

    public void sendCode(@NonNull Activity activity, @NonNull String rawPhone) {
        String e164 = PhoneNumbers.normalizePhilippineMobile(rawPhone);
        if (e164 == null) e164 = PhoneNumbers.normalizePhilippineMobile("0" + rawPhone);
        if (e164 == null) {
            set(Step.PHONE, false, R.string.auth_err_invalid_phone);
            return;
        }
        state.setValue(new UiState(Step.PHONE, true, null, e164, current().resendAvailableAt));
        requestCode(activity, e164, null);
    }

    public void resend(@NonNull Activity activity) {
        UiState c = current();
        if (c.phoneE164 == null || SystemClock.elapsedRealtime() < c.resendAvailableAt) return;
        set(Step.CODE, true, null);
        requestCode(activity, c.phoneE164, resendToken);
    }

    private void requestCode(Activity activity, String e164, @Nullable PhoneAuthProvider.ForceResendingToken token) {
        PhoneAuthOptions.Builder options = PhoneAuthOptions.newBuilder(FirebaseAuth.getInstance())
                .setPhoneNumber(e164)
                .setTimeout(60L, TimeUnit.SECONDS)
                .setActivity(activity)
                .setCallbacks(callbacks);
        if (token != null) options.setForceResendingToken(token);
        PhoneAuthProvider.verifyPhoneNumber(options.build());
    }

    private final PhoneAuthProvider.OnVerificationStateChangedCallbacks callbacks = new PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
        @Override
        public void onVerificationCompleted(@NonNull PhoneAuthCredential credential) {
            // Instant verification or SMS auto-retrieval.
            signIn(credential);
        }

        @Override
        public void onVerificationFailed(@NonNull FirebaseException e) {
            Step step = verificationId != null ? Step.CODE : Step.PHONE;
            int msg;
            if (e instanceof FirebaseAuthInvalidCredentialsException) msg = R.string.auth_err_invalid_phone;
            else if (e instanceof FirebaseTooManyRequestsException) msg = R.string.auth_err_too_many;
            else if (e instanceof FirebaseNetworkException) msg = R.string.err_network;
            else msg = R.string.auth_err_send_failed;
            set(step, false, msg);
        }

        @Override
        public void onCodeSent(@NonNull String id, @NonNull PhoneAuthProvider.ForceResendingToken token) {
            verificationId = id;
            resendToken = token;
            UiState c = current();
            state.setValue(new UiState(Step.CODE, false, null, c.phoneE164, SystemClock.elapsedRealtime() + RESEND_COOLDOWN_MS));
        }
    };

    public void verify(@NonNull String code) {
        if (verificationId == null) {
            set(Step.PHONE, false, R.string.auth_err_code_expired);
            return;
        }
        if (!code.matches("\\d{6}")) {
            set(Step.CODE, false, R.string.auth_err_code_format);
            return;
        }
        set(Step.CODE, true, null);
        signIn(PhoneAuthProvider.getCredential(verificationId, code));
    }

    private void signIn(PhoneAuthCredential credential) {
        AuthRepository.get().signIn(credential).addOnCompleteListener(t -> {
            if (t.isSuccessful()) {
                set(Step.SIGNED_IN, false, null);
                return;
            }
            Exception e = t.getException();
            int msg = R.string.auth_err_sign_in_failed;
            if (e instanceof FirebaseAuthInvalidCredentialsException) {
                String code = ((FirebaseAuthInvalidCredentialsException) e).getErrorCode();
                msg = "ERROR_SESSION_EXPIRED".equals(code) ? R.string.auth_err_code_expired : R.string.auth_err_wrong_code;
            } else if (e instanceof FirebaseAuthInvalidUserException) {
                msg = R.string.auth_err_account_disabled;
            } else if (e instanceof FirebaseTooManyRequestsException) {
                msg = R.string.auth_err_too_many;
            } else if (e instanceof FirebaseNetworkException) {
                msg = R.string.err_network;
            }
            set(Step.CODE, false, msg);
        });
    }

    public void changeNumber() {
        verificationId = null;
        resendToken = null;
        state.setValue(new UiState(Step.PHONE, false, null, current().phoneE164, 0));
    }
}
