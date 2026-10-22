package ph.grabcycle.app.ui.auth;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;

import androidx.annotation.Nullable;

import java.util.Locale;

import ph.grabcycle.app.R;
import ph.grabcycle.app.data.AuthRepository;
import ph.grabcycle.app.data.UserRepository;
import ph.grabcycle.app.databinding.ActivityRegistrationBinding;
import ph.grabcycle.app.ui.common.BaseActivity;
import ph.grabcycle.app.ui.common.ErrorMessages;
import ph.grabcycle.app.ui.common.Insets;
import ph.grabcycle.app.ui.common.PolicyActivity;
import ph.grabcycle.app.ui.launch.LauncherActivity;
import ph.grabcycle.core.util.Names;

/**
 * First-time registration: account type, legal name and explicit consent to
 * the current Terms and Privacy Notice. The server fixes the account type;
 * driver privileges additionally require accreditation approval.
 */
public class RegistrationActivity extends BaseActivity {

    private ActivityRegistrationBinding b;
    @Nullable private String accountType;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        b = ActivityRegistrationBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.root, true, true);

        b.typePassenger.setOnClickListener(v -> selectType("PASSENGER"));
        b.typeDriver.setOnClickListener(v -> selectType("DRIVER"));
        b.readTerms.setOnClickListener(v -> PolicyActivity.start(this, PolicyActivity.KIND_TERMS));
        b.readPrivacy.setOnClickListener(v -> PolicyActivity.start(this, PolicyActivity.KIND_PRIVACY));
        b.submit.setOnClickListener(v -> submit());
        b.signOut.setOnClickListener(v -> {
            b.signOut.setEnabled(false);
            AuthRepository.get().signOut(this).addOnCompleteListener(this, t -> restart());
        });
        if (savedInstanceState != null) selectType(savedInstanceState.getString("type"));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putString("type", accountType);
    }

    private void selectType(@Nullable String type) {
        accountType = type;
        b.typePassenger.setChecked("PASSENGER".equals(type));
        b.typeDriver.setChecked("DRIVER".equals(type));
        b.driverNote.setVisibility("DRIVER".equals(type) ? View.VISIBLE : View.GONE);
    }

    private void submit() {
        b.error.setVisibility(View.GONE);
        b.nameLayout.setError(null);
        String name = Names.normalize(b.nameInput.getText() != null ? b.nameInput.getText().toString() : "");
        if (accountType == null) {
            showError(getString(R.string.reg_err_type));
            return;
        }
        if (!Names.isValidPersonName(name)) {
            b.nameLayout.setError(getString(R.string.reg_err_name));
            return;
        }
        if (!b.acceptTerms.isChecked() || !b.acceptPrivacy.isChecked()) {
            showError(getString(R.string.reg_err_consent));
            return;
        }
        setLoading(true);
        String locale = Locale.getDefault().getLanguage().equals("fil") || Locale.getDefault().getLanguage().equals("tl") ? "fil" : "en";
        UserRepository.get().completeRegistration(accountType, name, locale).addOnCompleteListener(t -> {
            setLoading(false);
            if (t.isSuccessful()) restart();
            else showError(ErrorMessages.of(this, t.getException()));
        });
    }

    private void setLoading(boolean loading) {
        b.progress.setVisibility(loading ? View.VISIBLE : View.GONE);
        b.submit.setEnabled(!loading);
    }

    private void showError(String message) {
        b.error.setText(message);
        b.error.setVisibility(View.VISIBLE);
    }

    private void restart() {
        startActivity(new Intent(this, LauncherActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        finish();
    }
}
