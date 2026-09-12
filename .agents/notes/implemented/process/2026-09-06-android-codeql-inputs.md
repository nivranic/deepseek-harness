# Agent Note: Align Android compiler inputs and preserve explicit notification targets

Status: implemented

English | [中文](2026-09-06-android-codeql-inputs.zh.md)

## Problem

CodeQL 2.26.4 cannot extract the notification's `MainActivity::class.java` intrinsic with the resolved Kotlin standard library. A Kotlin compiler older than that library also leaves extraction errors in shared transport code. Successful Gradle compilation alone does not prove complete security analysis.

## Decision

The [Android build](../../../../apps/android/build.gradle.kts) aligns the JVM, Android, and Compose Kotlin plugins with Kotlin standard library 2.2.21 and uses AGP 8.10.1. This pairing follows [Android's Kotlin support table](https://developer.android.com/build/kotlin-support); [AGP 8.10](https://developer.android.com/build/releases/past-releases/agp-8-10-0-release-notes) requires JDK 17 and Gradle 8.11.1 or newer, so the existing Gradle 8.14 runner remains supported.

[PushNotifications](../../../../apps/android/app/src/main/kotlin/ai/deepseek/dsh/companion/PushNotifications.kt) uses the public `javaObjectType` mapping. `MainActivity` is a reference class, so this returns the same Activity class as `java`. The `Intent(Context, Class)` constructor still selects the explicit component, and the PendingIntent retains `FLAG_IMMUTABLE` and `FLAG_UPDATE_CURRENT`.

The [notification instrumentation](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/PushNotificationTargetTest.kt) inspects a posted Android notification and looks up its existing immutable PendingIntent using the original `MainActivity::class.java` mapping. A different component must have no matching token. The test cleans up its notifications without tapping them.

## Alternatives considered

- Compiler alignment alone leaves the notification intrinsic extraction error.
- A hardcoded component class name discards a compiler-checked reference.
- Suppressing findings or ignoring extraction diagnostics cannot establish complete analysis.

## Consequences

The main Android source selection and security-extended query suite remain intact. Extractor diagnostics must be checked separately from compiler success; other security findings still require their own fixes or reviewed evidence under the [candidate scanner policy](2026-09-05-candidate-security-scans.md). This decision grants no exception for the Noise cryptography findings.
