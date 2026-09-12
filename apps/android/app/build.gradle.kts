import java.util.Properties
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipFile
import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    kotlin("android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val productVersion = Properties().apply {
    rootProject.file("product-version.properties").inputStream().use { load(it) }
}
val productVersionName = requireNotNull(productVersion.getProperty("versionName")) {
    "product-version.properties must declare versionName; run pnpm run gen-product-identity"
}
val productVersionCode = requireNotNull(productVersion.getProperty("versionCode")?.toIntOrNull()) {
    "product-version.properties must declare an integer versionCode"
}
val productChannel = requireNotNull(productVersion.getProperty("channel")) {
    "product-version.properties must declare channel"
}
require(productVersionName.isNotBlank()) { "versionName must not be blank" }
require(productVersionCode in 1..65535) { "versionCode must be from 1 to 65535" }
require(productChannel in setOf("dev", "canary", "beta", "stable")) { "unknown product channel" }

val scannerDirectory = providers.environmentVariable("DSH_ANDROID_SCANNER_DIRECTORY").map { File(it) }
val scannerSource = providers.environmentVariable("DSH_ANDROID_SCANNER_SOURCE").map {
    require(Regex("[a-f0-9]{40}").matches(it)) { "Scanner source must be a full lowercase commit SHA" }
    it
}
val scannerAar = scannerDirectory.map { File(it, "support-scanner.aar") }
val verifyScannerResources = tasks.register("verifyScannerResources") {
    group = "verification"
    doLast {
        val source = scannerSource.get()
        val directory = scannerDirectory.get()
        require(Regex("[a-f0-9]{40}").matches(source) && directory.isAbsolute) { "Require an absolute scanner directory and full source SHA" }
        val receiptFile = File(directory, "scanner.json")
        require(receiptFile.isFile && receiptFile.length() in 1..4 * 1024 * 1024) { "Scanner receipt is missing or oversized" }
        val receipt = JsonSlurper().parse(receiptFile) as Map<*, *>
        val aar = scannerAar.get()
        require(aar.isFile && aar.length() == (receipt["bytes"] as Number).toLong()) { "Scanner AAR size differs" }
        val digest = MessageDigest.getInstance("SHA-256")
        aar.inputStream().use { input ->
            val buffer = ByteArray(65536)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        require(digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) } == receipt["sha256"]) { "Scanner AAR checksum differs" }
        require(receipt["sourceSha"] == source && receipt["status"] == "BUILT" && receipt["staticVerification"] == "PASS") { "Scanner source or verification differs" }
        ZipFile(aar).use { archive ->
            val entry = requireNotNull(archive.getEntry("assets/dsh-support-scanner/manifest.json")) { "Scanner source manifest is missing" }
            require(entry.size in 1..4 * 1024 * 1024) { "Scanner source manifest is oversized" }
            val manifest = archive.getInputStream(entry).use { JsonSlurper().parse(it) }
            require(manifest == receipt["manifest"] && ((manifest as Map<*, *>)["source"] as Map<*, *>)["sourceSha"] == source) { "Embedded scanner manifest differs" }
        }
    }
}
tasks.matching { it.name == "preBuild" }.configureEach { dependsOn(verifyScannerResources) }

// Passwords stay in the environment and Gradle signing configuration, never in command arguments or diagnostics.
class ReleaseSigningMaterial(val file: File, val storePassword: String, val alias: String, val keyPassword: String)

val releaseSigningMode = providers.environmentVariable("DSH_ANDROID_SIGNING_MODE").getOrElse("unsigned")
val releaseSigningNames = listOf("STORE_FILE", "STORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD")
val releaseSigningValues = releaseSigningNames.associateWith {
    providers.environmentVariable("DSH_ANDROID_SIGNING_$it").orNull
}
require(releaseSigningMode in setOf("unsigned", "keystore")) {
    "DSH_ANDROID_SIGNING_MODE must be unsigned or keystore"
}
val releaseSigning = if (releaseSigningMode == "unsigned") {
    require(releaseSigningValues.values.all { it == null }) {
        "Unsigned Android builds must not receive DSH_ANDROID_SIGNING keystore inputs"
    }
    null
} else {
    fun signingValue(name: String): String = requireNotNull(releaseSigningValues[name]?.takeIf { it.isNotEmpty() }) {
        "Keystore mode requires DSH_ANDROID_SIGNING_$name"
    }
    val store = File(signingValue("STORE_FILE"))
    val storePassword = signingValue("STORE_PASSWORD")
    val alias = signingValue("KEY_ALIAS")
    val keyPassword = signingValue("KEY_PASSWORD")
    require(store.isAbsolute && store.isFile && store.canRead()) {
        "DSH_ANDROID_SIGNING_STORE_FILE must name an absolute readable keystore file"
    }
    ReleaseSigningMaterial(store, storePassword, alias, keyPassword)
}

android {
    namespace = "ai.deepseek.dsh.companion"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.deepseek.harness.companion"
        minSdk = 33
        targetSdk = 36
        versionCode = productVersionCode
        versionName = productVersionName
        manifestPlaceholders["dshProductChannel"] = productChannel
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["dshScannerSource"] = scannerSource.orNull.orEmpty()
        ndk { abiFilters += setOf("arm64-v8a", "x86_64") }
    }

    val releaseKeystore = releaseSigning?.let { material ->
        signingConfigs.create("releaseKeystore") {
            storeFile = material.file
            storePassword = material.storePassword
            keyAlias = material.alias
            keyPassword = material.keyPassword
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            signingConfig = releaseKeystore
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }
    packaging { jniLibs.keepDebugSymbols += "**/libgojni.so" }
}

val bundletool by configurations.creating

tasks.register<JavaExec>("validateReleaseBundle") {
    group = "verification"
    description = "Validates the release AAB with the pinned bundletool."
    dependsOn("bundleRelease")
    classpath = bundletool
    mainClass.set("com.android.tools.build.bundletool.BundleToolMain")
    args("validate", "--bundle=${layout.buildDirectory.file("outputs/bundle/release/app-release.aab").get().asFile}")
}

dependencies {
    bundletool("com.android.tools.build:bundletool:1.18.0")
    implementation(project(":core"))
    implementation(files(scannerAar))
    val composeBom = platform("androidx.compose:compose-bom:2025.01.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
}
