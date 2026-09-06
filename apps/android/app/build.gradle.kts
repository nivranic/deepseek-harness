import java.util.Properties

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
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
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
}

val bundletool by configurations.creating

tasks.register<JavaExec>("validateReleaseBundle") {
    group = "verification"
    description = "Validates the unsigned release AAB with the pinned bundletool."
    dependsOn("bundleRelease")
    classpath = bundletool
    mainClass.set("com.android.tools.build.bundletool.BundleToolMain")
    args("validate", "--bundle=${layout.buildDirectory.file("outputs/bundle/release/app-release.aab").get().asFile}")
}

dependencies {
    bundletool("com.android.tools.build:bundletool:1.18.0")
    implementation(project(":core"))
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
