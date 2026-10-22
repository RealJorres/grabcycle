package ph.grabcycle.app.notifications;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;

import ph.grabcycle.app.R;

/** Notification channels. Users can tune each channel in system settings. */
public final class NotificationHelper {
    private NotificationHelper() {}

    public static void createChannels(Context context) {
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;

        NotificationChannel offers = new NotificationChannel(
                context.getString(R.string.channel_ride_offers_id),
                context.getString(R.string.channel_ride_offers_name),
                NotificationManager.IMPORTANCE_HIGH);
        offers.setDescription(context.getString(R.string.channel_ride_offers_desc));
        offers.enableVibration(true);

        NotificationChannel updates = new NotificationChannel(
                context.getString(R.string.channel_ride_updates_id),
                context.getString(R.string.channel_ride_updates_name),
                NotificationManager.IMPORTANCE_HIGH);
        updates.setDescription(context.getString(R.string.channel_ride_updates_desc));

        NotificationChannel account = new NotificationChannel(
                context.getString(R.string.channel_account_id),
                context.getString(R.string.channel_account_name),
                NotificationManager.IMPORTANCE_DEFAULT);
        account.setDescription(context.getString(R.string.channel_account_desc));

        NotificationChannel location = new NotificationChannel(
                context.getString(R.string.channel_location_service_id),
                context.getString(R.string.channel_location_service_name),
                NotificationManager.IMPORTANCE_LOW);
        location.setDescription(context.getString(R.string.channel_location_service_desc));
        location.setShowBadge(false);

        nm.createNotificationChannel(offers);
        nm.createNotificationChannel(updates);
        nm.createNotificationChannel(account);
        nm.createNotificationChannel(location);
    }
}
