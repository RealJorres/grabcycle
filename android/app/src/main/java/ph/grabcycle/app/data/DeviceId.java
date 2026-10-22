package ph.grabcycle.app.data;

import android.content.Context;
import android.content.SharedPreferences;

import ph.grabcycle.core.util.Ids;

/** Random per-installation id used to key push-notification registrations (not personal data). */
public final class DeviceId {
    private DeviceId() {}

    public static synchronized String get(Context context) {
        SharedPreferences prefs = context.getApplicationContext().getSharedPreferences("grabcycle_device", Context.MODE_PRIVATE);
        String id = prefs.getString("installation_id", null);
        if (id == null) {
            id = Ids.newUploadId();
            prefs.edit().putString("installation_id", id).apply();
        }
        return id;
    }
}
