# Agent Note: The device-trust seam lands pairing issuance and grants on the gateway

Status: implemented

English | [中文](2026-09-20-device-trust-seam.zh.md)

## Problem

The link-access takeover audit named the candidate gateway the single owner of device-facing access and sequenced Phase 7 from a device grant store and pairing issuance. Until this seam existed, no candidate package could issue a pairing code, register a device key, or revoke a grant — the only pairing server the Android shell ever spoke to was the emulator-lane fixture.

## Decision

New package `@deepseek-ai/dsh-api-device-trust` at `packages/api/device-trust/`: a `TypertRemoteService` (`ctx.deviceTrust`) whose four capability-gated Remote methods are `deviceTrust/issuePairing` (`device-pair.issue.v1`), `deviceTrust/redeemPairing` (`device-pair.redeem.v1`), `deviceTrust/listDevices` (`device.list.v1`), and `deviceTrust/revokeDevice` (`device.revoke.v1`). A pairing code is a single-use secret with a configured expiry (`pairingTtlMs`, default five minutes): second redemption fails `device/pairing-invalid`, late redemption fails `device/pairing-expired`, and a key that is not a base64 Ed25519 SPKI DER fails `device/key-invalid`. Redemption registers the key's SHA-256 fingerprint into a process-local grant store; listing returns views without key material; revocation keeps the grant listed with its revocation time. Roles use the section 21 wire names (`viewer`, `collaborator`, `admin`) and name what the Client may ask next — permission execution stays with the section 15 seam, and no non-localhost admission opens.

The package composes into the web-app Host bundle; the web client bundle carries the dependency; the repository registers its Host program, its source paths, its subsystem pages (`docs/subsystems/device-trust.{md,zh.md}` with type-equivalence blocks for all seven wire types), its service row in the doc graphs, and its catalog entries.

## Alternatives considered

- **Port the legacy `link-access` server.** Rejected by the audit decision: the gateway's capability and permission seams apply to devices exactly as to web/desktop clients, and a parallel admission model would fork permission semantics.
- **Durability in this increment.** Deferred: a durable grant store carries persistence-catalog and format-version obligations that deserve their own increment; the process-local store is recorded as the limitation.
- **Classify the new `device/*` codes in the shared presentation vocabulary.** Deferred by the vocabulary's own policy: codes join `REMOTE_FAILURE_CLASSES` only once they carry cross-Client semantics; until then they stay presentable as opaque diagnostics.

## Consequences

Phase 7 has its first increment on the named seam: an operator can issue a code, a device can redeem it with its Ed25519 key, grants list without key material, and revocation is enforced with stable `device/*` failure codes (the known-code schema now carries 89 codes; the Kotlin and Swift contract fixtures refresh from the regenerated projection). The audit note's retired-group references were reworded so the package-paths gate no longer reads them as drift against the new real `device-trust` package name. Next Phase 7 steps: durable grant storage, role-mapped permission checks through the section 15 seam, and request-signature admission; the Android shell migrates onto gateway admission after the pairing seam is complete.
