package ph.grabcycle.app.location;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ServerValue;
import com.google.firebase.database.ValueEventListener;

import java.util.HashMap;
import java.util.Map;

import ph.grabcycle.app.R;
import ph.grabcycle.app.ui.driver.DriverHomeActivity;
import ph.grabcycle.core.location.LocationQuality;
import ph.grabcycle.core.util.GeoHash;

/**
 * Publishes the online driver's location while the backend allows it.
 *
 * - Runs as a visible foreground service of type "location", started from the
 *   foreground when the driver goes online; no background-location permission.
 * - Writes only while connected and only fixes that meet the accuracy policy,
 *   tagging each with the presence session id and a server-corrected capture
 *   time so queued/replayed writes are rejected by database rules.
 * - Registers an onDisconnect removal so a lost connection removes the
 *   driver from matching instead of leaving a stale position behind.
 * - A permission-denied write means the server ended the session (offline,
 *   suspended, eligibility lost): the service stops itself.
 */
public class DriverLocationService extends Service {

    private static final String TAG = "DriverLocationService";
    private static final String ACTION_START = "ph.grabcycle.app.location.START";
    private static final String ACTION_STOP = "ph.grabcycle.app.location.STOP";
    private static final String EXTRA_SESSION = "session";
    private static final String EXTRA_INTERVAL = "interval";
    private static final String EXTRA_MAX_ACCURACY = "maxAccuracy";
    private static final String EXTRA_FRESHNESS = "freshness";
    private static final int NOTIFICATION_ID = 4101;

    private FusedLocationProviderClient fused;
    private DatabaseReference locationRef;
    private DatabaseReference connectedRef;
    private DatabaseReference offsetRef;
    private String sessionId;
    private long intervalMs = 5_000;
    private int maxAccuracyM = 100;
    private int freshnessSec = 30;
    private volatile boolean connected;
    private volatile long serverOffsetMs;
    private long lastPublishedElapsed;
    private long lastPublishedAt;
    private Float lastAccuracy;
    private LocationQuality quality = LocationQuality.NONE;

    public static void start(@NonNull Context context, @NonNull String sessionId, long intervalSec, long maxAccuracyM, long freshnessSec) {
        Intent i = new Intent(context, DriverLocationService.class)
                .setAction(ACTION_START)
                .putExtra(EXTRA_SESSION, sessionId)
                .putExtra(EXTRA_INTERVAL, intervalSec)
                .putExtra(EXTRA_MAX_ACCURACY, maxAccuracyM)
                .putExtra(EXTRA_FRESHNESS, freshnessSec);
        ContextCompat.startForegroundService(context, i);
    }

    public static void stop(@NonNull Context context) {
        context.stopService(new Intent(context, DriverLocationService.class));
    }

    private final LocationCallback callback = new LocationCallback() {
        @Override
        public void onLocationResult(@NonNull LocationResult result) {
            Location loc = result.getLastLocation();
            if (loc != null) handleFix(loc);
        }
    };

    private final ValueEventListener connectedListener = new ValueEventListener() {
        @Override
        public void onDataChange(@NonNull DataSnapshot snapshot) {
            Boolean value = snapshot.getValue(Boolean.class);
            connected = Boolean.TRUE.equals(value);
            if (connected && locationRef != null) {
                // If this device drops off the network, the server deletes the
                // location so the driver stops being matched.
                locationRef.onDisconnect().removeValue();
            }
            publishState(false);
        }

        @Override
        public void onCancelled(@NonNull DatabaseError error) {
            connected = false;
            publishState(false);
        }
    };

    private final ValueEventListener offsetListener = new ValueEventListener() {
        @Override
        public void onDataChange(@NonNull DataSnapshot snapshot) {
            Long offset = snapshot.getValue(Long.class);
            serverOffsetMs = offset != null ? offset : 0;
        }

        @Override
        public void onCancelled(@NonNull DatabaseError error) {
            // Keep the previous offset.
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        fused = LocationServices.getFusedLocationProviderClient(this);
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String uid = FirebaseAuth.getInstance().getUid();
        sessionId = intent.getStringExtra(EXTRA_SESSION);
        if (uid == null || sessionId == null || !LocationPermissions.hasAny(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        intervalMs = Math.max(2_000, intent.getLongExtra(EXTRA_INTERVAL, 5) * 1000);
        maxAccuracyM = (int) intent.getLongExtra(EXTRA_MAX_ACCURACY, 100);
        freshnessSec = (int) intent.getLongExtra(EXTRA_FRESHNESS, 30);

        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } catch (RuntimeException e) {
            // e.g. ForegroundServiceStartNotAllowedException when not started from the foreground.
            Log.w(TAG, "Cannot start location sharing", e);
            stopSelf();
            return START_NOT_STICKY;
        }

        FirebaseDatabase database = FirebaseDatabase.getInstance();
        locationRef = database.getReference("locations").child(uid);
        connectedRef = database.getReference(".info/connected");
        offsetRef = database.getReference(".info/serverTimeOffset");
        connectedRef.addValueEventListener(connectedListener);
        offsetRef.addValueEventListener(offsetListener);
        requestUpdates();
        publishState(false);
        // Not sticky: restarting a location service from the background is not
        // allowed; the app restarts it when the driver returns while online.
        return START_NOT_STICKY;
    }

    @SuppressLint("MissingPermission")
    private void requestUpdates() {
        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
                .setMinUpdateIntervalMillis(Math.max(2_000, intervalMs / 2))
                .setWaitForAccurateLocation(false)
                .build();
        try {
            fused.requestLocationUpdates(request, callback, Looper.getMainLooper());
        } catch (SecurityException e) {
            Log.w(TAG, "Location permission revoked", e);
            stopSelf();
        }
    }

    private void handleFix(@NonNull Location loc) {
        long ageMs = Math.max(0, (SystemClock.elapsedRealtimeNanos() - loc.getElapsedRealtimeNanos()) / 1_000_000L);
        Float accuracy = loc.hasAccuracy() ? loc.getAccuracy() : null;
        quality = LocationQuality.evaluate(accuracy, ageMs, maxAccuracyM, freshnessSec);
        lastAccuracy = accuracy;
        if (!quality.publishable() || !connected || locationRef == null) {
            publishState(false);
            return;
        }
        // Database rules also throttle to one write per 2 s.
        if (SystemClock.elapsedRealtime() - lastPublishedElapsed < 2_000) return;
        lastPublishedElapsed = SystemClock.elapsedRealtime();

        Map<String, Object> value = new HashMap<>();
        value.put("lat", loc.getLatitude());
        value.put("lng", loc.getLongitude());
        value.put("acc", Math.round(accuracy));
        value.put("g", GeoHash.encode(loc.getLatitude(), loc.getLongitude(), 10));
        value.put("ts", ServerValue.TIMESTAMP);
        value.put("cts", System.currentTimeMillis() + serverOffsetMs);
        value.put("sid", sessionId);
        value.put("mock", LocationPermissions.isMock(loc));
        if (loc.hasBearing()) value.put("hdg", (double) loc.getBearing());
        if (loc.hasSpeed()) value.put("spd", Math.min(100.0, (double) loc.getSpeed()));

        locationRef.setValue(value).addOnCompleteListener(task -> {
            if (task.isSuccessful()) {
                lastPublishedAt = System.currentTimeMillis();
                publishState(false);
            } else if (isPermissionDenied(task.getException())) {
                // The backend revoked publishing rights: we are no longer online.
                publishState(true);
                stopSelf();
            } else {
                publishState(false);
            }
        });
    }

    private static boolean isPermissionDenied(@Nullable Exception e) {
        return e != null && e.getMessage() != null && e.getMessage().toLowerCase(java.util.Locale.US).contains("permission");
    }

    private void publishState(boolean revoked) {
        DriverSessionState.post(!revoked, connected, quality, lastPublishedAt, lastAccuracy, revoked);
    }

    @NonNull
    private Notification buildNotification() {
        Intent open = new Intent(this, DriverHomeActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, getString(R.string.channel_location_service_id))
                .setSmallIcon(R.drawable.ic_stat_grabcycle)
                .setContentTitle(getString(R.string.location_service_title))
                .setContentText(getString(R.string.location_service_text))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setContentIntent(pi)
                .build();
    }

    @Override
    public void onDestroy() {
        if (fused != null) fused.removeLocationUpdates(callback);
        if (connectedRef != null) connectedRef.removeEventListener(connectedListener);
        if (offsetRef != null) offsetRef.removeEventListener(offsetListener);
        if (locationRef != null) locationRef.onDisconnect().cancel();
        DriverSessionState.post(false, false, LocationQuality.NONE, lastPublishedAt, lastAccuracy, false);
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
