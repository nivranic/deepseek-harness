---
description: "Admit immutable local support documents with the pinned Gitleaks rules and joined cancellation."
kind: "package-library"
---

# Support scanner

English | [中文](README.zh.md)

## Summary

Callers can scan one bounded diagnostic document entirely in memory and retrieve only the exact approved bytes. Each operation checks a real canary before scanning the document with the pinned Gitleaks default rules. Cancellation waits for scanner completion and refuses partial results. The [Android companion](../../apps/android/README.md#local-support-export) consumes the JNI library; the [Apple Companion](../../apps/apple/README.md) links the static framework through its native shell.

## Table of Contents

- [Use the library](#use-the-library)
- [Understand the implementation](#understand-the-implementation)
- [Verification](#verification)
- [Build Android resources](#build-android-resources)
- [Build Apple resources](#build-apple-resources)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-the-library"></a>
## Use the library

[NewOperation](scanner.go) copies its input and validates the caller's byte and time limits. Run the operation away from the UI thread; only an `approved` result provides document bytes and their digest. Treat every refusal as unavailable output. `Cancel` joins a running operation, while the native exporter owns cancellation after scan completion and before delivery.

The producer must serialize all document fields before admission and deliver `Result.Data()` unchanged. The scanner does not validate diagnostic field ownership or establish application health. [The Support Bundle plan](../../docs/plans/2026-09-08-support-bundle.md) defines those producer and platform requirements.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The library compiles embedded upstream rules through a private configuration parser and disables the scanner logger in its isolated Go runtime. Source-review exceptions and inline allow comments cannot exempt document findings. The canary and final document use separate detectors; the operation checks cancellation after detection because the upstream API can return partial findings without an error. [The export decision](../../.agents/notes/implemented/architecture/2026-09-08-local-runtime-support-export.md) owns the privacy and lifetime rationale.

</details>

<a id="verification"></a>
## Verification

With Go 1.27.1 and a supported C compiler, run these commands from this directory:

```sh
go mod verify
go test -race -count=1 -timeout=60s -v ./...
go vet ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 ./...
```

The [CI workflow](../../.github/workflows/ci.yml) requires scanner race tests, Go CodeQL analysis and reachable-dependency vulnerability checks. Unresolved CodeQL findings and incomplete extraction refuse acceptance through the shared [security evidence validator](../../scripts/release/security_evidence.py). Govulncheck rejects vulnerable calls reachable from this library; module-only notices do not establish a call path. The module requires Go 1.26 or later for its security-fixed dependencies.

<a id="build-android-resources"></a>
## Build Android resources

The [Python build entrypoint](../../scripts/build-mobile-support-scanner.py) produces an AAR and `scanner.json` using the tool versions in [build.json](build.json). Run it with Python 3.10 or later from the repository root. The source commit must contain the exact running builder files; edited or uncommitted builders cannot produce resources for an older commit.

| Argument | Required input |
|---|---|
| `--source-sha` | Full lowercase Git commit SHA |
| `--go` | Absolute path to the pinned Go executable |
| `--android-sdk`, `--android-ndk`, `--java-home` | Installed SDK, pinned NDK and Java 17 directories |
| `--cache` | Private Go module and compilation cache directory |
| `--work-dir`, `--output` | New, separate work and artifact directories; the artifact directory cannot contain the cache |

The build reads committed scanner files into a versioned local module proxy and checks downloaded source bytes against Git. External modules retain Go checksum-database verification. Both JNI libraries retain module versions and checksums, omit inferred build-directory VCS identity, and pass ELF architecture and 16 KiB alignment checks. R8 keep rules preserve the generated Java entrypoints. The AAR contains the source/module manifest, module licenses, Go license and NDK notices under `assets/dsh-support-scanner/`; archive ordering and timestamps are canonicalized.

The [mobile scanner workflow](../../.github/workflows/mobile-support-scanner.yml) builds these resources on Linux and runs govulncheck on both native libraries before uploading them. Libraries retain native symbol tables for package and symbol analysis; consumers must preserve those bytes when assembling applications. Its `BUILT` receipt establishes static packaging checks. Native execution, application integration and acceptance on devices with 16 KiB pages remain separate requirements.

<a id="build-apple-resources"></a>
## Build Apple resources

The [Apple build entrypoint](../../scripts/build-apple-support-scanner.py) uses the same Go/gomobile versions and source checks with the Xcode/deployment identities in [apple-build.json](apple-build.json). It requires macOS and explicit `--source-sha`, `--go`, `--developer-dir`, `--cache`, `--work-dir` and `--output` inputs. Work and output directories must be new and separate; the cache must be outside the artifact directory. Compiler output, framework layout and validation exceptions stay in private work logs; public failures contain no diagnostic details.

The output ZIP contains `SupportScanner.xcframework`, a source/module manifest and licenses. For device iOS arm64, simulator arm64/x86_64 and macOS arm64/x86_64, the producer removes any universal container and force-loads the exact archive slice into a minimal inspection executable. Go's executable reader checks each linked module graph; the manifest retains archive, Go object and inspection-binary digests. Each index entry must declare the exact platform binary path; only the generated Mac framework version links are admitted. Static framework plist versions are canonical package metadata; the manifest owns immutable source identity. Apple SDKs are build inputs, not redistributed contents.

The [native verifier](../../scripts/verify-apple-support-scanner.py) compares archived bytes with the framework used for compilation, runs Swift binding probes on macOS and an owned iOS simulator, and records linked-binary digests. The workflow checks vulnerabilities in those linked binaries before publishing the library. A `BUILT` library does not establish native execution or application export; the [Apple integration plan](../../docs/plans/2026-09-10-apple-support-scanner.md) owns the acceptance sequence.

The [application stager](../../scripts/stage-apple-support-scanner.py) accepts `--source-sha`, the build `--directory`, compiler `--framework`, native `--verification` and a new `--output` directory. It rechecks source and builder records against Git, archive and framework bytes, and matching native rules identities before copying. The output preserves framework links and includes `SupportScannerResources/` with identity, provenance and all module/Go licenses. Its `STAGED` receipt does not establish application linking or execution; the scanner workflow exercises staging before publishing resources.

## Model Experience

None. The library admits local diagnostic bytes.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Native export collection gaps belong to the [Android export contract](../../apps/android/README.md#local-support-export) and [Apple application contract](../../apps/apple/README.md). Go tests do not establish Android/iOS binding, native cancellation, final application packaging, or saved-byte behavior.
- An approved result means the pinned default rules reported no findings. Producer field selection and application identity remain separate requirements.
- The library owns Gitleaks' logger and configuration within an isolated Go runtime. Unrelated Go consumers must not reconfigure that shared upstream state.
- A deadline refuses admission but does not interrupt an individual regular-expression call; cancellation returns only after the bounded scan has stopped.

### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
