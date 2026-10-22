package ph.grabcycle.app.ui.auth;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.view.inputmethod.EditorInfo;

import androidx.annotation.Nullable;
import androidx.lifecycle.ViewModelProvider;

import ph.grabcycle.app.R;
import ph.grabcycle.app.databinding.ActivityAuthBinding;
import ph.grabcycle.app.ui.common.BaseActivity;
import ph.grabcycle.app.ui.common.Insets;
import ph.grabcycle.app.ui.launch.LauncherActivity;
import ph.grabcycle.core.util.PhoneNumbers;

/** Sign in with a Philippine mobile number and SMS code. */
public class AuthActivity extends BaseActivity {

    private ActivityAuthBinding b;
    private AuthViewModel vm;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable tick = this::updateResend;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        b = ActivityAuthBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.root, true, true);
        vm = new ViewModelProvider(this).get(AuthViewModel.class);

        b.sendCode.setOnClickListener(v -> sendCode());
        b.phoneInput.setOnEditorActionListener((v, actionId, e) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                sendCode();
                return true;
            }
            return false;
        });
        b.verify.setOnClickListener(v -> vm.verify(text(b.codeInput)));
        b.codeInput.setOnEditorActionListener((v, actionId, e) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                vm.verify(text(b.codeInput));
                return true;
            }
            return false;
        });
        b.resend.setOnClickListener(v -> vm.resend(this));
        b.changeNumber.setOnClickListener(v -> vm.changeNumber());

        vm.state().observe(this, this::render);
    }

    private void sendCode() {
        if (!isOnline()) {
            showError(getString(R.string.err_network));
            return;
        }
        vm.sendCode(this, text(b.phoneInput));
    }

    private void render(AuthViewModel.UiState s) {
        if (s.step == AuthViewModel.Step.SIGNED_IN) {
            startActivity(new Intent(this, LauncherActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            finish();
            return;
        }
        boolean code = s.step == AuthViewModel.Step.CODE;
        b.phonePanel.setVisibility(code ? View.GONE : View.VISIBLE);
        b.codePanel.setVisibility(code ? View.VISIBLE : View.GONE);
        b.progress.setVisibility(s.loading ? View.VISIBLE : View.GONE);
        b.sendCode.setEnabled(!s.loading);
        b.verify.setEnabled(!s.loading);
        if (s.phoneE164 != null) {
            b.codeSubtitle.setText(getString(R.string.auth_code_subtitle, PhoneNumbers.formatForDisplay(s.phoneE164)));
        }
        if (s.error != null) showError(getString(s.error));
        else b.error.setVisibility(View.GONE);
        updateResend();
    }

    private void updateResend() {
        handler.removeCallbacks(tick);
        AuthViewModel.UiState s = vm.state().getValue();
        if (s == null || s.step != AuthViewModel.Step.CODE) return;
        long remaining = s.resendAvailableAt - SystemClock.elapsedRealtime();
        if (remaining > 0) {
            b.resend.setEnabled(false);
            b.resend.setText(getString(R.string.auth_resend_in, (int) Math.ceil(remaining / 1000.0)));
            handler.postDelayed(tick, 1000);
        } else {
            b.resend.setEnabled(!s.loading);
            b.resend.setText(R.string.auth_resend);
        }
    }

    private void showError(String message) {
        b.error.setText(message);
        b.error.setVisibility(View.VISIBLE);
    }

    private static String text(com.google.android.material.textfield.TextInputEditText input) {
        return input.getText() != null ? input.getText().toString().trim() : "";
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(tick);
        super.onDestroy();
    }
}
