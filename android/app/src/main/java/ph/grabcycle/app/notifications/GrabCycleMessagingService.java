package ph.grabcycle.app.notifications;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

import ph.grabcycle.app.R;
import ph.grabcycle.app.data.UserRepository;
import ph.grabcycle.app.ui.launch.LauncherActivity;
import ph.grabcycle.core.notify.EventDeduper;

/**
 * Receives push alerts. Messages are data-only and contain no addresses or
 * personal details. Duplicates (by event id) and stale ride offers are
 * dropped; tapping a notification opens the app, which re-reads the
 * authoritative ride/account state rather than trusting the payload.
 */
public class GrabCycleMessagingService extends FirebaseMessagingService {

    private static final EventDeduper DEDUPER = new EventDeduper(200);
    /** Ride offers older than this are not shown (the acceptance window has passed). */
    private static final long OFFER_MAX_AGE_MS = 25_000;

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String type = data.get("type");
        if (type == null) return;
        long now = System.currentTimeMillis();
        if (!DEDUPER.firstTime(data.get("eventId"), now)) return;
        long sentAt = parseLong(data.get("sentAt"));
        if ("RIDE_OFFER".equals(type) && EventDeduper.isStale(sentAt, now, OFFER_MAX_AGE_MS)) return;

        String rideId = data.get("rideId");
        PushEvents.post(type, rideId);
        show(type, data.get("title"), data.get("body"), rideId);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        if (FirebaseAuth.getInstance().getCurrentUser() != null) {
            // Best effort: registration is retried on next app start / sign-in.
            UserRepository.get().registerToken(getApplicationContext(), token);
        }
    }

    private void show(@NonNull String type, String title, String body, String rideId) {
        if (title == null || body == null) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && android.os.Build.VERSION.SDK_INT >= 33) {
            return;
        }
        String channel;
        int priority;
        switch (type) {
            case "RIDE_OFFER":
                channel = getString(R.string.channel_ride_offers_id);
                priority = NotificationCompat.PRIORITY_MAX;
                break;
            case "VERIFICATION_UPDATE":
            case "ACCREDITATION_UPDATE":
            case "DOCUMENT_EXPIRY":
            case "ACCOUNT_UPDATE":
            case "SUPPORT_UPDATE":
                channel = getString(R.string.channel_account_id);
                priority = NotificationCompat.PRIORITY_DEFAULT;
                break;
            default:
                channel = getString(R.string.channel_ride_updates_id);
                priority = NotificationCompat.PRIORITY_HIGH;
        }
        Intent open = new Intent(this, LauncherActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(LauncherActivity.EXTRA_FROM_PUSH, type);
        PendingIntent pi = PendingIntent.getActivity(this, type.hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, channel)
                .setSmallIcon(R.drawable.ic_stat_grabcycle)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(priority)
                .setAutoCancel(true)
                .setContentIntent(pi);
        if ("RIDE_OFFER".equals(type)) {
            b.setCategory(NotificationCompat.CATEGORY_CALL).setTimeoutAfter(OFFER_MAX_AGE_MS);
        }
        // One notification per ride (later updates replace earlier ones).
        int id = rideId != null ? rideId.hashCode() : type.hashCode();
        try {
            NotificationManagerCompat.from(this).notify(id, b.build());
        } catch (SecurityException ignored) {
            // Notification permission revoked between check and post.
        }
    }

    private static long parseLong(String v) {
        try {
            return v != null ? Long.parseLong(v) : 0;
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
