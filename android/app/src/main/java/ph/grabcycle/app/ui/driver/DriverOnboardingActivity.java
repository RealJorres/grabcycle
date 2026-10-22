package ph.grabcycle.app.ui.driver;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import ph.grabcycle.app.R;
import ph.grabcycle.app.data.AppException;
import ph.grabcycle.app.data.AuthRepository;
import ph.grabcycle.app.data.ConfigRepository;
import ph.grabcycle.app.data.DocState;
import ph.grabcycle.app.data.DriverRepository;
import ph.grabcycle.app.databinding.ActivityDriverOnboardingBinding;
import ph.grabcycle.app.databinding.ItemRequirementBinding;
import ph.grabcycle.app.model.DocumentPolicy;
import ph.grabcycle.app.model.DriverDocument;
import ph.grabcycle.app.model.DriverProfile;
import ph.grabcycle.app.model.DriverRequirement;
import ph.grabcycle.app.ui.common.BaseActivity;
import ph.grabcycle.app.ui.common.ErrorMessages;
import ph.grabcycle.app.ui.common.Insets;
import ph.grabcycle.app.ui.common.StatusStyles;
import ph.grabcycle.core.model.DocumentStatus;
import ph.grabcycle.core.model.DriverStatus;
import ph.grabcycle.core.util.DateInputs;

/**
 * Accreditation checklist: driver/vehicle details, each required document and
 * the application. Every status shown comes from backend-written records;
 * submitting never approves anything.
 */
public class DriverOnboardingActivity extends BaseActivity {

    private ActivityDriverOnboardingBinding b;
    @Nullable private DriverProfile driver;
    @Nullable private DocumentPolicy policy;
    private final Map<String, DriverDocument> documents = new HashMap<>();
    private boolean driverLoaded;
    private boolean busy;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String uid = AuthRepository.get().uid();
        if (uid == null) {
            finish();
            return;
        }
        b = ActivityDriverOnboardingBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.root, true, true);
        b.toolbar.setNavigationOnClickListener(v -> finish());
        b.state.showLoading(null);
        b.profileRow.icon.setImageResource(R.drawable.ic_tricycle);
        b.profileRow.title.setText(R.string.do_profile_title);
        b.profileRow.getRoot().setOnClickListener(v -> startActivity(new Intent(this, DriverProfileFormActivity.class)));
        b.submit.setOnClickListener(v -> submitApplication());
        b.refresh.setOnClickListener(v -> refreshEligibility());

        DriverRepository repo = DriverRepository.get();
        repo.driver(uid).observe(this, s -> {
            driverLoaded = s.data != null || !s.loading;
            driver = s.data;
            if (s.data == null && !s.loading && s.error != null) {
                b.state.showError(getString(R.string.err_generic), ErrorMessages.of(this, s.error), null);
                return;
            }
            render();
        });
        repo.documents(uid).observe(this, s -> {
            documents.clear();
            if (s.data != null) for (DriverDocument d : s.data) if (d.requirementCode != null) documents.put(d.requirementCode, d);
            render();
        });
        ConfigRepository.get().documentPolicy().observe(this, this::onPolicy);
    }

    private void onPolicy(DocState<DocumentPolicy> s) {
        if (s.data == null && !s.loading) {
            b.state.showError(getString(R.string.config_missing_title), getString(R.string.config_missing_message), null);
            return;
        }
        policy = s.data;
        render();
    }

    private List<DriverRequirement> activeRequirements() {
        List<DriverRequirement> out = new ArrayList<>();
        if (policy != null && policy.driverRequirements != null) {
            for (DriverRequirement r : policy.driverRequirements) if (r.active && r.code != null) out.add(r);
        }
        return out;
    }

    private void render() {
        if (policy == null || !driverLoaded) return;
        b.state.hide();
        b.content.setVisibility(View.VISIBLE);
        DriverStatus status = DriverStatus.fromWire(driver != null ? driver.status : null);
        if (driver == null) status = DriverStatus.PROFILE_INCOMPLETE;
        renderStatus(status);

        // Step 1: profile and vehicle.
        boolean profileDone = driver != null && driver.profile != null && driver.vehicle != null;
        if (!profileDone) {
            b.profileRow.subtitle.setText(R.string.do_profile_missing);
            StatusStyles.apply(b.profileRow.status, R.string.do_to_do, "WARNING");
        } else {
            b.profileRow.subtitle.setText(getString(R.string.do_profile_summary, driver.vehicle.plateNumber, driver.vehicle.bodyNumber));
            String v = driver.vehicle.status;
            if ("APPROVED".equals(v)) StatusStyles.apply(b.profileRow.status, R.string.do_vehicle_approved, "SUCCESS");
            else if ("REJECTED".equals(v) || "NEEDS_RESUBMISSION".equals(v)) StatusStyles.apply(b.profileRow.status, R.string.do_vehicle_needs_changes, "DANGER");
            else StatusStyles.apply(b.profileRow.status, R.string.do_vehicle_pending, "INFO");
            if (driver.vehicle.publicMessage != null && !driver.vehicle.publicMessage.isEmpty()) {
                b.profileRow.subtitle.append("\n" + getString(R.string.pv_reviewer_note, driver.vehicle.publicMessage));
            }
        }

        // Step 2: documents.
        b.samplePolicy.setVisibility(policy.isSample ? View.VISIBLE : View.GONE);
        b.documents.removeAllViews();
        LocalDate today = DateInputs.todayInService();
        int missingMandatory = 0;
        for (DriverRequirement req : activeRequirements()) {
            DriverDocument doc = documents.get(req.code);
            DocumentStatus ds = doc == null ? DocumentStatus.NOT_SUBMITTED : DocumentStatus.derive(doc.pending != null, doc.approved != null,
                    doc.approved != null ? doc.approved.expiryDate : null, doc.lastDecision != null ? doc.lastDecision.decision : null, today);
            if (req.mandatory && ds.needsAction()) missingMandatory++;

            ItemRequirementBinding row = ItemRequirementBinding.inflate(getLayoutInflater(), b.documents, true);
            row.title.setText(req.mandatory ? req.label : getString(R.string.do_optional, req.label));
            StatusStyles.document(row.status, ds);
            row.subtitle.setText(documentSubtitle(req, doc, ds));
            boolean canOpen = ds.canSubmit() && profileDone;
            row.chevron.setVisibility(canOpen ? View.VISIBLE : View.INVISIBLE);
            row.getRoot().setEnabled(canOpen);
            row.getRoot().setOnClickListener(canOpen ? v -> startActivity(DocumentCaptureActivity.intent(this, req.code)) : null);
        }

        // Step 3: application.
        boolean submitted = driver != null && driver.applicationSubmittedAt != null;
        boolean reviewing = status == DriverStatus.UNDER_REVIEW;
        boolean canSubmit = profileDone && missingMandatory == 0 && !reviewing && (!submitted || status.needsDriverAction());
        b.submit.setVisibility(status == DriverStatus.APPROVED || status == DriverStatus.SUSPENDED || status == DriverStatus.REJECTED ? View.GONE : View.VISIBLE);
        b.submit.setEnabled(canSubmit && !busy);
        b.submit.setText(submitted ? R.string.do_resubmit : R.string.do_submit);
        if (reviewing) b.submitHint.setText(R.string.do_hint_reviewing);
        else if (!profileDone) b.submitHint.setText(R.string.do_hint_profile);
        else if (missingMandatory > 0) b.submitHint.setText(getResources().getQuantityString(R.plurals.do_hint_documents, missingMandatory, missingMandatory));
        else b.submitHint.setText("");
    }

    private void renderStatus(DriverStatus status) {
        StatusStyles.driver(b.statusChip, status);
        b.reasons.setVisibility(View.GONE);
        b.refresh.setVisibility(View.GONE);
        switch (status) {
            case UNDER_REVIEW:
                b.statusTitle.setText(R.string.dh_review_title);
                b.statusMessage.setText(R.string.dh_review_message);
                break;
            case APPROVED:
                boolean eligible = driver != null && driver.eligibility != null && driver.eligibility.eligible;
                b.statusTitle.setText(eligible ? R.string.do_approved_title : R.string.dh_ineligible_title);
                b.statusMessage.setText(eligible ? R.string.do_approved_message : R.string.dh_ineligible_message);
                if (!eligible && driver.eligibility != null && driver.eligibility.reasons != null && !driver.eligibility.reasons.isEmpty()) {
                    StringBuilder sb = new StringBuilder();
                    Map<String, String> labels = requirementLabels();
                    for (String r : driver.eligibility.reasons) {
                        if (sb.length() > 0) sb.append('\n');
                        sb.append("• ").append(DriverReasons.label(this, r, labels));
                    }
                    b.reasons.setText(sb);
                    b.reasons.setVisibility(View.VISIBLE);
                }
                b.refresh.setVisibility(View.VISIBLE);
                break;
            case SUSPENDED:
            case REJECTED:
                b.statusTitle.setText(R.string.dh_blocked_title);
                b.statusMessage.setText(driver != null && driver.decision != null && driver.decision.publicMessage != null
                        ? driver.decision.publicMessage : getString(R.string.dh_blocked_message));
                break;
            case NEEDS_RESUBMISSION:
            case EXPIRED:
                b.statusTitle.setText(R.string.dh_action_needed_title);
                b.statusMessage.setText(driver != null && driver.decision != null && driver.decision.publicMessage != null
                        ? driver.decision.publicMessage : getString(R.string.dh_action_needed_message));
                b.refresh.setVisibility(View.VISIBLE);
                break;
            default:
                b.statusTitle.setText(R.string.dh_setup_title);
                b.statusMessage.setText(R.string.dh_setup_message);
        }
    }

    private Map<String, String> requirementLabels() {
        Map<String, String> m = new HashMap<>();
        for (DriverRequirement r : activeRequirements()) m.put(r.code, r.label);
        return m;
    }

    @NonNull
    private CharSequence documentSubtitle(DriverRequirement req, @Nullable DriverDocument doc, DocumentStatus ds) {
        StringBuilder sb = new StringBuilder();
        if (doc != null && doc.approved != null && doc.approved.expiryDate != null) {
            sb.append(getString(ds == DocumentStatus.EXPIRED ? R.string.do_expired_on : R.string.do_valid_until, DateInputs.forDisplay(doc.approved.expiryDate)));
        }
        if (ds == DocumentStatus.PENDING_REVIEW && doc != null && doc.approved != null) {
            if (sb.length() > 0) sb.append(" · ");
            sb.append(getString(R.string.do_renewal_reviewing));
        }
        if (doc != null && doc.lastDecision != null && doc.lastDecision.publicMessage != null && !doc.lastDecision.publicMessage.isEmpty()
                && (ds == DocumentStatus.NEEDS_RESUBMISSION || ds == DocumentStatus.REJECTED)) {
            if (sb.length() > 0) sb.append('\n');
            sb.append(getString(R.string.pv_reviewer_note, doc.lastDecision.publicMessage));
        }
        if (sb.length() == 0 && req.description != null) sb.append(req.description);
        return sb;
    }

    private void submitApplication() {
        if (busy) return;
        setBusy(true);
        DriverRepository.get().submitApplication().addOnCompleteListener(this, t -> {
            setBusy(false);
            if (t.isSuccessful()) Toast.makeText(this, R.string.do_submitted, Toast.LENGTH_LONG).show();
            else showError(messageFor(AppException.from(t.getException())));
        });
    }

    private void refreshEligibility() {
        if (busy) return;
        setBusy(true);
        DriverRepository.get().refreshEligibility().addOnCompleteListener(this, t -> {
            setBusy(false);
            if (!t.isSuccessful()) showError(ErrorMessages.of(this, t.getException()));
        });
    }

    private String messageFor(AppException e) {
        String base = ErrorMessages.of(this, e);
        Object missing = e.getDetails() != null ? e.getDetails().get("missing") : null;
        if (missing instanceof List && !((List<?>) missing).isEmpty()) {
            Map<String, String> labels = requirementLabels();
            StringBuilder sb = new StringBuilder(base);
            for (Object o : (List<?>) missing) {
                String code = String.valueOf(o);
                sb.append("\n• ").append(labels.containsKey(code) ? labels.get(code) : DriverReasons.prettify(code));
            }
            return sb.toString();
        }
        return base;
    }

    private void setBusy(boolean value) {
        busy = value;
        b.refresh.setEnabled(!value);
        showError(null);
        render();
    }

    private void showError(@Nullable String message) {
        b.error.setVisibility(message != null ? View.VISIBLE : View.GONE);
        b.error.setText(message);
    }
}
