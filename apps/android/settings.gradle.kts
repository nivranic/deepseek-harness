// The Android companion (nativization plan chapters 52 and 60): `core` is
// the pure-JVM domain module — the generated contract models, the Kotlin
// half of the domain-state conformance fold, and the Minimal Neumorphic
// token baseline. App modules arrive with the Compose surface.
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}

rootProject.name = "dsh-android-companion"

include(":core")
