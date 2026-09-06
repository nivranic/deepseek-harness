# Agent Note: Reproducible Android release build inputs

Status: implemented

English | [中文](2026-09-06-android-release-foundation.zh.md)

## Problem

An externally provisioned Gradle version and a debug APK do not establish how an optimized release bundle builds. JVM tests also cannot detect Android SDK compatibility failures or missing classes after shrinking.

## Decision

The [Android project](../../../../apps/android/README.md) commits the Gradle 8.14 wrapper and the official distribution SHA-256. Both Android CI and Kotlin security analysis invoke that wrapper with JDK 17 and install the exact compile SDK. API 36 is the compile and target level; minimum API 33 remains supported. The [compiler and security-analysis decision](2026-09-06-android-codeql-inputs.md) continues to own the Kotlin/AGP pairing and extraction requirements.

Release builds use R8, Android's optimized default rules, and resource shrinking. The pinned bundletool validates the resulting AAB. The workflow rejects JAR signature entries and requires a nonempty R8 mapping before preserving both files with SHA-256 checksums. Upload follows successful validation and uses no signing credentials.

Release signing defaults to `unsigned`. The `keystore` mode accepts a complete environment-supplied file, store password, alias, and key password. Configuration rejects unknown modes, incomplete input, non-absolute or unreadable files, and signing fields supplied to unsigned builds. The build script does not print credential values or put them in process arguments. Gradle owns actual key validation and signing; a signed artifact still needs its own certificate and installation evidence.

The [AAB inventory scanner](../../../../scripts/release/android_sbom.py) invokes the project's AGP protobuf reader on the actual bundle. Embedded artifact digests select exact Maven inputs; POM inheritance supplies declared licenses. Every packaged file receives a digest, native libraries require an exact AAR owner, and verified R8 mapping and DEX markers bind classes to Maven/project inputs or class-level synthesis records. Verbatim Java class resources also require their Maven bytes. Reverification repeats input collection and compares the full CycloneDX document and inventory receipt. Compiler/scanner identities and evidence remain portable; output directories are new-only.

## Alternatives considered

- A runner-installed Gradle version leaves local builds dependent on an unrecorded executable.
- Debug assembly omits the shrinking and bundle paths exercised by release builds.
- A successful unsigned bundle cannot stand in for an installed release application or a signed distribution.
- Falling back to unsigned output after partial signing configuration would conceal a failed signing request.
- A Gradle resolution report alone does not establish packaged file bytes, transformed class ownership, or the retained R8 mapping. Counting nonempty SBOM components cannot prove inventory completeness.

## Consequences

The wrapper verifies its downloaded distribution and CI checks its JAR through the Gradle setup action. Build inputs are pinned without claiming byte-for-byte reproducible outputs. Debug instrumentation, release device startup, production signing, package SBOM, and candidate provenance remain separate evidence requirements. R8 mapping is retained alongside its exact AAB; neither is promoted automatically.

The existing candidate-integrity decision remains active: [platform verification](2026-09-06-candidate-artifact-integrity.md) still requires a complete source-bound receipt. These Android build artifacts alone do not satisfy that receipt.

Scanner tests exercise malformed embedded metadata, graph and license failures, changed native/class resources, mapping integrity, and omitted evidence. The actual-release suite generates and reverifies the bundle inventory through AGP, R8, dexdump and the complete CycloneDX 1.6 schema. Base-only support and file-level hashing of transformed resources remain explicit limits; the scanner does not infer legal clearance or resource input ownership from a filename.
