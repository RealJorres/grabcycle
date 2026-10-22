package ph.grabcycle.app.location;

import android.annotation.SuppressLint;
import android.content.Context;
import android.location.Location;

import androidx.annotation.NonNull;

import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;

import ph.grabcycle.app.data.AppException;
import ph.grabcycle.core.model.ErrorReason;

/**
 * Obtains a CURRENT location fix. The map camera position or a cached last
 * location is never treated as the user's location.
 */
public final class LocationHelper {
    private final FusedLocationProviderClient client;
    private CancellationTokenSource cancellation;

    public LocationHelper(@NonNull Context context) {
        client = LocationServices.getFusedLocationProviderClient(context.getApplicationContext());
    }

    /** Fresh high-accuracy fix, failing after ~20 s without one. Caller must hold a location permission. */
    @SuppressLint("MissingPermission")
    @NonNull
    public Task<Location> currentLocation(@NonNull Context context) {
        if (!LocationPermissions.hasAny(context)) {
            return Tasks.forException(new AppException(ErrorReason.LOCATION_REQUIRED, "Location permission not granted", null, null));
        }
        if (!LocationPermissions.isLocationEnabled(context)) {
            return Tasks.forException(new AppException(ErrorReason.LOCATION_REQUIRED, "Location services are off", null, null));
        }
        cancel();
        cancellation = new CancellationTokenSource();
        CurrentLocationRequest request = new CurrentLocationRequest.Builder()
                .setPriority(LocationPermissions.hasFine(context) ? Priority.PRIORITY_HIGH_ACCURACY : Priority.PRIORITY_BALANCED_POWER_ACCURACY)
                .setMaxUpdateAgeMillis(10_000)
                .setDurationMillis(20_000)
                .build();
        return client.getCurrentLocation(request, cancellation.getToken()).continueWithTask(t -> {
            if (!t.isSuccessful()) return Tasks.forException(new AppException(ErrorReason.LOCATION_REQUIRED, "Location unavailable", null, t.getException()));
            if (t.getResult() == null) return Tasks.forException(new AppException(ErrorReason.LOCATION_REQUIRED, "No location fix", null, null));
            return Tasks.forResult(t.getResult());
        });
    }

    public void cancel() {
        if (cancellation != null) {
            cancellation.cancel();
            cancellation = null;
        }
    }
}
