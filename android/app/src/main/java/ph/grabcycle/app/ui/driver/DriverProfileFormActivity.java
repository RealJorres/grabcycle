package ph.grabcycle.app.ui.driver;

import android.os.Bundle;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.android.material.textfield.TextInputLayout;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

import ph.grabcycle.app.R;
import ph.grabcycle.app.data.AuthRepository;
import ph.grabcycle.app.data.ConfigRepository;
import ph.grabcycle.app.data.DriverRepository;
import ph.grabcycle.app.databinding.ActivityDriverProfileFormBinding;
import ph.grabcycle.app.model.DriverProfile;
import ph.grabcycle.app.model.VehicleInfo;
import ph.grabcycle.app.ui.common.BaseActivity;
import ph.grabcycle.app.ui.common.ErrorMessages;
import ph.grabcycle.app.ui.common.Insets;

/**
 * Driver municipality and tricycle details. Validation mirrors the backend
 * schema for fast feedback; the backend re-validates and puts a changed
 * vehicle back into review.
 */
public class DriverProfileFormActivity extends BaseActivity {

    private static final Pattern PLATE = Pattern.compile("^[A-Z0-9][A-Z0-9 -]{3,11}$");
    private static final Pattern BODY = Pattern.compile("^[A-Z0-9-]{1,12}$");

    private ActivityDriverProfileFormBinding b;
    private final List<String> municipalities = new ArrayList<>();
    @Nullable private DriverProfile driver;
    private boolean filled;
    private boolean saving;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String uid = AuthRepository.get().uid();
        if (uid == null) {
            finish();
            return;
        }
        b = ActivityDriverProfileFormBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.root, true, true);
        b.toolbar.setNavigationOnClickListener(v -> finish());
        // Views restore their own text after rotation; only prefill on first creation.
        filled = savedInstanceState != null;

        ConfigRepository.get().serviceArea().observe(this, s -> {
            municipalities.clear();
            if (s.data != null && s.data.municipalities != null) municipalities.addAll(s.data.municipalities);
            ArrayAdapter<String> a = new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, municipalities);
            b.municipality.setAdapter(a);
            b.franchise.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, municipalities));
        });
        DriverRepository.get().driver(uid).observe(this, s -> {
            driver = s.data;
            boolean approvedVehicle = driver != null && driver.vehicle != null && "APPROVED".equals(driver.vehicle.status);
            b.reviewWarning.setVisibility(approvedVehicle ? View.VISIBLE : View.GONE);
            if (!filled && s.data != null) {
                filled = true;
                prefill(s.data);
            }
        });
        b.save.setOnClickListener(v -> save());
    }

    private void prefill(@NonNull DriverProfile d) {
        if (d.profile != null && d.profile.municipality != null) b.municipality.setText(d.profile.municipality, false);
        VehicleInfo v = d.vehicle;
        if (v == null) return;
        b.plate.setText(v.plateNumber);
        b.bodyNumber.setText(v.bodyNumber);
        b.make.setText(v.make);
        b.model.setText(v.model);
        b.color.setText(v.color);
        if (v.capacity > 0) b.capacity.setText(String.valueOf(v.capacity));
        if (v.franchiseMunicipality != null) b.franchise.setText(v.franchiseMunicipality, false);
    }

    private void save() {
        if (saving) return;
        showError(null);
        String municipality = text(b.municipality);
        String franchise = text(b.franchise);
        String plate = text(b.plate).toUpperCase(Locale.US);
        String body = text(b.bodyNumber).toUpperCase(Locale.US);
        String make = text(b.make);
        String model = text(b.model);
        String color = text(b.color);
        int capacity;
        try {
            capacity = Integer.parseInt(text(b.capacity));
        } catch (NumberFormatException e) {
            capacity = -1;
        }

        boolean ok = check(b.municipalityLayout, municipalities.contains(municipality), R.string.pf_choose_municipality);
        ok &= check(b.plateLayout, PLATE.matcher(plate).matches(), R.string.pf_plate_invalid);
        ok &= check(b.bodyNumberLayout, BODY.matcher(body).matches(), R.string.pf_body_invalid);
        ok &= check(b.makeLayout, make.length() >= 2, R.string.pf_required);
        ok &= check(b.modelLayout, !model.isEmpty(), R.string.pf_required);
        ok &= check(b.colorLayout, color.length() >= 3, R.string.pf_required);
        ok &= check(b.capacityLayout, capacity >= 1 && capacity <= 8, R.string.pf_capacity_invalid);
        ok &= check(b.franchiseLayout, municipalities.contains(franchise), R.string.pf_choose_municipality);
        if (!ok) return;

        Map<String, Object> vehicle = new HashMap<>();
        vehicle.put("plateNumber", plate);
        vehicle.put("bodyNumber", body);
        vehicle.put("make", make);
        vehicle.put("model", model);
        vehicle.put("color", color);
        vehicle.put("capacity", capacity);
        vehicle.put("franchiseMunicipality", franchise);
        setSaving(true);
        DriverRepository.get().saveProfile(municipality, vehicle).addOnCompleteListener(this, t -> {
            setSaving(false);
            if (t.isSuccessful()) {
                Toast.makeText(this, R.string.pf_saved, Toast.LENGTH_SHORT).show();
                finish();
            } else {
                showError(ErrorMessages.of(this, t.getException()));
            }
        });
    }

    private boolean check(TextInputLayout layout, boolean valid, int error) {
        layout.setError(valid ? null : getString(error));
        return valid;
    }

    private void setSaving(boolean value) {
        saving = value;
        b.save.setEnabled(!value);
    }

    private void showError(@Nullable String message) {
        b.error.setVisibility(message != null ? View.VISIBLE : View.GONE);
        b.error.setText(message);
    }

    private static String text(EditText e) {
        return e.getText() != null ? e.getText().toString().trim().replaceAll("\\s+", " ") : "";
    }
}
