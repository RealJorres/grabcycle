package ph.grabcycle.app.ui.verification;

import android.os.Bundle;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import ph.grabcycle.app.R;
import ph.grabcycle.app.data.AppException;
import ph.grabcycle.app.data.AuthRepository;
import ph.grabcycle.app.data.ConfigRepository;
import ph.grabcycle.app.data.DocState;
import ph.grabcycle.app.data.UserRepository;
import ph.grabcycle.app.data.VerificationRepository;
import ph.grabcycle.app.databinding.ActivityPassengerVerificationBinding;
import ph.grabcycle.app.model.DocumentPolicy;
import ph.grabcycle.app.model.PassengerIdType;
import ph.grabcycle.app.model.PassengerVerificationState;
import ph.grabcycle.app.model.UserProfile;
import ph.grabcycle.app.ui.common.BaseActivity;
import ph.grabcycle.app.ui.common.DateField;
import ph.grabcycle.app.ui.common.DocumentSlotView;
import ph.grabcycle.app.ui.common.ErrorMessages;
import ph.grabcycle.app.ui.common.ImageCapture;
import ph.grabcycle.app.ui.common.Insets;
import ph.grabcycle.app.ui.common.StatusStyles;
import ph.grabcycle.app.ui.support.SupportActivity;
import ph.grabcycle.core.model.VerificationStatus;
import ph.grabcycle.core.util.DateInputs;
import ph.grabcycle.core.util.Names;

/**
 * Passenger ID submission and status. Submitting only queues the documents
 * for a human reviewer; this screen never shows the passenger as verified
 * unless the server-side profile says APPROVED.
 */
public class PassengerVerificationActivity extends BaseActivity implements DocumentSlotView.Listener {

    private static final String STATE_TYPE = "idType";
    private static final String STATE_EXPIRY = "expiry";

    private ActivityPassengerVerificationBinding b;
    private ImageCapture capture;
    private DateField expiry;
    private String uid;
    private final List<PassengerIdType> idTypes = new ArrayList<>();
    private final Map<String, DocumentSlotView> slots = new LinkedHashMap<>();
    @Nullable private PassengerIdType selectedType;
    @Nullable private Bundle pendingRestore;
    private boolean submitting;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        uid = AuthRepository.get().uid();
        if (uid == null) {
            finish();
            return;
        }
        b = ActivityPassengerVerificationBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.root, true, true);
        b.toolbar.setNavigationOnClickListener(v -> finish());
        pendingRestore = savedInstanceState;

        capture = new ImageCapture(this, savedInstanceState, new ImageCapture.Callback() {
            @Override
            public void onImage(@NonNull String slotKey, @NonNull android.net.Uri uri, boolean fromCamera) {
                DocumentSlotView slot = slots.get(slotKey);
                if (slot != null) slot.startUpload(uid, uri);
            }

            @Override
            public void onCancelled(@NonNull String slotKey) {
                // Nothing to do; the slot stays as it was.
            }
        });
        expiry = new DateField(b.expiry, getSupportFragmentManager(), R.string.pv_expiry);
        if (savedInstanceState != null) expiry.setValue(savedInstanceState.getString(STATE_EXPIRY));

        b.idType.setOnItemClickListener((parent, view, position, id) -> selectType(idTypes.get(position), null));
        b.submit.setOnClickListener(v -> submit());
        b.contactSupport.setOnClickListener(v -> startActivity(SupportActivity.intent(this, null)));

        b.state.showLoading(null);
        b.state.setVisibility(View.VISIBLE);
        b.content.setVisibility(View.GONE);
        ConfigRepository.get().documentPolicy().observe(this, this::onPolicy);
        UserRepository.get().profile(uid).observe(this, this::onProfile);
    }

    private void onPolicy(DocState<DocumentPolicy> s) {
        if (s.data == null) {
            if (!s.loading) {
                b.state.showError(getString(R.string.config_missing_title), getString(R.string.config_missing_message), null);
            }
            return;
        }
        idTypes.clear();
        if (s.data.passengerIdTypes != null) {
            for (PassengerIdType t : s.data.passengerIdTypes) if (t.active && t.code != null) idTypes.add(t);
        }
        List<String> labels = new ArrayList<>();
        for (PassengerIdType t : idTypes) labels.add(t.label);
        b.idType.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, labels));
        // Restore the previous choice (rotation / process death) once types are known.
        String code = pendingRestore != null ? pendingRestore.getString(STATE_TYPE) : (selectedType != null ? selectedType.code : null);
        if (code != null) {
            for (PassengerIdType t : idTypes) {
                if (code.equals(t.code)) {
                    b.idType.setText(t.label, false);
                    selectType(t, pendingRestore);
                }
            }
        }
        pendingRestore = null;
    }

    private void onProfile(DocState<UserProfile> s) {
        if (s.data == null) {
            if (!s.loading) b.state.showError(getString(R.string.err_generic), s.error != null ? ErrorMessages.of(this, s.error) : null, null);
            return;
        }
        b.state.setVisibility(View.GONE);
        b.content.setVisibility(View.VISIBLE);
        PassengerVerificationState v = s.data.passengerVerification;
        VerificationStatus recorded = VerificationStatus.fromWire(v != null ? v.status : null);
        if (v == null) recorded = VerificationStatus.NOT_SUBMITTED;
        Long validUntil = v != null ? v.validUntil : null;
        VerificationStatus status = VerificationStatus.effective(recorded, validUntil, System.currentTimeMillis());
        boolean lapsed = recorded == VerificationStatus.APPROVED && status != recorded;

        StatusStyles.verification(b.statusChip, status);
        b.reviewerNote.setVisibility(View.GONE);
        b.contactSupport.setVisibility(View.GONE);
        switch (status) {
            case APPROVED:
                b.statusTitle.setText(R.string.pv_approved_title);
                b.statusMessage.setText(validUntil != null
                        ? getString(R.string.pv_approved_until, DateFormat.getDateInstance(DateFormat.MEDIUM).format(new Date(validUntil)))
                        : getString(R.string.pv_approved_message));
                break;
            case SUBMITTED:
            case UNDER_REVIEW:
                b.statusTitle.setText(R.string.ph_verify_pending_title);
                b.statusMessage.setText(R.string.ph_verify_pending_message);
                break;
            case NEEDS_RESUBMISSION:
                b.statusTitle.setText(lapsed ? R.string.pv_lapsed_title : R.string.ph_verify_resubmit_title);
                b.statusMessage.setText(lapsed ? R.string.pv_lapsed_message : R.string.ph_verify_resubmit_message);
                if (!lapsed && v.publicMessage != null && !v.publicMessage.isEmpty()) {
                    b.reviewerNote.setText(getString(R.string.pv_reviewer_note, v.publicMessage));
                    b.reviewerNote.setVisibility(View.VISIBLE);
                }
                break;
            case REJECTED:
            case SUSPENDED:
                b.statusTitle.setText(R.string.ph_verify_blocked_title);
                b.statusMessage.setText(R.string.ph_verify_blocked_message);
                if (v != null && v.publicMessage != null && !v.publicMessage.isEmpty()) {
                    b.reviewerNote.setText(getString(R.string.pv_reviewer_note, v.publicMessage));
                    b.reviewerNote.setVisibility(View.VISIBLE);
                }
                b.contactSupport.setVisibility(View.VISIBLE);
                break;
            default:
                b.statusTitle.setText(R.string.ph_verify_title);
                b.statusMessage.setText(R.string.ph_verify_message);
        }
        b.form.setVisibility(status.canSubmit() && !submitting ? View.VISIBLE : View.GONE);
    }

    private void selectType(@NonNull PassengerIdType type, @Nullable Bundle restore) {
        boolean changed = selectedType == null || !type.code.equals(selectedType.code);
        selectedType = type;
        b.idTypeLayout.setError(null);
        b.expiryLayout.setVisibility(type.hasExpiry ? View.VISIBLE : View.GONE);
        if (!type.hasExpiry) expiry.setValue(null);
        if (!changed && restore == null) return;
        for (DocumentSlotView s : slots.values()) s.reset();
        slots.clear();
        b.slots.removeAllViews();
        List<String> sides = type.sides != null && !type.sides.isEmpty() ? type.sides : java.util.Collections.singletonList("FRONT");
        for (String side : sides) {
            DocumentSlotView slot = new DocumentSlotView(this);
            slot.bind(side, sideTitle(side), null, this);
            android.widget.LinearLayout.LayoutParams lp = new android.widget.LinearLayout.LayoutParams(
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.topMargin = getResources().getDimensionPixelSize(R.dimen.space_md);
            b.slots.addView(slot, lp);
            slots.put(side, slot);
        }
        DocumentSlotView.restoreAll(restore, uid, slots.values());
    }

    private CharSequence sideTitle(String side) {
        if ("BACK".equals(side)) return getString(R.string.slot_back);
        if ("PHOTO".equals(side)) return getString(R.string.slot_photo);
        return getString(R.string.slot_front);
    }

    @Override
    public void onCaptureRequested(@NonNull DocumentSlotView slot, boolean camera) {
        if (camera) capture.takePhoto(slot.getKey());
        else capture.pickPhoto(slot.getKey());
    }

    @Override
    public void onStateChanged(@NonNull DocumentSlotView slot) {
        b.error.setVisibility(View.GONE);
    }

    private void submit() {
        if (submitting) return;
        showError(null);
        boolean ok = true;
        if (selectedType == null) {
            b.idTypeLayout.setError(getString(R.string.pv_choose_type));
            ok = false;
        }
        String name = Names.normalize(b.name.getText() != null ? b.name.getText().toString() : "");
        if (!Names.isValidPersonName(name)) {
            b.nameLayout.setError(getString(R.string.pv_name_invalid));
            ok = false;
        } else {
            b.nameLayout.setError(null);
        }
        if (selectedType != null && selectedType.hasExpiry) {
            if (expiry.getValue() == null) {
                b.expiryLayout.setError(getString(R.string.pv_expiry_required));
                ok = false;
            } else if (!DateInputs.isNotExpired(expiry.getValue(), DateInputs.todayInService())) {
                b.expiryLayout.setError(getString(R.string.err_document_expired));
                ok = false;
            } else {
                b.expiryLayout.setError(null);
            }
        }
        Map<String, String> uploads = new LinkedHashMap<>();
        for (DocumentSlotView s : slots.values()) {
            if (s.getState() == DocumentSlotView.State.UPLOADING) {
                showError(getString(R.string.pv_wait_upload));
                return;
            }
            if (s.getUploadId() == null) {
                showError(getString(R.string.pv_photos_required));
                return;
            }
            uploads.put(s.getKey(), s.getUploadId());
        }
        if (!ok || selectedType == null) return;

        setSubmitting(true);
        VerificationRepository.get().submit(selectedType.code, name, selectedType.hasExpiry ? expiry.getValue() : null, uploads)
                .addOnCompleteListener(this, t -> {
                    setSubmitting(false);
                    if (t.isSuccessful()) {
                        // The staged uploads were consumed by the backend.
                        slots.clear();
                        b.slots.removeAllViews();
                        ImageCapture.clearCaptures(this);
                        Toast.makeText(this, R.string.pv_submitted, Toast.LENGTH_LONG).show();
                        b.form.setVisibility(View.GONE);
                    } else {
                        AppException e = AppException.from(t.getException());
                        showError(ErrorMessages.of(this, e));
                    }
                });
    }

    private void setSubmitting(boolean value) {
        submitting = value;
        b.submit.setEnabled(!value);
        b.submit.setText(value ? R.string.pv_submitting : R.string.pv_submit);
        b.idType.setEnabled(!value);
        b.name.setEnabled(!value);
        b.expiry.setEnabled(!value);
    }

    private void showError(@Nullable String message) {
        b.error.setVisibility(message != null ? View.VISIBLE : View.GONE);
        b.error.setText(message);
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        // Policy not loaded yet: carry the earlier saved state forward (written first so current state wins).
        if (pendingRestore != null) outState.putAll(pendingRestore);
        else DocumentSlotView.saveAll(outState, slots.values());
        capture.saveState(outState);
        if (selectedType != null) outState.putString(STATE_TYPE, selectedType.code);
        outState.putString(STATE_EXPIRY, expiry.getValue());
    }
}
