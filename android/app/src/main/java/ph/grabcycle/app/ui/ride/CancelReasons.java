package ph.grabcycle.app.ui.ride;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.RadioButton;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import ph.grabcycle.app.R;
import ph.grabcycle.app.databinding.DialogCancelReasonBinding;

/** Cancellation reason pickers (codes match the backend allow-lists). */
public final class CancelReasons {
    private CancelReasons() {}

    public interface OnReason {
        void onReason(@NonNull String code);
    }

    private static final String[] PASSENGER_CODES = {"CHANGED_MIND", "WAIT_TOO_LONG", "WRONG_PICKUP", "DRIVER_ASKED_TO_CANCEL", "FOUND_OTHER_RIDE", "SAFETY", "OTHER"};
    private static final int[] PASSENGER_LABELS = {R.string.cancel_changed_mind, R.string.cancel_wait_too_long, R.string.cancel_wrong_pickup,
            R.string.cancel_driver_asked, R.string.cancel_found_other, R.string.cancel_safety, R.string.cancel_other};

    private static final String[] DRIVER_CODES = {"VEHICLE_PROBLEM", "UNSAFE_PICKUP", "PASSENGER_ASKED", "SAFETY", "OTHER"};
    private static final int[] DRIVER_LABELS = {R.string.cancel_vehicle_problem, R.string.cancel_unsafe_pickup, R.string.cancel_passenger_asked,
            R.string.cancel_safety, R.string.cancel_other};

    public static void pickPassenger(@NonNull Context c, @NonNull CharSequence warning, @NonNull OnReason cb) {
        pick(c, warning, PASSENGER_CODES, PASSENGER_LABELS, cb);
    }

    public static void pickDriver(@NonNull Context c, @NonNull OnReason cb) {
        pick(c, c.getString(R.string.cancel_driver_warning), DRIVER_CODES, DRIVER_LABELS, cb);
    }

    /**
     * A message and a choice list cannot share a standard alert dialog, so the
     * warning and the reasons live in one custom view. The dialog stays open
     * until a reason is chosen.
     */
    private static void pick(Context c, CharSequence warning, String[] codes, int[] labels, OnReason cb) {
        DialogCancelReasonBinding v = DialogCancelReasonBinding.inflate(LayoutInflater.from(c));
        v.warning.setText(warning);
        for (int i = 0; i < labels.length; i++) {
            RadioButton rb = new RadioButton(c);
            rb.setId(View.generateViewId());
            rb.setTag(codes[i]);
            rb.setText(labels[i]);
            rb.setMinHeight(c.getResources().getDimensionPixelSize(R.dimen.touch_target));
            v.reasons.addView(rb);
        }
        v.reasons.setOnCheckedChangeListener((g, id) -> v.error.setVisibility(View.GONE));
        AlertDialog dialog = new MaterialAlertDialogBuilder(c)
                .setTitle(R.string.cancel_title)
                .setView(v.getRoot())
                .setNegativeButton(R.string.cancel_keep_ride, null)
                .setPositiveButton(R.string.cancel_confirm, null)
                .create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(btn -> {
            View checked = v.reasons.findViewById(v.reasons.getCheckedRadioButtonId());
            if (checked == null) {
                v.error.setVisibility(View.VISIBLE);
                return;
            }
            dialog.dismiss();
            cb.onReason((String) checked.getTag());
        }));
        dialog.show();
    }
}
