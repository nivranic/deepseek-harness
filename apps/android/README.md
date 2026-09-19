# @deepseek-ai/dsh-android

English | [中文](README.zh.md)

The downstream thin Android companion for DeepSeek Harness. The device is a Remote Companion first: it never runs the agent runtime and holds no second session truth. This project starts with the contract module that consumes the shared Remote failure vocabulary; the native shell migrates onto it incrementally from the historical Android application source.

## Use this project

The `contract` module is a Kotlin JVM library that mirrors the candidate's Remote failure contract:

- `RemoteFailureClass` and `RemoteFailureClasses.classify(code)` mirror `RemoteFailureClass`/`REMOTE_FAILURE_CLASSES` from `@deepseek-ai/dsh-typert-protocol`. Codes without shared semantics — including every future code from a newer Host — resolve to `UNKNOWN` and must stay presentable as opaque diagnostics. A class names what the Client may do next; it never grants capability, permission, retry policy, or protocol-version admission.
- `EnvelopeSchemaTest` validates real recorded HTTP payloads against [the Remote failure JSON Schema](../../packages/typert/protocol/remote-errors.schema.json), rejects malformed known-code details, and proves the Kotlin mirror equals the generated projection of the TypeScript authority.

The schema is copied into the test run straight from the protocol package, so the Kotlin column always validates the current candidate bytes. The classification projection regenerates with `node scripts/gen-remote-failure-classes-json.mjs` (after `pnpm run build:lib`); committed output is verified by the test, and drift fails the build.

Run the contract tests with the Gradle wrapper from this directory (`gradlew.bat :contract:test` on Windows, `./gradlew :contract:test` elsewhere); the first run downloads the Gradle distribution and dependencies.

## Understand the implementation

| File | Role |
|---|---|
| `contract/src/main/kotlin/ai/deepseek/dsh/contract/RemoteFailureClass.kt` | The closed presentation-class enum mirroring the TypeScript union |
| `contract/src/main/kotlin/ai/deepseek/dsh/contract/RemoteFailureClasses.kt` | The classified-code mirror; unlisted codes resolve to `UNKNOWN` |
| `contract/src/test/kotlin/ai/deepseek/dsh/contract/EnvelopeSchemaTest.kt` | Schema validation of real payloads plus mirror-drift and vocabulary-subset checks |
| `contract/src/test/resources/generated/` | The committed projection of the TypeScript authority |

## Model Experience

None. The contract module runs in JVM tests only; no model-facing surface exists yet.

## Known Limitations and Deferred Work

The native shell (UI, Keystore, notifications, share, deep links) has not migrated yet; this project deliberately rebuilds on the shared contract instead of copying the historical `apps/android` tree. No emulator or physical-device qualification is claimed, no artifact is published, and the Swift column remains future work. Running the wrapper requires network access to download Gradle on a clean machine.
