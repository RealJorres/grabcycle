import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
}

// Firebase configuration is environment-specific and never committed.
// Download google-services.json from the Firebase console into android/app/.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
} else {
    logger.warn(
        "GrabCycle: android/app/google-services.json is missing. The app compiles, " +
            "but Firebase is not configured at runtime. See docs/setup.md."
    )
}

// Local, uncommitted settings (Maps key, emulator switches) from local.properties
// or environment variables in CI.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

fun setting(name: String, default: String = ""): String =
    localProps.getProperty(name)
        ?: System.getenv(name.uppercase().replace('.', '_'))
        ?: providers.gradleProperty(name).orNull
        ?: default

val mapsApiKey = setting("MAPS_API_KEY")

android {
    namespace = "ph.grabcycle.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "ph.grabcycle.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Android-restricted Maps SDK key (restrict by package name + SHA-256 in Google Cloud).
        manifestPlaceholders["MAPS_API_KEY"] = mapsApiKey
        buildConfigField("boolean", "MAPS_KEY_PRESENT", mapsApiKey.isNotBlank().toString())
        buildConfigField("String", "FUNCTIONS_REGION", "\"${setting("grabcycle.functionsRegion", "asia-southeast1")}\"")
        buildConfigField("boolean", "USE_EMULATORS", "false")
        buildConfigField("String", "EMULATOR_HOST", "\"10.0.2.2\"")
    }

    val keystoreProps = Properties().apply {
        val f = rootProject.file("keystore.properties")
        if (f.exists()) f.inputStream().use { load(it) }
    }
    signingConfigs {
        if (keystoreProps.getProperty("storeFile") != null) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            // Point the debug build at the local Emulator Suite with
            // grabcycle.useEmulators=true in local.properties.
            buildConfigField("boolean", "USE_EMULATORS", setting("grabcycle.useEmulators", "false"))
            buildConfigField("String", "EMULATOR_HOST", "\"${setting("grabcycle.emulatorHost", "10.0.2.2")}\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    // Java-only module: opt out of AGP 9 built-in Kotlin compilation.
    enableKotlin = false

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = false
    }
}

dependencies {
    implementation(project(":core"))

    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.core)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.fragment)
    implementation(libs.androidx.constraintlayout)
    implementation(libs.androidx.coordinatorlayout)
    implementation(libs.androidx.recyclerview)
    implementation(libs.androidx.swiperefreshlayout)
    implementation(libs.androidx.lifecycle.viewmodel)
    implementation(libs.androidx.lifecycle.livedata)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.exifinterface)
    implementation(libs.material)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    implementation(libs.firebase.database)
    implementation(libs.firebase.storage)
    implementation(libs.firebase.functions)
    implementation(libs.firebase.messaging)
    implementation(libs.firebase.appcheck.playintegrity)
    debugImplementation(libs.firebase.appcheck.debug)

    implementation(libs.play.services.maps)
    implementation(libs.play.services.location)

    testImplementation(libs.junit4)

    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.rules)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
