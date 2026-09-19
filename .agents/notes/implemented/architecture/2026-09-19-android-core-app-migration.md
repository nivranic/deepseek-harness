# Agent Note: Android core and app modules migrate onto the contract build

Status: implemented

English | [中文](2026-09-19-android-core-app-migration.zh.md)

## Problem

The Upstream-First Android track had only the `contract` module on the new `apps/android` Gradle build (the Kotlin failure-classification column). The historical companion implementation — 23 `core` domain files, 23 `core` test classes, 10 `app` shell files — still lived in the old `android-application-source` worktree, so Phase 10's "thin shell onto the new contract" had no migrated surface to build on.

## Current upstream boundary

The historical worktree builds its own `dsh-android-companion` root with `:core` and `:app` and never consumes the shared Remote failure vocabulary; the new tree had the vocabulary but no shell. Neither tree alone can produce a device build that classifies Gateway failures through the contract.

## Decision

Migrate the `core` and `app` modules verbatim onto `apps/android` rather than rewriting: the domain code (Lite fold, Link/Noise stack, handoff, support export, diagnostics) is behavior-complete with its test corpus, and the Upstream-First plan's platform stance is a thin device shell over the shared contract, not a reimplementation. `settings.gradle.kts` includes `:contract`, `:core`, `:app` with `google()` added to both repository blocks; the root `build.gradle.kts` declares the Android plugins `apply false` (Kotlin 2.2.21, AGP 8.10.1, Compose plugin) matching the historical tree. `product-version.properties` migrates unchanged; the app module still reads it for version identity.

## Alternatives considered

Rewriting the domain fold against the new contract immediately was rejected: it couples two risks (migration correctness and redesign) and orphans 23 passing test classes. Waiting for the scanner chain before migrating anything was rejected: `:core` is pure JVM and independently verifiable now.

## Contract

`gradlew :contract:test :core:test` from `apps/android` runs the contract schema tests and the migrated domain tests on the JVM (no Android SDK). `:app` configures with the Android SDK (`ANDROID_HOME`); `:app:assembleDebug` is gated by `verifyScannerResources`, which requires the support-scanner AAR (built from `native/support-scanner` via Go + NDK) plus its receipt through `DSH_ANDROID_SCANNER_DIRECTORY`/`DSH_ANDROID_SCANNER_SOURCE`. The gate is the historical supply-chain control, carried over unmodified.

## Persistence

No session or storage changes. `core` owns no durable device state on this build; its stores and export code run in JVM tests only.

## Security

The scanner gate, signing-mode rules (`DSH_ANDROID_SIGNING_*`), and the application-source/tree SHA placeholders migrate unchanged from the historical module. No keystore material, credentials, or telemetry paths were added.

## Compatibility

Kotlin 2.2.21 and Gradle 8.14 match the historical build; the contract module's Kotlin/JVM toolchain (17) is unchanged. The migrated modules do not yet consume `:contract` — the classification seam lands with the Gateway wiring increment.

## Failure handling

`:core:test` failures are ordinary domain regressions. `:app:assembleDebug` without the scanner environment fails at `verifyScannerResources` with "Cannot query the value of this provider because it has no value available" — that is the intended loud failure, not a migration defect.

## Testing

Local (Windows host, Android SDK at `E:/Android_Studio_SDK`): `gradlew.bat :core:test` — BUILD SUCCESSFUL, 37 test classes; `gradlew.bat :app:tasks --all` — configuration resolves AGP 8.10.1 and the Compose plugin; `gradlew.bat :app:assembleDebug` — fails exactly at the scanner gate, recorded in `.artifacts/android-app-assemble.log`.

## Rollout

Source-tree only; no published artifact. The emulator/device lane and the scanner AAR build land in later increments.

## Rollback

Remove `include(":core")`/`include(":app")` and the Android plugin declarations; delete `apps/android/core`, `apps/android/app`, `apps/android/gradle.properties`, and `apps/android/product-version.properties`.

## Consequences

The Android track now has its full module topology on the new build, with the scanner AAR chain as the single gate between "sources migrated" and "shell compiles + installs". The classification mirror stays contract-module-only until the shell's Gateway wiring consumes it.
