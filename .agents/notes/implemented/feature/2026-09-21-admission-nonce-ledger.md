# Agent Note: Device admission carries a replay nonce ledger

Status: implemented

English | [中文](2026-09-21-admission-nonce-ledger.zh.md)

- Date: 2026-09-21
- Class: feature
- Scope: `packages/api/device-trust`, `packages/api/gateway`, `packages/typert/protocol`, `apps/android/contract`, `apps/apple/contract`

## Problem

A signed device admission covered only `deviceId` and `timestamp`, so a captured envelope replayed inside the ±5-minute acceptance window verified again — the spec's replay requirement was settled for pairing codes but request admission had no replay defense, and the section 21 traceability row carried the open nonce-ledger clause.

## Decision

Every admission now carries a fresh `nonce`, and the signed message is the three-line form `deviceId + "\n" + timestamp + "\n" + nonce`. The gateway's wire parser accepts exactly the four-key `{deviceId, timestamp, nonce, signature}` shape on both the per-request envelope and the stream-open `args.device` path. After the signature verifies, `admitDevice` refuses a replay with the new `device/replay-detected` code (`reason: timestamp-regressed | nonce-reuse`, classified `authentication`) before recording the new high-water mark: a timestamp older than the grant's durable `lastAdmittedAt`, or a nonce this process already admitted, or the exact persisted `lastAdmittedAt`/`lastAdmittedNonce` pair. The high-water pair lives on the grant record, so replay protection survives Host restarts; the process-local per-device nonce ledger expires at twice the admission window — outside that horizon a replayed admission can no longer pass the window check at all. The durable update re-validates monotonicity inside the storage transform, so two racing admissions cannot both land.

`admitDevice` became `async` for the durable update; both gateway call paths await it inside their existing error-folding regions.

Repairing the contract mirrors surfaced a latent defect this increment also fixes: the deviceRoleAdmission increment refreshed the apple schema fixture (90 branches) but left the Swift guard at 85 and both native mirrors without any `device/*` codes, so the Swift self-check executable had been failing on `main`-line candidates since that push. Both mirrors now carry `device/admission-expired` and `device/replay-detected` as authentication, the Kotlin schema test pins 92 branches/91 known codes, the Swift guards pin the same, and all fixtures are regenerated (the fixture copy must run after the schema regen — running it before leaves the copy one code behind).

## Alternatives considered

- A persisted strict high-water without nonces: equal-millisecond legitimate requests would collide, and exact replay of the newest envelope after a restart would still pass.
- Rejecting non-increasing timestamps with `<=`: two legitimate admissions inside one millisecond would fail; the nonce ledger already refuses the exact replay that equal timestamps imply.
- Keeping the replay window open and documenting it: the window is five minutes of replayability for a captured signature, which the section 21 remaining list explicitly tracked as unacceptable.

## Consequences

- A captured admission is dead the moment the original reaches the Host; after a restart only an envelope newer than the persisted high-water and with an unseen nonce verifies.
- A device clock that steps backward fails admissions until wall time catches up to the last accepted timestamp — bounded by the window, inherent to any monotonic scheme.
- A replay arriving before the original delivery still succeeds once (the narrow race a per-request nonce ledger cannot close without transport ordering); the window bounds it and the note records it.
- Swift-lane verification is CI-owned (macos-15 runs the self-check executable); this host cannot run Swift locally.
