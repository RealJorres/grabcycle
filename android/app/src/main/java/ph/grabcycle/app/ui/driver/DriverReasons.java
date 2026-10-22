package ph.grabcycle.app.ui.driver;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.Locale;
import java.util.Map;

import ph.grabcycle.app.R;

/** Human text for the backend's driver eligibility reason codes. */
public final class DriverReasons {
    private DriverReasons() {}

    public static String label(@NonNull Context c, @NonNull String reason) {
        return label(c, reason, null);
    }

    /**
     * @param requirementLabels requirement code → display label from the
     *                          document policy, when the caller has it
     */
    public static String label(@NonNull Context c, @NonNull String reason, @Nullable Map<String, String> requirementLabels) {
        int sep = reason.indexOf(':');
        String code = sep > 0 ? reason.substring(0, sep) : reason;
        String arg = sep > 0 ? reason.substring(sep + 1) : null;
        String doc = arg == null ? "" : requirementLabels != null && requirementLabels.containsKey(arg) ? requirementLabels.get(arg) : prettify(arg);
        switch (code) {
            case "ACCOUNT_NOT_ACTIVE": return c.getString(R.string.dreason_account_not_active);
            case "DRIVER_SUSPENDED": return c.getString(R.string.dreason_suspended);
            case "DRIVER_NOT_APPROVED": return c.getString(R.string.dreason_not_approved);
            case "VEHICLE_NOT_APPROVED": return c.getString(R.string.dreason_vehicle);
            case "DOCUMENT_MISSING": return c.getString(R.string.dreason_document_missing, doc);
            case "DOCUMENT_EXPIRED": return c.getString(R.string.dreason_document_expired, doc);
            default: return prettify(reason);
        }
    }

    /** "DRIVERS_LICENSE" → "Drivers license" (fallback when no label is known). */
    static String prettify(@NonNull String code) {
        String s = code.replace('_', ' ').toLowerCase(Locale.US).trim();
        return s.isEmpty() ? code : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }
}
