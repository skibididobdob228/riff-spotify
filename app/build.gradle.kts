import java.util.Properties

plugins {
    id("com.android.application")
}

// Release signing key lives outside git: keystore.properties + release.keystore in the project root
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "io.github.skibididobdob228.riffspotify"
    compileSdk = 36
    ndkVersion = "27.3.13750724"

    defaultConfig {
        applicationId = "io.github.skibididobdob228.riffspotify"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "42.3.0-spotify.2"
        externalNativeBuild {
            cmake {
                arguments += listOf("-DANDROID_STL=c++_shared")
                // nodejs-mobile's libnode.so is bundled for these two
                abiFilters += listOf("arm64-v8a", "x86_64")
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.31.6"
        }
    }

    sourceSets {
        getByName("main") {
            jniLibs.srcDir("libnode/bin")
        }
    }

    packaging {
        // youtubedl-android runs libpython.so/libffmpeg.so as programs, so native libs must be extracted to disk
        jniLibs {
            useLegacyPackaging = true
            // youtubedl-android's *.zip.so are archives, not ELF files; nothing to strip
            keepDebugSymbols += "**/*.zip.so"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    signingConfigs {
        if (keystoreProps.containsKey("storeFile")) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    // One APK per CPU: arm64 for phones, x86_64 for emulators and Chromebooks
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "x86_64")
            isUniversalApk = false
        }
    }
}

dependencies {
    implementation("io.github.junkfood02.youtubedl-android:library:0.18.1")
    implementation("io.github.junkfood02.youtubedl-android:ffmpeg:0.18.1")
    implementation("androidx.webkit:webkit:1.15.0")
    implementation("androidx.media:media:1.7.1")
    implementation("androidx.core:core:1.17.0")
}
