package ph.grabcycle.app.ui.common;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

import androidx.annotation.NonNull;
import androidx.lifecycle.LiveData;

/** Emits whether the device currently has validated internet connectivity. */
public final class ConnectivityMonitor extends LiveData<Boolean> {
    private static ConnectivityMonitor instance;
    private final ConnectivityManager cm;

    private final ConnectivityManager.NetworkCallback callback = new ConnectivityManager.NetworkCallback() {
        @Override
        public void onCapabilitiesChanged(@NonNull Network network, @NonNull NetworkCapabilities caps) {
            postValue(caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
        }

        @Override
        public void onLost(@NonNull Network network) {
            postValue(false);
        }
    };

    private ConnectivityMonitor(Context context) {
        cm = context.getSystemService(ConnectivityManager.class);
        setValue(isOnlineNow());
    }

    public static synchronized ConnectivityMonitor get(@NonNull Context context) {
        if (instance == null) instance = new ConnectivityMonitor(context.getApplicationContext());
        return instance;
    }

    public boolean isOnlineNow() {
        if (cm == null) return true;
        NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    @Override
    protected void onActive() {
        if (cm != null) cm.registerDefaultNetworkCallback(callback);
        setValue(isOnlineNow());
    }

    @Override
    protected void onInactive() {
        if (cm != null) {
            try {
                cm.unregisterNetworkCallback(callback);
            } catch (IllegalArgumentException ignored) {
                // Already unregistered.
            }
        }
    }
}
