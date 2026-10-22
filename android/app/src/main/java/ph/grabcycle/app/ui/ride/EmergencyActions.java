package ph.grabcycle.app.ui.ride;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import ph.grabcycle.app.R;
import ph.grabcycle.app.config.AppConfig;
import ph.grabcycle.app.data.SupportRepository;
import ph.grabcycle.app.model.EmergencyContact;
import ph.grabcycle.app.model.Ride;

/**
 * Emergency options during a trip. Clearly scoped: it opens the phone dialer
 * for the national emergency hotline and lets the passenger text their own
 * emergency contact. It does NOT automatically alert GrabCycle or emergency
 * services; an urgent safety report can be filed with GrabCycle support.
 */
public final class EmergencyActions {
    private EmergencyActions() {}

    public static void show(@NonNull Context c, @NonNull Ride ride, @Nullable EmergencyContact contact) {
        CharSequence[] items = {
                c.getString(R.string.emergency_call_hotline, AppConfig.EMERGENCY_HOTLINE),
                contact != null ? c.getString(R.string.emergency_text_contact, contact.name) : c.getString(R.string.emergency_no_contact),
                c.getString(R.string.emergency_report)
        };
        new MaterialAlertDialogBuilder(c)
                .setTitle(R.string.emergency_title)
                .setMessage(R.string.emergency_disclaimer)
                .setItems(items, (d, which) -> {
                    if (which == 0) dial(c, AppConfig.EMERGENCY_HOTLINE);
                    else if (which == 1 && contact != null) textContact(c, contact, ride);
                    else if (which == 2) report(c, ride);
                })
                .setNegativeButton(R.string.action_close, null)
                .show();
    }

    public static void dial(@NonNull Context c, @NonNull String number) {
        try {
            c.startActivity(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + number)));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(c, R.string.err_generic, Toast.LENGTH_SHORT).show();
        }
    }

    public static void sms(@NonNull Context c, @NonNull String number, @NonNull String body) {
        try {
            c.startActivity(new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + number)).putExtra("sms_body", body));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(c, R.string.err_generic, Toast.LENGTH_SHORT).show();
        }
    }

    private static void textContact(Context c, EmergencyContact contact, Ride ride) {
        String driver = ride.driver != null ? ride.driver.displayName : "";
        String plate = ride.driver != null ? ride.driver.plateNumber : "";
        String body = ride.driver != null && ride.driver.bodyNumber != null ? ride.driver.bodyNumber : "";
        String pickup = ride.pickup != null ? ride.pickup.address : "";
        String dest = ride.destination != null ? ride.destination.address : "";
        sms(c, contact.phone, c.getString(R.string.emergency_sms_body, driver, plate, body, pickup, dest));
    }

    private static void report(Context c, Ride ride) {
        SupportRepository.get().create(ride.rideId, "SAFETY", c.getString(R.string.emergency_report_description))
                .addOnCompleteListener(t -> Toast.makeText(c, t.isSuccessful() ? R.string.emergency_report_sent : R.string.err_generic,
                        Toast.LENGTH_LONG).show());
    }
}
