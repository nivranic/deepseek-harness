---
description: "Scan immutable mobile support documents with pinned Gitleaks rules and verify Android build provenance."
kind: "package-library"
---

# Support scanner

English | [中文](README.zh.md)

## Summary

Native callers can scan a bounded diagnostic document in memory and retrieve only its exact approved bytes. The library uses pinned Gitleaks rules, checks a real canary, and joins cancellation before returning. The [Android companion](../../apps/android/README.md#local-support-export) consumes the JNI library. This Go module has its own dependency checksums and is independent of the Node native workspace.

## Table of Contents

- [Use the library](#use-the-library)
- [Verify the source](#verify-the-source)
- [Build Android resources](#build-android-resources)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-the-library"></a>
## Use the library

`NewOperation` copies the document and validates its byte and time limits. Run scanning and cancellation joins away from the UI thread. Only an `approved` result contains bytes; deliver `Result.Data()` unchanged. `Cancel` waits for an active scan, while the application exporter owns cancellation between admission and delivery. The scanner does not establish document field ownership, application identity or Host health.

<a id="verify-the-source"></a>
## Verify the source

The source gate requires Node, Python 3.10 or later, and the exact Go compiler in [build.json](build.json). `DSH_SCANNER_GO` and `DSH_SCANNER_PYTHON` select executable paths when they are not on `PATH`. From the repository root, run:

```sh
pnpm run test:support-scanner
```

The gate checks its own refusal controls, the Python source/artifact/builder tests, Go module integrity, Go behavior tests and `go vet`. It refuses missing test owners, empty or entirely skipped test sets, and a different Go compiler. Its result reports skipped Python tests separately. `GOPROXY` may select a public module mirror; the gate enforces `sum.golang.org` verification and read-only module resolution instead of inheriting checksum bypasses or alternate workspace/module settings. This gate does not run race analysis or build an AAR.

<a id="build-android-resources"></a>
## Build Android resources

The [Python entrypoint](../../scripts/build-mobile-support-scanner.py) accepts the following inputs. The requested source commit must contain the exact running builder files; uncommitted builder edits cannot build an older source identity.

| Argument | Input |
|---|---|
| `--source-sha` | Full lowercase Git commit SHA |
| `--go`, `--android-sdk`, `--android-ndk`, `--java-home` | Installed toolchain paths matching the committed policy and Java 17 |
| `--cache` | Private Go dependency and compilation cache, outside the artifact directory |
| `--work-dir`, `--output` | New, separate working and artifact directories |
| `--module-proxy` | Optional credential-free HTTPS dependency proxy; defaults to `https://proxy.golang.org` |

The builder materializes committed scanner bytes through its private module proxy and verifies those bytes against Git. External modules keep checksum-database verification when a different HTTPS proxy is selected. The builder checks both JNI architectures, 16 KiB ELF alignment, generated Java entrypoints, R8 rules, native module identities, private-path exclusion and license material before writing the AAR and receipt. Tool output stays in the private working directory. A `BUILT` receipt describes static packaging; it does not prove installed execution or same-candidate application acceptance.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The library parses embedded upstream rules with a private configuration instance and disables the scanner logger inside its isolated Go runtime. Ambient configuration and inline allow comments cannot exempt findings. Canary and document scans use separate detectors. Cancellation is checked after detection because an interrupted detector can return partial findings. The [build provenance decision](../../.agents/notes/implemented/process/2026-09-27-native-scanner-source-and-build-provenance.md) owns source identity and verification policy.

</details>

<a id="model-experience"></a>
## Model Experience

None. The library admits local diagnostic bytes.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

An approved document means the pinned rules reported no findings; producer privacy rules remain necessary. A deadline refuses admission but cannot interrupt one regular-expression call, so cancellation waits for the bounded scan to finish. The library owns Gitleaks logging and configuration in an isolated Go runtime; unrelated Go consumers must not reconfigure that shared state.

Source checks do not qualify a current-commit AAR, reproducible application build, native cancellation, release signing, physical devices, 16 KiB devices or Apple bindings. The Android build configuration records the external scanner it currently consumes; replacing that artifact requires a separately verified build and installed-app evidence. The Windows source gate reports its unsupported directory-symlink test as skipped. Race and reachable-dependency vulnerability analysis require separate execution.

<a id="dev-note"></a>
### Dev Note

None.
