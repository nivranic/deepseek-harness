# Agent Note: Reproducible Android release build inputs

Status: implemented

English | [中文](2026-09-06-android-release-foundation.zh.md)

## Problem

An externally provisioned Gradle version and a debug APK do not establish how an optimized release bundle builds. JVM tests also cannot detect Android SDK compatibility failures or missing classes after shrinking.

## Decision

The [Android project](../../../../apps/android/README.md) commits the Gradle 8.14 wrapper and the official distribution SHA-256. Both Android CI and Kotlin security analysis invoke that wrapper with JDK 17 and install the exact compile SDK. API 36 is the compile and target level; minimum API 33 remains supported. The [compiler and security-analysis decision](2026-09-06-android-codeql-inputs.md) continues to own the Kotlin/AGP pairing and extraction requirements.

Release builds use R8, Android's optimized default rules, and resource shrinking. The pinned bundletool validates the resulting AAB. The workflow rejects JAR signature entries and requires a nonempty R8 mapping before preserving both files with SHA-256 checksums. Upload follows successful validation and uses no signing credentials.

## Alternatives considered

- A runner-installed Gradle version leaves local builds dependent on an unrecorded executable.
- Debug assembly omits the shrinking and bundle paths exercised by release builds.
- A successful unsigned bundle cannot stand in for an installed release application or a signed distribution.

## Consequences

The wrapper verifies its downloaded distribution and CI checks its JAR through the Gradle setup action. Build inputs are pinned without claiming byte-for-byte reproducible outputs. Debug instrumentation, release device startup, production signing, package SBOM, and candidate provenance remain separate evidence requirements. R8 mapping is retained alongside its exact AAB; neither is promoted automatically.

The existing candidate-integrity decision remains active: [platform verification](2026-09-06-candidate-artifact-integrity.md) still requires a complete source-bound receipt. These Android build artifacts alone do not satisfy that receipt.
