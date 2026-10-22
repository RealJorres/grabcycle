package ph.grabcycle.app.config;

import ph.grabcycle.app.BuildConfig;

/** Build-time configuration (see android/app/build.gradle.kts and docs/setup.md). */
public final class AppConfig {
    private AppConfig() {}

    public static String functionsRegion() {
        return BuildConfig.FUNCTIONS_REGION;
    }

    /** Emulator routing is only ever possible in debug builds. */
    public static boolean useEmulators() {
        return BuildConfig.DEBUG && BuildConfig.USE_EMULATORS;
    }

    public static String emulatorHost() {
        return BuildConfig.EMULATOR_HOST;
    }

    public static boolean isMapsKeyPresent() {
        return BuildConfig.MAPS_KEY_PRESENT;
    }

    /** Must match the backend policy versions (config/policies.terms). */
    public static final String TERMS_VERSION = "2026-10";
    public static final String PRIVACY_NOTICE_VERSION = "2026-10";

    public static final String EMERGENCY_HOTLINE = "911";
}
