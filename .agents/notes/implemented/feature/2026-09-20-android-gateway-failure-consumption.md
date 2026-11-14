# Agent Note: The Android shell consumes the Gateway failure contract

Status: implemented

English | [中文](2026-09-20-android-gateway-failure-consumption.zh.md)

## Problem

The migrated Android shell carried a validated Kotlin mirror of the shared failure contract (`apps/android/contract`: `RemoteFailureClass`, `RemoteFailureClasses`, envelope-schema evidence) that nothing consumed. Gateway refusals reached the shell as `LinkClientException.Refused(code)` — the wire layer parsed and validated the envelope's `details` object only to discard it, and the file viewer classified codes through a private hand-written `when`.

## Current upstream boundary

The TypeScript authority (`REMOTE_FAILURE_CLASSES`, the draft 2020-12 envelope schema) and its Kotlin mirror: codes without shared semantics resolve to `UNKNOWN` and must stay presentable as opaque diagnostics. `ConnectionDiagnostics` deliberately discards codes and messages for its privacy-shaped diagnostics projection — that surface is out of scope and unchanged.

## Decision

- `LinkWire` captures what it already validated: `LinkResult.errorDetails` and the stream failure frame's `details` field are no longer discarded.
- `LinkClientException.Refused` carries the envelope — `details` (defaulted `null`, so existing constructors keep compiling) and `envelopeMessage` (the envelope's message field, distinct from the log-shaped `RuntimeException.message`); the unary-result and stream-failure throw sites populate them.
- `GatewayFailurePresentation.kt` (core, `api(project(":contract"))`) is the consumption seam: `GatewayFailureEnvelope.from(refused)` lifts the envelope; `GatewayFailurePresenter.present` classifies the code through the shared mirror and maps each class to one next action (`reauthenticate`, `abandon`, `retry-later`, `refresh-and-retry`, `fix-input`, `inspect-diagnostics`) and one presentation string. `UNKNOWN` renders the code and message verbatim with details retained on the envelope.
- The file viewer's `readFailureText` consults the classifier first; its private lite-fold codes (not in the shared vocabulary) keep their specific strings, and only truly unknown codes fall back to the opaque form.

## Alternatives considered

Extending `ConnectionFailure` with the code would change a privacy-shaped diagnostics wire vocabulary that deliberately discards codes — rejected. Mapping the shared classes directly onto `readFailureText`'s private codes would have mislabeled lite-fold endpoints whose codes predate the vocabulary — the two-layer lookup (shared vocabulary first, private refinement second, opaque last) keeps both honest. A store-based slot injection (the web clients' pattern) does not apply: the shell has no slot runtime.

## Consequences

Every Gateway refusal the shell can present now carries the complete envelope, and presentation semantics come from the shared classification instead of per-surface code maps. Adding a class to the contract mirror forces a presentation decision: `GatewayFailurePresentationTest.everyClassCarriesADistinctActionTextPair` enumerates all ten classes, and the mirror's own `EnvelopeSchemaTest` still pins the vocabulary to the TypeScript projection. Evidence: `:contract:test` + `:core:test` 185/185 (including envelope-preservation cases in `LinkClientTest`), `:app:assembleDebug` through the scanner gate, APK installed and launched on the local AVD with zero crash entries.
