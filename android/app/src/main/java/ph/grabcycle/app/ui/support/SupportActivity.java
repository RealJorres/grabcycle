package ph.grabcycle.app.ui.support;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.text.DateFormat;
import java.util.ArrayList;
import java.util.List;

import ph.grabcycle.app.R;
import ph.grabcycle.app.data.AuthRepository;
import ph.grabcycle.app.data.DocState;
import ph.grabcycle.app.data.SupportRepository;
import ph.grabcycle.app.data.UserRepository;
import ph.grabcycle.app.databinding.ActivitySupportBinding;
import ph.grabcycle.app.databinding.ItemSupportCaseBinding;
import ph.grabcycle.app.model.SupportCase;
import ph.grabcycle.app.ui.common.BaseActivity;
import ph.grabcycle.app.ui.common.ErrorMessages;
import ph.grabcycle.app.ui.common.Insets;
import ph.grabcycle.app.ui.common.StatusStyles;
import ph.grabcycle.core.model.AccountType;

/**
 * Files a support report (optionally about a ride) and lists the user's own
 * reports with GrabCycle's public responses. Safety reports are prioritised
 * by the backend; this screen is not an emergency channel and says so.
 */
public class SupportActivity extends BaseActivity {

    private static final String EXTRA_RIDE = "rideId";
    private static final int MIN_DESCRIPTION = 10;

    /** Categories in display order; codes match the backend allow-list. */
    private static final String[] CODES = {"SAFETY", "DRIVER_BEHAVIOR", "PASSENGER_BEHAVIOR", "FARE_OR_PAYMENT", "LOST_ITEM", "APP_PROBLEM", "ACCOUNT", "OTHER"};
    private static final int[] LABELS = {R.string.support_cat_safety, R.string.support_cat_driver, R.string.support_cat_passenger,
            R.string.support_cat_fare, R.string.support_cat_lost_item, R.string.support_cat_app, R.string.support_cat_account, R.string.support_cat_other};

    public static Intent intent(@NonNull Context c, @Nullable String rideId) {
        return new Intent(c, SupportActivity.class).putExtra(EXTRA_RIDE, rideId);
    }

    private ActivitySupportBinding b;
    @Nullable private String rideId;
    private final List<String> visibleCodes = new ArrayList<>();
    @Nullable private String selectedCode;
    private boolean submitting;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String uid = AuthRepository.get().uid();
        if (uid == null) {
            finish();
            return;
        }
        b = ActivitySupportBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.root, true, true);
        b.toolbar.setNavigationOnClickListener(v -> finish());
        rideId = getIntent().getStringExtra(EXTRA_RIDE);
        if (rideId != null) {
            b.rideRef.setVisibility(View.VISIBLE);
            b.rideRef.setText(getString(R.string.support_about_ride, rideId.substring(0, Math.min(8, rideId.length())).toUpperCase(java.util.Locale.US)));
        }
        if (savedInstanceState != null) selectedCode = savedInstanceState.getString("category");

        buildCategories(null);
        UserRepository.get().profile(uid).observe(this, s -> {
            if (s.data != null) buildCategories(AccountType.fromWire(s.data.accountType));
        });
        b.category.setOnItemClickListener((p, v, pos, id) -> {
            selectedCode = visibleCodes.get(pos);
            b.categoryLayout.setError(null);
        });
        b.submit.setOnClickListener(v -> submit());

        b.casesState.setVisibility(View.VISIBLE);
        b.casesState.showLoading(null);
        SupportRepository.get().myCases(uid).observe(this, this::renderCases);
    }

    /** Hides the category about one's own role (a passenger reports drivers, not passengers). */
    private void buildCategories(@Nullable AccountType type) {
        visibleCodes.clear();
        List<String> labels = new ArrayList<>();
        for (int i = 0; i < CODES.length; i++) {
            if (type == AccountType.PASSENGER && "PASSENGER_BEHAVIOR".equals(CODES[i])) continue;
            if (type == AccountType.DRIVER && "DRIVER_BEHAVIOR".equals(CODES[i])) continue;
            visibleCodes.add(CODES[i]);
            labels.add(getString(LABELS[i]));
        }
        b.category.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, labels));
        int idx = selectedCode != null ? visibleCodes.indexOf(selectedCode) : -1;
        if (idx >= 0) {
            b.category.setText(labels.get(idx), false);
        } else {
            selectedCode = null;
            b.category.setText("", false);
        }
    }

    private void submit() {
        if (submitting) return;
        showError(null);
        String description = b.description.getText() != null ? b.description.getText().toString().trim() : "";
        boolean ok = true;
        if (selectedCode == null) {
            b.categoryLayout.setError(getString(R.string.support_choose_category));
            ok = false;
        }
        if (description.length() < MIN_DESCRIPTION) {
            b.descriptionLayout.setError(getResources().getQuantityString(R.plurals.support_description_short, MIN_DESCRIPTION, MIN_DESCRIPTION));
            ok = false;
        } else {
            b.descriptionLayout.setError(null);
        }
        if (!ok) return;
        setSubmitting(true);
        SupportRepository.get().create(rideId, selectedCode, description).addOnCompleteListener(this, t -> {
            setSubmitting(false);
            if (t.isSuccessful()) {
                b.description.setText("");
                Toast.makeText(this, "SAFETY".equals(selectedCode) ? R.string.support_sent_safety : R.string.support_sent, Toast.LENGTH_LONG).show();
            } else {
                showError(ErrorMessages.of(this, t.getException()));
            }
        });
    }

    private void renderCases(DocState<List<SupportCase>> s) {
        b.cases.removeAllViews();
        if (s.data == null) {
            if (s.loading) b.casesState.showLoading(null);
            else b.casesState.showError(getString(R.string.support_cases_error), ErrorMessages.of(this, s.error), null);
            return;
        }
        if (s.data.isEmpty()) {
            b.casesState.showEmpty(R.drawable.ic_help, getString(R.string.support_no_reports), null);
            return;
        }
        b.casesState.setVisibility(View.GONE);
        DateFormat fmt = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT);
        for (SupportCase c : s.data) {
            ItemSupportCaseBinding row = ItemSupportCaseBinding.inflate(getLayoutInflater(), b.cases, true);
            row.category.setText(labelFor(c.category));
            StatusStyles.support(row.status, c.status);
            row.date.setText(c.createdAt != null ? fmt.format(c.createdAt.toDate()) : "");
            row.description.setText(c.description);
            boolean hasResponse = c.publicResponse != null && !c.publicResponse.isEmpty();
            row.response.setVisibility(hasResponse ? View.VISIBLE : View.GONE);
            if (hasResponse) row.response.setText(getString(R.string.support_response, c.publicResponse));
        }
    }

    private String labelFor(@Nullable String code) {
        for (int i = 0; i < CODES.length; i++) if (CODES[i].equals(code)) return getString(LABELS[i]);
        return getString(R.string.support_cat_other);
    }

    private void setSubmitting(boolean value) {
        submitting = value;
        b.submit.setEnabled(!value);
        b.description.setEnabled(!value);
        b.category.setEnabled(!value);
    }

    private void showError(@Nullable String message) {
        b.error.setVisibility(message != null ? View.VISIBLE : View.GONE);
        b.error.setText(message);
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putString("category", selectedCode);
    }
}
