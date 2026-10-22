package ph.grabcycle.app;

import com.google.firebase.appcheck.FirebaseAppCheck;
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory;

/**
 * Release builds attest with Play Integrity. App Check complements, but never
 * replaces, authentication and server-side authorization.
 */
final class AppCheckInstaller {
    private AppCheckInstaller() {}

    static void install(FirebaseAppCheck appCheck) {
        appCheck.installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance());
    }
}
