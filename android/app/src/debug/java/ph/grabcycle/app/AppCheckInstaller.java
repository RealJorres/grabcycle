package ph.grabcycle.app;

import com.google.firebase.appcheck.FirebaseAppCheck;
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory;

/**
 * Debug builds use the App Check debug provider. Register the debug token
 * printed in Logcat in the Firebase console (App Check → Manage debug tokens).
 * This class only exists in the debug source set.
 */
final class AppCheckInstaller {
    private AppCheckInstaller() {}

    static void install(FirebaseAppCheck appCheck) {
        appCheck.installAppCheckProviderFactory(DebugAppCheckProviderFactory.getInstance());
    }
}
