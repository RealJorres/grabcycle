package ph.grabcycle.app.location;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.core.location.LocationManagerCompat;

/** Location permission and device-setting checks. */
public final class LocationPermissions {
    private LocationPermissions() {}

    public static final String[] FOREGROUND = {
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
    };

    public static boolean hasFine(@NonNull Context c) {
        return ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    public static boolean hasAny(@NonNull Context c) {
        return hasFine(c) || ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** True when the user granted only approximate location. */
    public static boolean approximateOnly(@NonNull Context c) {
        return hasAny(c) && !hasFine(c);
    }

    public static boolean isLocationEnabled(@NonNull Context c) {
        LocationManager lm = c.getSystemService(LocationManager.class);
        return lm != null && LocationManagerCompat.isLocationEnabled(lm);
    }

    public static boolean needsNotificationPermission(@NonNull Context c) {
        return Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED;
    }

    /** Detects mock (spoofed) fixes on all supported API levels. */
    @SuppressWarnings("deprecation")
    public static boolean isMock(@NonNull android.location.Location location) {
        return Build.VERSION.SDK_INT >= 31 ? location.isMock() : location.isFromMockProvider();
    }
}
