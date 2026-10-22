package ph.grabcycle.app;

import android.app.Application;
import android.util.Log;

import com.google.firebase.FirebaseApp;
import com.google.firebase.appcheck.FirebaseAppCheck;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.functions.FirebaseFunctions;
import com.google.firebase.storage.FirebaseStorage;

import ph.grabcycle.app.config.AppConfig;
import ph.grabcycle.app.notifications.NotificationHelper;

/**
 * Application entry point: verifies Firebase configuration, installs App
 * Check, optionally routes every SDK to the local Emulator Suite (debug
 * builds only) and registers notification channels.
 */
public class GrabCycleApp extends Application {

    private static final String TAG = "GrabCycleApp";

    private static boolean firebaseReady;

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationHelper.createChannels(this);

        // FirebaseInitProvider initializes the default app from google-services.json.
        // When the file was missing at build time there is no default app; the
        // launcher then shows a configuration error instead of crashing.
        if (FirebaseApp.getApps(this).isEmpty()) {
            Log.e(TAG, "Firebase is not configured (google-services.json missing at build time).");
            firebaseReady = false;
            return;
        }
        firebaseReady = true;

        AppCheckInstaller.install(FirebaseAppCheck.getInstance());

        if (AppConfig.useEmulators()) {
            String host = AppConfig.emulatorHost();
            Log.w(TAG, "DEBUG: using Firebase Emulator Suite at " + host);
            FirebaseAuth.getInstance().useEmulator(host, 9099);
            FirebaseFirestore.getInstance().useEmulator(host, 8080);
            FirebaseDatabase.getInstance().useEmulator(host, 9000);
            FirebaseStorage.getInstance().useEmulator(host, 9199);
            FirebaseFunctions.getInstance(AppConfig.functionsRegion()).useEmulator(host, 5001);
        }
    }

    public static boolean isFirebaseReady() {
        return firebaseReady;
    }
}
