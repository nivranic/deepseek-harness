# @deepseek-ai/dsh-android

English | [中文](README.zh.md)

The downstream thin Android companion for DeepSeek Harness. The device is a Remote Companion first: it never runs the agent runtime and holds no second session truth. This project starts with the contract module that consumes the shared Remote failure vocabulary; the `core` domain module and the `app` shell have now migrated onto this build from the historical Android application source.

## Use this project

The `contract` module is a Kotlin JVM library that mirrors the candidate's Remote failure contract:

- `RemoteFailureClass` and `RemoteFailureClasses.classify(code)` mirror `RemoteFailureClass`/`REMOTE_FAILURE_CLASSES` from `@deepseek-ai/dsh-typert-protocol`. Codes without shared semantics — including every future code from a newer Host — resolve to `UNKNOWN` and must stay presentable as opaque diagnostics. A class names what the Client may do next; it never grants capability, permission, retry policy, or protocol-version admission.
- `EnvelopeSchemaTest` validates real recorded HTTP payloads against [the Remote failure JSON Schema](../../packages/typert/protocol/remote-errors.schema.json), rejects malformed known-code details, and proves the Kotlin mirror equals the generated projection of the TypeScript authority.

The schema is copied into the test run straight from the protocol package, so the Kotlin column always validates the current candidate bytes. The classification projection regenerates with `node scripts/gen-remote-failure-classes-json.mjs` (after `pnpm run build:lib`); committed output is verified by the test, and drift fails the build.

The `core` module is the migrated pure-JVM domain: the Lite fold (loop, chat, stores, tool registry), the Link pairing/wire stack (Noise, signing, pinning, diagnostics), Handoff snapshots, support export, and push/relay clients. Its 37 test classes run on the JVM with `gradlew :core:test` — no Android SDK needed. The `app` module carries the Compose surface (chat screen, notifications, Keystore cipher, support scanner glue); building it requires the support-scanner AAR chain described under Known Limitations.

Run the tests with the Gradle wrapper from this directory (`gradlew.bat :contract:test :core:test` on Windows, `./gradlew :contract:test :core:test` elsewhere); the first run downloads the Gradle distribution and dependencies.

## Understand the implementation

| File | Role |
|---|---|
| `contract/src/main/kotlin/ai/deepseek/dsh/contract/RemoteFailureClass.kt` | The closed presentation-class enum mirroring the TypeScript union |
| `contract/src/main/kotlin/ai/deepseek/dsh/contract/RemoteFailureClasses.kt` | The classified-code mirror; unlisted codes resolve to `UNKNOWN` |
| `contract/src/test/kotlin/ai/deepseek/dsh/contract/EnvelopeSchemaTest.kt` | Schema validation of real payloads plus mirror-drift and vocabulary-subset checks |
| `contract/src/test/resources/generated/` | The committed projection of the TypeScript authority |
| `core/src/main/kotlin/ai/deepseek/dsh/companion/` | Migrated domain: Lite fold, transport classification, diagnostics, support export |
| `core/src/main/kotlin/ai/deepseek/dsh/link/` | Migrated Link stack: Noise channels, signing, pinning, request snapshots |
| `app/src/main/kotlin/ai/deepseek/dsh/companion/` | Migrated Compose shell: MainActivity, chat screen, notifications, Keystore cipher |
| `support/link-fixture-host.mjs` | Host-side Link fixture for the emulator lane: pairs one device over pinned TLS, verifies Ed25519 request signatures, and refuses `workspaceFiles/read` with the classified `gateway/permission-denied` envelope; the committed `fixture-host-cert.pem`/`fixture-host-key.pem` are throwaway localhost fixture credentials, not product secrets |

## Model Experience

The contract and core modules run in JVM tests only; the migrated app shell has no model-facing surface wired on this build yet.

## Known Limitations and Deferred Work

`:app:assembleDebug` is gated on `verifyScannerResources`: the support-scanner AAR must be built from `native/support-scanner` (Go + Android NDK via `scripts/build-mobile-support-scanner.py`) and passed through `DSH_ANDROID_SCANNER_DIRECTORY`/`DSH_ANDROID_SCANNER_SOURCE` with its receipt. This host built that chain (Go 1.27.1, NDK 30.0.16248370 through sdkmanager): the AAR's static verification is PASS with its receipt, `:app:assembleDebug` passes the gate, and the APK installs and launches on a local emulator AVD with `MainActivity` resumed and no crash (log and screenshot in `.artifacts/scanner-aar-*.log`). The unreachable sum/proxy endpoints were worked around by pre-seeding the module cache through the goproxy.cn mirror with a pre-seeded go.sum, `GOSUMDB=off` for child processes (content integrity stays enforced by the ziphash cache, `go mod verify`, and the builder's provenance asserts), and stripped linking for the gomobile tools (the 360 active-defense heuristic blocks the default gobind binary). The shell consumes the Gateway failure contract: refusals carry the failure envelope verbatim (code, message, structured details) out of unary results and stream failure frames, and presentation classifies every code through the shared `RemoteFailureClasses` mirror — known classes get class-level copy and a next action, codes outside the vocabulary stay opaque diagnostics (`GatewayFailurePresentation.kt`, covered by `GatewayFailurePresentationTest` and the envelope-preservation cases in `LinkClientTest`).

The emulator lane drives the classified refusal end to end against the committed Link fixture (`support/link-fixture-host.mjs`): the shell pairs through its pairing screen over the fixture's pinned TLS, every request carries a server-verified Ed25519 signature, and the refused `workspaceFiles/read` presents the class copy `Host 拒绝了本次调用` in the Files tab (exchange log, UI dump, and screenshot in `.artifacts/android-refusal-fixture/`). Driving that exchange repaired two shell defects the JVM tests could not see: platform Conscrypt exposes no Ed25519 key generation (Android issue 399856239), so the app bundles `org.conscrypt:conscrypt-android` and registers the provider when the platform lacks it; and the Files model's `workspace/follow` stream was never started, leaving the Files tab permanently empty. No physical-device or release-signing qualification is claimed and no artifact is published.
