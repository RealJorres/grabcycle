package ph.grabcycle.app.ui.profile;

import android.content.Intent;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.annotation.Nullable;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.util.Locale;

import ph.grabcycle.app.BuildConfig;
import ph.grabcycle.app.R;
import ph.grabcycle.app.data.AuthRepository;
import ph.grabcycle.app.data.ConfigRepository;
import ph.grabcycle.app.data.DriverRepository;
import ph.grabcycle.app.data.UserRepository;
import ph.grabcycle.app.databinding.ActivityProfileBinding;
import ph.grabcycle.app.model.EmergencyContact;
import ph.grabcycle.app.model.PoliciesConfig;
import ph.grabcycle.app.model.UserProfile;
import ph.grabcycle.app.ui.common.BaseActivity;
import ph.grabcycle.app.ui.common.Dialogs;
import ph.grabcycle.app.ui.common.ErrorMessages;
import ph.grabcycle.app.ui.common.Insets;
import ph.grabcycle.app.ui.common.PolicyActivity;
import ph.grabcycle.app.ui.launch.LauncherActivity;
import ph.grabcycle.core.model.AccountType;
import ph.grabcycle.core.model.Availability;
import ph.grabcycle.core.util.Names;
import ph.grabcycle.core.util.PhoneNumbers;

/** Account details, emergency contact, privacy requests and sign-out. */
public class ProfileActivity extends BaseActivity {

    private ActivityProfileBinding b;
    @Nullable private UserProfile profile;
    private boolean driverOnline;
    private boolean contactLoaded;
    private long minRatings = new PoliciesConfig().ratings.minRatingsToDisplay;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String uid = AuthRepository.get().uid();
        if (uid == null) {
            finish();
            return;
        }
        b = ActivityProfileBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.root, true, true);
        b.toolbar.setNavigationOnClickListener(v -> finish());
        b.version.setText(getString(R.string.profile_version, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE));
        // Field contents survive rotation via the views' own saved state.
        contactLoaded = savedInstanceState != null;

        UserRepository.get().profile(uid).observe(this, s -> {
            if (s.data != null) render(s.data);
        });
        ConfigRepository.get().policies().observe(this, s -> {
            if (s.data != null) {
                minRatings = s.data.ratings.minRatingsToDisplay;
                if (profile != null) render(profile);
            }
        });
        DriverRepository.get().driver(uid).observe(this, s ->
                driverOnline = s.data != null && Availability.fromWire(s.data.availability).sharesLocation());

        b.saveContact.setOnClickListener(v -> saveContact());
        b.removeContact.setOnClickListener(v -> Dialogs.confirm(this, R.string.profile_remove_contact,
                getString(R.string.profile_remove_contact_confirm), R.string.profile_remove_contact, () -> updateContact(null)));
        b.privacyNotice.setOnClickListener(v -> PolicyActivity.start(this, PolicyActivity.KIND_PRIVACY));
        b.terms.setOnClickListener(v -> PolicyActivity.start(this, PolicyActivity.KIND_TERMS));
        b.requestAccess.setOnClickListener(v -> dataRequest("ACCESS", R.string.profile_request_access, R.string.profile_access_explain));
        b.requestCorrection.setOnClickListener(v -> dataRequest("CORRECTION", R.string.profile_request_correction, R.string.profile_correction_explain));
        b.requestDeletion.setOnClickListener(v -> dataRequest("DELETION", R.string.profile_request_deletion, R.string.profile_deletion_explain));
        b.signOut.setOnClickListener(v -> signOut());
    }

    private void render(UserProfile p) {
        profile = p;
        b.name.setText(p.displayName);
        b.phone.setText(PhoneNumbers.formatForDisplay(p.phoneNumber));
        AccountType type = AccountType.fromWire(p.accountType);
        b.accountType.setText(type == AccountType.DRIVER ? R.string.profile_type_driver : R.string.profile_type_passenger);
        // Same minimum as everywhere else, so a handful of ratings cannot be traced to riders.
        Double avg = p.ratingSummary != null ? p.ratingSummary.averageIfAtLeast((int) minRatings) : null;
        b.rating.setVisibility(avg != null ? View.VISIBLE : View.GONE);
        if (avg != null) b.rating.setText(getString(R.string.profile_rating, String.format(Locale.US, "%.1f", avg), p.ratingSummary.count));

        EmergencyContact c = p.emergencyContact;
        b.removeContact.setVisibility(c != null ? View.VISIBLE : View.GONE);
        if (!contactLoaded) {
            // Fill once; later snapshots must not overwrite what the user is typing.
            contactLoaded = true;
            b.contactName.setText(c != null ? c.name : "");
            b.contactPhone.setText(c != null ? PhoneNumbers.formatForDisplay(c.phone) : "");
        }
    }

    private void saveContact() {
        showContactError(null);
        String name = Names.normalize(text(b.contactName));
        String phone = PhoneNumbers.normalizePhilippineMobile(text(b.contactPhone));
        boolean ok = true;
        if (name.length() < 2) {
            b.contactNameLayout.setError(getString(R.string.profile_contact_name_invalid));
            ok = false;
        } else {
            b.contactNameLayout.setError(null);
        }
        if (phone == null) {
            b.contactPhoneLayout.setError(getString(R.string.profile_contact_phone_invalid));
            ok = false;
        } else if (profile != null && phone.equals(profile.phoneNumber)) {
            b.contactPhoneLayout.setError(getString(R.string.profile_contact_phone_self));
            ok = false;
        } else {
            b.contactPhoneLayout.setError(null);
        }
        if (!ok) return;
        EmergencyContact c = new EmergencyContact();
        c.name = name;
        c.phone = phone;
        updateContact(c);
    }

    private void updateContact(@Nullable EmergencyContact c) {
        b.saveContact.setEnabled(false);
        b.removeContact.setEnabled(false);
        UserRepository.get().updateEmergencyContact(c).addOnCompleteListener(this, t -> {
            b.saveContact.setEnabled(true);
            b.removeContact.setEnabled(true);
            if (t.isSuccessful()) {
                if (c == null) {
                    b.contactName.setText("");
                    b.contactPhone.setText("");
                }
                Toast.makeText(this, c == null ? R.string.profile_contact_removed : R.string.profile_contact_saved, Toast.LENGTH_SHORT).show();
            } else {
                showContactError(ErrorMessages.of(this, t.getException()));
            }
        });
    }

    /** Privacy requests are recorded for staff to process; nothing is deleted automatically. */
    private void dataRequest(String type, int title, int explanation) {
        EditText note = new EditText(this);
        note.setHint(R.string.profile_request_note);
        note.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        note.setMaxLines(4);
        FrameLayout box = new FrameLayout(this);
        int pad = getResources().getDimensionPixelSize(R.dimen.screen_padding);
        box.setPadding(pad, 0, pad, 0);
        box.addView(note);
        new MaterialAlertDialogBuilder(this)
                .setTitle(title)
                .setMessage(explanation)
                .setView(box)
                .setNegativeButton(R.string.action_cancel, null)
                .setPositiveButton(R.string.action_submit, (d, w) -> {
                    String n = note.getText().toString().trim();
                    UserRepository.get().requestDataAction(type, n.isEmpty() ? null : n).addOnCompleteListener(this, t ->
                            Toast.makeText(this, t.isSuccessful() ? getString(R.string.profile_request_sent)
                                    : ErrorMessages.of(this, t.getException()), Toast.LENGTH_LONG).show());
                })
                .show();
    }

    private void signOut() {
        if (driverOnline) {
            Dialogs.info(this, R.string.profile_go_offline_title, getString(R.string.profile_go_offline_message));
            return;
        }
        Dialogs.confirm(this, R.string.action_sign_out, getString(R.string.profile_sign_out_confirm), R.string.action_sign_out, () -> {
            b.signOut.setEnabled(false);
            AuthRepository.get().signOut(this).addOnCompleteListener(this, t -> {
                startActivity(new Intent(this, LauncherActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
                finish();
            });
        });
    }

    private void showContactError(@Nullable String message) {
        b.contactError.setVisibility(message != null ? View.VISIBLE : View.GONE);
        b.contactError.setText(message);
    }

    private static String text(EditText e) {
        return e.getText() != null ? e.getText().toString() : "";
    }
}
