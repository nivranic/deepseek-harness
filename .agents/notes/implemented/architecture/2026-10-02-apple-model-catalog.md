# Agent Note: Apple contract adopts the model-selection vocabulary (§30)

Status: implemented

English | [中文](2026-10-02-apple-model-catalog.zh.md)

## Problem

Section 30's model-selection half had a contract-level gap on Apple: the Android core parses `session/modelCatalog` (provider groups, routable models, per-model reasoning efforts with a default) and sends `session/selectModel` (request envelope, `reasoningEffort` riding only when present), but the Swift contract column mirrored neither — an Apple client had no declared vocabulary for reading a Host catalog or composing a selection.

## Decision

- `NativeModelCatalog.decode` mirrors `SessionModel.modelCatalog` with its exact leniency: entries without a string id drop (groups, models, efforts), names fall back to their id, a non-object `reasoning` field reads as absent, `default`'s non-string members read as empty, malformed JSON fails, and a non-object document reads as an empty catalog. `NativeEffortChoice`/`NativeModelReasoning` carry the effort vocabulary (`efforts` with id-fallback names, nullable `defaultEffort`).
- `NativeModelSelection.wireBody()` mirrors `SessionModel.selectModel`: the `{"request": {sessionId, provider, model, reasoningEffort?}}` envelope, the effort key present only when non-nil — an effort-free selection is byte-identical to the pre-effort wire.
- Shared fixtures `apps/apple/contract/fixtures/native-model-catalog/` (one canonical document with a reasoning model and an id-only group, three leniency edge cases, one truncated document) are consumed by BOTH columns: `NativeModelCatalogFixtureTest` drives the real Kotlin parser through `FakeWire` and pins exact parsed structures; the Swift self-check (`dsh-contract-check`, macOS CI lane) decodes the same bytes and asserts identical structures plus the request-envelope shape.
- The catalog parser is deliberately lenient where the roster is strict: the roster is a durable local document (corruption refuses), while the catalog is a Host wire response (unknown shapes degrade, never crash) — the mirror adopts each surface's own semantics.

## Alternatives considered

- **A strict catalog decoder rejecting unknown shapes:** the Kotlin authority drops and falls back; a stricter Swift column would reject documents Android accepts, breaking parity for no safety gain on a Host-fed response.
- **Validating the fixtures only on one side:** single-column fixtures drift silently; the roster increment set the two-column precedent and it holds here.

## Consequences

- The Swift column still has no shell UI, simulator, or device qualification; this is contract-level parity only (the section's remaining open work).
- Fixture count is pinned (1 valid + 3 edge + 1 invalid) in both columns, mirroring the roster's 14-case pin.

## Open work

- Apple-side UI entry consuming this vocabulary; real-device qualification; the Swift compile itself is validated only on the macOS CI lane (no local Swift toolchain on Windows).
