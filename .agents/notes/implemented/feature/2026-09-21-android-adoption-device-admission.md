# Agent Note: The Android client signs every business call with a device admission

Status: implemented

English | [中文](2026-09-21-android-adoption-device-admission.zh.md)

- Date: 2026-09-21
- Class: feature
- Scope: `apps/android/core` (`DeviceAdmission.kt`, `LinkWire.kt`, `LinkClient.kt`), `apps/android/support` (`link-admission.mjs`, `link-admission.test.mjs`, `link-fixture-host.mjs`)

## Problem

The nonce ledger hardened the Host, but no client signed admissions: the Android LinkWire client sent business RPC envelopes and stream-open payloads without any device identity inside the body, so the gateway's per-request admission path had no producer and the replay defense was untested end to end.

## Decision

Every business call now carries the four-key admission. `DeviceAdmission.create` signs the three-line form `deviceId\ntimestamp\nnonce` with the paired Ed25519 key and a fresh UUID nonce per call. `LinkRequestEnvelope` renders it as `payload.device` beside `args` — the Link wire's mirror of the gateway's versioned request envelope — and `stream()` places it as `args.device`, mirroring the gateway's stream-open placement. `currentIdentity()` centralizes the paired-identity load the carrier headers already used. Pairing and `/link/describe` stay admission-free: they precede or do not need a business identity.

The fixture host verifies what the gateway enforces, through a testable tracker (`link-admission.mjs`): four-key shape, acceptance window, signature against the pairing-registered key, and the replay ledger — per-device seen nonces with per-entry lazy expiry at two windows plus the last-admitted timestamp/nonce pair, refusing `device/replay-detected` for a reused nonce at any timestamp and for a regressed timestamp. The tracker is process-local by design; the product gateway owns durability. `/api` and `/link/stream` now REQUIRE the admission, so the lane cannot pass on an unsigned call.

## Evidence

- `:core:test` — `LinkClientTest` proves the carried signature is exactly the deterministic re-sign over the three-line form with the stored key and that two calls carry distinct nonces; `LinkWireTest` pins the `payload.device` rendering; two envelope-shape pins updated with the behavior.
- `node --test apps/android/support/link-admission.test.mjs` — five tracker cases: admit, malformed shapes, not-found/expired/foreign-key, both replay refusals, and ledger expiry.
- The emulator lane (real app UI pairing through the fixture) verified five admissions with five distinct nonces across both surfaces — `/api/session/list`, `/api/workspaceFiles/list`, `/api/workspaceFiles/read`, `/link/stream/$events`, `/link/stream/workspace/follow` — and the classified `gateway/permission-denied` refusal still presents, proving admission verification precedes the permission gate exactly as the gateway orders it.

## Alternatives considered

- Carrier headers only (the existing `x-dsh-*` request signature): those sign the transport request, not a per-request identity inside the body, and the gateway's admission path never sees them.
- An admission on `/link/describe`: describe is host metadata the gateway serves anonymously; signing it adds nothing and couples description to pairing state.

## Consequences

- A captured Link request body is dead as a replay: the nonce ledger refuses it on the next presentation, and each retry needs a fresh nonce signed by the paired key.
- The fixture's replay ledger is process-local; a fixture restart forgets seen nonces (the lane instrument does not claim the gateway's durable high-water semantics).
- iOS adoption remains open; the Swift mirror of this client surface does not exist yet.
