# Agent Note: The Android Link fixture drives a classified refusal end to end

Status: implemented

English | [中文](2026-09-20-android-link-fixture-refusal-lane.zh.md)

## Problem

The gateway-consumption increment left the emulator lane at launch-only smoke: no live Host-to-device exchange had ever been driven, and the record named a Host-facing pairing fixture as the missing precondition. The migrated shell's Link stack (pairing over pinned TLS, Ed25519 request signing, refusal envelopes) was verified only against JVM in-process HTTP servers.

## Decision

Commit a minimal Host-side Link fixture (`apps/android/support/link-fixture-host.mjs`) that speaks the shell's actual wire: `/link/pair` accepting the one-time QR code, signature verification of every signed request (`timestamp\nPOST\npath\nsha256hex(body)` over Ed25519 with the key registered at pair), the compatible `/link/describe` document, the `workspace/follow` NDJSON stream, and `workspaceFiles/read` refused with the classified `gateway/permission-denied` envelope. HTTPS rides a committed self-signed fixture certificate whose SPKI digest the pairing payload pins, so the TLS-plus-pinning path the real protocol uses stays exercised instead of bypassing it with cleartext. A driver pairs the real APK through its pairing screen on the AVD (`adb reverse`), navigates to the Files tab, opens the listed file, and captures the presented copy — the shell renders `Host 拒绝了本次调用`, the class-level copy for `PERMISSION`, from `GatewayFailurePresenter`.

Driving the exchange surfaced two real shell defects the JVM tests cannot see, both repaired in the app module:

- Platform Conscrypt exposes no Ed25519 key generation (`KeyPairGenerator.getInstance("Ed25519")` throws; Android issue 399856239, still true on Android 15), so pairing could never succeed on-device. The app now bundles `org.conscrypt:conscrypt-android:2.7.0` and registers the provider at position 2 when no installed provider offers `KeyPairGenerator.Ed25519`; by-name lookups still prefer platform services, and only Ed25519 key generation and signing fall through.
- `FilesModel.start()` was never called (the historical shell carried the same gap), so the `workspace/follow` stream never opened and the Files tab stayed permanently empty. `FilesTab` now starts the stream when paired, mirroring the interactions model's lifecycle.

## Alternatives considered

- **Allow cleartext loopback via a network security config.** Rejected: the product posture is pinned TLS; weakening it for a test lane when the protocol's pinning model works as designed with a self-signed fixture certificate would test a path production never uses.
- **Pre-seed credentials and skip pairing.** Rejected: the app encrypts the credentials store with an Android Keystore cipher, and the pairing exchange is part of what the lane exists to exercise.
- **Classify producer-side job failures via `classifyRemoteFailure`.** Investigated and dropped as architecturally void: all jobs producers (bash, pwsh, subagent) run Host-side where `RemoteError` never occurs, and the dsh-sdk subagent provider normalizes failures to plain errors with fixed messages before settlement — there is no classifiable code to classify. The prior jobs record's limitation line that named producers as a queue item is corrected by this note.

## Consequences

The emulator lane now proves the full classified-refusal chain on-device: pairing over pinned TLS, server-verified Ed25519 signatures, the follow stream, the list call, and the refused read presenting class copy. The fixture certificate and key are committed as throwaway localhost fixture credentials (documented as such in the README and the module doc); regenerating them changes the SPKI fingerprint the driver payload must carry. Core and contract modules are untouched; their JVM suites and the scanner-gated `:app:assembleDebug` stay green. Still unqualified: physical devices, release signing, and any Host beyond this fixture — the candidate harness itself serves no `/link/pair` endpoint, and which package owns device-facing access remains the §48 audit decision.
