package ph.grabcycle.app.ui.driver;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

import ph.grabcycle.app.R;
import ph.grabcycle.app.data.AuthRepository;
import ph.grabcycle.app.data.ConfigRepository;
import ph.grabcycle.app.data.DocState;
import ph.grabcycle.app.data.DriverRepository;
import ph.grabcycle.app.databinding.ActivityDocumentCaptureBinding;
import ph.grabcycle.app.model.DocumentPolicy;
import ph.grabcycle.app.model.DriverDocument;
import ph.grabcycle.app.model.DriverRequirement;
import ph.grabcycle.app.ui.common.BaseActivity;
import ph.grabcycle.app.ui.common.DateField;
import ph.grabcycle.app.ui.common.DocumentSlotView;
import ph.grabcycle.app.ui.common.ErrorMessages;
import ph.grabcycle.app.ui.common.ImageCapture;
import ph.grabcycle.app.ui.common.Insets;
import ph.grabcycle.core.util.DateInputs;

/**
 * Captures and submits one accreditation document (as defined by the
 * configurable document policy). The submission goes to human review; an
 * already-approved version stays valid until the new one is decided.
 */
public class DocumentCaptureActivity extends BaseActivity implements DocumentSlotView.Listener {

    private static final String EXTRA_CODE = "requirementCode";
    private static final String STATE_EXPIRY = "expiry";

    public static Intent intent(@NonNull Context c, @NonNull String requirementCode) {
        return new Intent(c, DocumentCaptureActivity.class).putExtra(EXTRA_CODE, requirementCode);
    }

    private ActivityDocumentCaptureBinding b;
    private ImageCapture capture;
    private DateField expiry;
    private String uid;
    private String code;
    @Nullable private DriverRequirement requirement;
    @Nullable private Bundle pendingRestore;
    private final Map<String, DocumentSlotView> slots = new LinkedHashMap<>();
    private boolean submitting;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        uid = AuthRepository.get().uid();
        code = getIntent().getStringExtra(EXTRA_CODE);
        if (uid == null || code == null) {
            finish();
            return;
        }
        b = ActivityDocumentCaptureBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.root, true, true);
        b.toolbar.setNavigationOnClickListener(v -> finish());
        pendingRestore = savedInstanceState;

        capture = new ImageCapture(this, savedInstanceState, new ImageCapture.Callback() {
            @Override
            public void onImage(@NonNull String slotKey, @NonNull Uri uri, boolean fromCamera) {
                DocumentSlotView slot = slots.get(slotKey);
                if (slot != null) slot.startUpload(uid, uri);
            }

            @Override
            public void onCancelled(@NonNull String slotKey) {
                // The slot keeps its previous state.
            }
        });
        expiry = new DateField(b.expiry, getSupportFragmentManager(), R.string.pv_expiry);
        if (savedInstanceState != null) expiry.setValue(savedInstanceState.getString(STATE_EXPIRY));
        b.submit.setOnClickListener(v -> submit());

        b.state.showLoading(null);
        ConfigRepository.get().documentPolicy().observe(this, this::onPolicy);
        DriverRepository.get().documents(uid).observe(this, s -> {
            if (s.data == null) return;
            for (DriverDocument d : s.data) {
                if (code.equals(d.requirementCode) && d.lastDecision != null && d.lastDecision.publicMessage != null
                        && !d.lastDecision.publicMessage.isEmpty() && d.pending == null) {
                    b.reviewerNote.setText(getString(R.string.pv_reviewer_note, d.lastDecision.publicMessage));
                    b.reviewerNote.setVisibility(View.VISIBLE);
                }
            }
        });
    }

    private void onPolicy(DocState<DocumentPolicy> s) {
        if (s.data == null) {
            if (!s.loading) b.state.showError(getString(R.string.config_missing_title), getString(R.string.config_missing_message), null);
            return;
        }
        DriverRequirement found = null;
        if (s.data.driverRequirements != null) {
            for (DriverRequirement r : s.data.driverRequirements) if (code.equals(r.code) && r.active) found = r;
        }
        if (found == null) {
            b.state.showError(getString(R.string.dc_unavailable_title), getString(R.string.dc_unavailable_message), null);
            b.content.setVisibility(View.GONE);
            return;
        }
        boolean first = requirement == null;
        requirement = found;
        b.state.hide();
        b.content.setVisibility(View.VISIBLE);
        b.toolbar.setTitle(found.label);
        b.description.setText(found.description != null ? found.description : getString(R.string.dc_default_description, found.label));
        b.regulatoryNote.setVisibility(found.regulatoryNote != null && !found.regulatoryNote.isEmpty() ? View.VISIBLE : View.GONE);
        b.regulatoryNote.setText(found.regulatoryNote);
        b.expiryLayout.setVisibility(found.hasExpiry ? View.VISIBLE : View.GONE);
        b.numberLayout.setVisibility(found.numberField != null ? View.VISIBLE : View.GONE);
        if (found.numberField != null) {
            b.numberLayout.setHint(found.numberField.required ? found.numberField.label : getString(R.string.do_optional, found.numberField.label));
        }
        if (first) buildSlots(found);
    }

    private void buildSlots(@NonNull DriverRequirement req) {
        List<String> sides = req.sides != null && !req.sides.isEmpty() ? req.sides : Collections.singletonList("PHOTO");
        for (String side : sides) {
            DocumentSlotView slot = new DocumentSlotView(this);
            CharSequence hint = req.publishAsProfilePhoto ? getString(R.string.dc_profile_photo_hint) : null;
            slot.bind(side, sideTitle(side, req), hint, this);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.topMargin = getResources().getDimensionPixelSize(R.dimen.space_md);
            b.slots.addView(slot, lp);
            slots.put(side, slot);
        }
        DocumentSlotView.restoreAll(pendingRestore, uid, slots.values());
        pendingRestore = null;
    }

    private CharSequence sideTitle(String side, DriverRequirement req) {
        if ("FRONT".equals(side)) return getString(R.string.slot_front);
        if ("BACK".equals(side)) return getString(R.string.slot_back);
        return req.label;
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
        DriverRequirement req = requirement;
        if (req == null || submitting) return;
        showError(null);
        boolean ok = true;

        String number = null;
        if (req.numberField != null) {
            String n = b.number.getText() != null ? b.number.getText().toString().trim().toUpperCase(Locale.US) : "";
            if (n.isEmpty()) {
                if (req.numberField.required) {
                    b.numberLayout.setError(getString(R.string.pf_required));
                    ok = false;
                }
            } else if (!matches(req.numberField.pattern, n)) {
                b.numberLayout.setError(getString(R.string.dc_number_invalid, req.numberField.label));
                ok = false;
            } else {
                b.numberLayout.setError(null);
                number = n;
            }
        }
        if (req.hasExpiry) {
            String e = expiry.getValue();
            if (e == null) {
                b.expiryLayout.setError(getString(R.string.pv_expiry_required));
                ok = false;
            } else if (!DateInputs.isNotExpired(e, DateInputs.todayInService())) {
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
        if (!ok) return;

        setSubmitting(true);
        DriverRepository.get().submitDocument(req.code, uploads, req.hasExpiry ? expiry.getValue() : null, number)
                .addOnCompleteListener(this, t -> {
                    setSubmitting(false);
                    if (t.isSuccessful()) {
                        slots.clear();
                        ImageCapture.clearCaptures(this);
                        Toast.makeText(this, R.string.dc_submitted, Toast.LENGTH_LONG).show();
                        finish();
                    } else {
                        showError(ErrorMessages.of(this, t.getException()));
                    }
                });
    }

    /** The policy pattern is admin-configured; an invalid one is left to the backend to judge. */
    private static boolean matches(@Nullable String pattern, @NonNull String value) {
        if (pattern == null || pattern.isEmpty()) return true;
        try {
            return Pattern.compile(pattern).matcher(value).matches();
        } catch (PatternSyntaxException e) {
            return true;
        }
    }

    private void setSubmitting(boolean value) {
        submitting = value;
        b.submit.setEnabled(!value);
        b.submit.setText(value ? R.string.pv_submitting : R.string.pv_submit);
    }

    private void showError(@Nullable String message) {
        b.error.setVisibility(message != null ? View.VISIBLE : View.GONE);
        b.error.setText(message);
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        // Policy not loaded yet: carry the earlier saved slots forward (written first so current state wins).
        if (pendingRestore != null) outState.putAll(pendingRestore);
        else DocumentSlotView.saveAll(outState, slots.values());
        capture.saveState(outState);
        outState.putString(STATE_EXPIRY, expiry.getValue());
    }
}
