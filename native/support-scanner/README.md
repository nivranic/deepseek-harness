---
description: "Admit immutable local support documents with the pinned Gitleaks rules and joined cancellation."
kind: "package-library"
---

# Support scanner

English | [中文](README.zh.md)

## Summary

Callers can scan one bounded diagnostic document entirely in memory and retrieve only the exact approved bytes. Each operation checks a real canary before scanning the document with the pinned Gitleaks default rules. Cancellation waits for scanner completion and refuses partial results. Swift/Kotlin bindings and mobile application export actions require separate integration.

## Table of Contents

- [Use the library](#use-the-library)
- [Understand the implementation](#understand-the-implementation)
- [Verification](#verification)
- [Build Android resources](#build-android-resources)
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

The [mobile scanner workflow](../../.github/workflows/mobile-support-scanner.yml) builds these resources on Linux. Its `BUILT` receipt establishes static packaging checks. Native execution, application integration and actual 16 KiB-device acceptance remain separate requirements.

## Model Experience

None. The library admits local diagnostic bytes.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Mobile applications do not bundle this library or expose a support-export action through it. Go tests do not establish Android/iOS binding, native cancellation, packaging, or saved-byte behavior.
- An approved result means the pinned default rules reported no findings. Producer field selection and application identity remain separate requirements.
- The library owns Gitleaks' logger and configuration within an isolated Go runtime. Unrelated Go consumers must not reconfigure that shared upstream state.
- A deadline refuses admission but does not interrupt an individual regular-expression call; cancellation returns only after the bounded scan has stopped.

### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
