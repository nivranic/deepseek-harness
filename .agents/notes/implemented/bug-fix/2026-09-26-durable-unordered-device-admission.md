# Agent Note: Durable device admission accepts fresh proofs out of order

Status: implemented

English | [中文](2026-09-26-durable-unordered-device-admission.zh.md)

## Problem

Independent signed requests can reach the Host out of timestamp order. Rejecting every timestamp below the last accepted one refuses legitimate concurrent reads. Persisting only the latest nonce also forgets earlier accepted proofs at the same timestamp after restart, allowing their replay inside the acceptance window.

## Decision

Device Trust persists every accepted nonce as a SHA-256 hash with its signed timestamp in the device grant. The serialized durable update rechecks revocation and expiry, rejects consumed hashes, and accepts fresh proofs regardless of arrival order. A failed write consumes no nonce. The timestamp maximum remains only a last-seen observation.

A nondecreasing admission floor retires receipts older than the current window and rejects proofs below that floor. Persisting the floor with each successful admission prevents clock rollback or a later window expansion from reviving discarded proofs. Receipts at the floor remain live. The per-device `maxAdmissionNonces` limit defaults to 4096; capacity refuses with `device/admission-capacity` and an earliest `retryAt` instead of evicting a live receipt. The error belongs to `host-state`, and clients do not automatically retry signed mutations.

The four-key `{deviceId, timestamp, nonce, signature}` proof and three-line `deviceId + "\n" + timestamp + "\n" + nonce` signature remain unchanged. Nonces distinguish legitimate same-millisecond requests. Storage domain version 2 requires the floor and complete receipt list; version 1 is rejected without migrating user data. This decision supersedes the [archived high-water policy](../../archived/feature/2026-09-21-admission-nonce-ledger.md). The [Android producer decision](../feature/2026-09-21-android-adoption-device-admission.md) still owns client signing and the legacy fixture.

## Alternatives considered

**A strict timestamp high-water mark:** legitimate independent requests arrive out of order, while rejecting equal timestamps also rejects distinct same-millisecond requests. Persisting just the last nonce leaves earlier same-timestamp proofs replayable after restart.

**A process-local nonce cache:** restart erases consumed proofs while their signatures remain valid. The legacy fixture can exercise signing but cannot qualify durable native admission.

**Evicting live receipts at capacity:** an evicted proof becomes replayable. Explicit capacity refusal keeps the replay guarantee and bounds retained storage; expiry permits later admission.

**Removing retired receipts without a durable floor:** clock rollback or a larger configured window can make an already-consumed proof valid again after its receipt disappears.

## Consequences

Every admitted proof stays consumed across restart while its timestamp is admissible. A captured proof that arrives before the original can still succeed once: a nonce ledger cannot distinguish the first presenter. TLS pinning, device signatures and local Web authentication remain required; this change does not relax transport or cookie checks.

Deterministic Host tests cover out-of-order delivery, every same-timestamp replay across restart, concurrent duplicate admission, failed durable writes, capacity and expiry, clock rollback, window changes, queued expiry and revocation, malformed stored receipts, and rejection of version 1. Real-composition Android verification uses the native Host listener; the diagnostic APK observed `timestamp-regressed` on the earlier Host build. Swift verification remains CI-owned and is not executed on this Windows host.
