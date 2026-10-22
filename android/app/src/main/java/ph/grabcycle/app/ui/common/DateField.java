package ph.grabcycle.app.ui.common;

import android.widget.EditText;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.StringRes;
import androidx.fragment.app.FragmentManager;

import com.google.android.material.datepicker.CalendarConstraints;
import com.google.android.material.datepicker.DateValidatorPointForward;
import com.google.android.material.datepicker.MaterialDatePicker;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;

import ph.grabcycle.core.util.DateInputs;

/**
 * Read-only text field that opens a calendar for expiry dates. Holds the
 * value in wire format (YYYY-MM-DD) and shows it in a readable form. Dates
 * before today (Asia/Manila) cannot be picked; the backend re-validates.
 */
public final class DateField {

    private final EditText field;
    @Nullable private String value;

    public DateField(@NonNull EditText field, @NonNull FragmentManager fm, @StringRes int title) {
        this.field = field;
        field.setFocusable(false);
        field.setCursorVisible(false);
        field.setOnClickListener(v -> {
            long today = DateInputs.todayInService().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
            LocalDate current = value != null ? DateInputs.parse(value) : null;
            MaterialDatePicker<Long> picker = MaterialDatePicker.Builder.datePicker()
                    .setTitleText(title)
                    .setInputMode(MaterialDatePicker.INPUT_MODE_CALENDAR)
                    .setSelection(current != null ? current.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() : today)
                    .setCalendarConstraints(new CalendarConstraints.Builder()
                            .setStart(today)
                            .setValidator(DateValidatorPointForward.from(today)).build())
                    .build();
            picker.addOnPositiveButtonClickListener(sel -> {
                // The picker reports UTC midnight of the chosen calendar day.
                LocalDate d = Instant.ofEpochMilli(sel).atZone(ZoneOffset.UTC).toLocalDate();
                setValue(DateInputs.toWire(d.getYear(), d.getMonthValue(), d.getDayOfMonth()));
            });
            picker.show(fm, "date-" + field.getId());
        });
    }

    @Nullable
    public String getValue() {
        return value;
    }

    public void setValue(@Nullable String wire) {
        value = wire != null && DateInputs.parse(wire) != null ? wire : null;
        field.setText(value != null ? DateInputs.forDisplay(value) : "");
    }
}
