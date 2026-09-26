---
description: "Device-trust seam on the candidate gateway: one-time pairing issuance, durable device grants, signed admission, and revocation."
kind: "package-reference"
---
# Device Trust

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-device-trust` owns the Host `ctx.deviceTrust` service: the device-trust seam named by the [link-access takeover audit](../../../.agents/notes/implemented/architecture/2026-09-20-link-access-takeover-audit.md). The gateway owns device-facing access; pairing is a capability-gated ceremony rather than a resurrected Link server, and permission execution stays with the interaction-reply seam. The service issues one-time expiring pairing codes, redeems them against the device's freshly generated Ed25519 public key, holds the durable grant store over the storage-domain seam, verifies signed admissions, and revokes grants.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load `@deepseek-ai/dsh-api-device-trust` in a Host composition to expose `ctx.deviceTrust`. The Remote surface carries seven capability-gated methods (`deviceTrust/issuePairing`, `deviceTrust/redeemPairing`, `deviceTrust/admitDevice`, `deviceTrust/listDevices`, `deviceTrust/revokeDevice`, `deviceTrust/revokeAllDevices`, `deviceTrust/renameDevice`); capabilities declare `device-pair.issue.v1`, `device-pair.redeem.v1`, `device.admit.v1`, `device.list.v1`, `device.revoke.v1`, `device.revoke-all.v1`, and `device.rename.v1`, so a Client refuses the operations an unprepared Host never declared. Issue, list, revoke, revoke-all, and rename declare `requiredPermission: device.admin`: a device-identified Gateway request holding that permission may invoke them; redeem and admit stay undeclared because they precede any device identity.

A pairing code is a single-use secret with an expiry (`pairingTtlMs`, default five minutes): a concurrent or later redemption fails with `device/pairing-invalid`, redemption after the expiry fails with `device/pairing-expired`, and a key that is not a base64 Ed25519 SPKI DER fails with `device/key-invalid`. Redemption registers the key's SHA-256 fingerprint; listing returns views without key material. Revocation keeps the grant listed with its revocation time — a later admission must treat it as refused.

Roles use the section 21 table names (`viewer`, `collaborator`, `controller`, `owner`) and hold exactly that table's permission columns (`view`, `prompt.send`, `question.respond`, `approval.respond`, `device.admin` via `DEVICE_ROLE_PERMISSIONS`); they never grant capability or permission beyond it. The Host default role comes from `defaultRole` (default `viewer`).

`admitDevice` verifies base64 Ed25519 over the UTF-8 bytes of `deviceId + "\n" + timestamp + "\n" + nonce` using the paired key. Every request carries a fresh nonce and a timestamp inside `admissionWindowMs` (default five minutes). Unknown devices, revoked grants, expired timestamps and invalid signatures fail before durable admission. Fresh proofs may arrive out of timestamp order. The serialized storage update rechecks revocation and expiry, rejects a consumed nonce hash or a timestamp below the durable retirement floor with `device/replay-detected`, and persists the accepted hash before returning. All retained receipts survive Host restart. `lastAdmittedAt` records the newest accepted timestamp for display only.

`maxAdmissionNonces` bounds retained hashes per device (default 4096). A full ledger refuses with `device/admission-capacity` (`host-state`, details `deviceId`, `limit`, `retryAt`) instead of evicting live receipts; a later explicit request can succeed after receipts expire. The nondecreasing retirement floor prevents discarded proofs from becoming valid after clock rollback or a wider window. The `device_trust` domain requires version 2 and rejects version 1 without migration. The [admission decision](../../../.agents/notes/implemented/bug-fix/2026-09-26-durable-unordered-device-admission.md) owns the rationale and first-arrival replay limitation.

## Model Experience

None, as the pairing ceremony and admission are Client and Host control state and register no prompt, tool, or session event.

#### KV Cache effect

No direct effect; device-trust operations do not alter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Grants live in the durable `device_trust` storage domain (single layout over the composed json backend): they survive Host restarts, an invalid stored record rejects the open, and a failed store write leaves a pairing code redeemable. Pending pairing codes stay process-local by design — a one-time expiring secret must not survive a restart.
- Admission commit rechecks revocation, expiry, nonce consumption and capacity in the same storage update; a request queued behind revocation cannot be admitted. Gateway observes revocation from stream admission onward and requires fresh device-owned reply signatures; the [Gateway README](../gateway/README.md) owns stream and reply rules.
- Shared presentation classifies `device/admission-expired` and `device/key-invalid` as authentication, `device/not-found` as unavailable, and `device/already-revoked` as conflict. Other pairing failures retain their owner-defined codes.
- This service opens no network listener. [Native Remote Connection](../native-remote/README.md) provides the opt-in encrypted device source without relaxing local Web authentication.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The audit decision recorded in `.agents/notes/implemented/architecture/2026-09-20-link-access-takeover-audit.md` owns the placement: the retired `packages/remote/link-*` and `device-trust` groups stay retired, and this seam is the single owner of device-facing access on the candidate gateway.

</details>

**Runtime invariant:** No companion is published. Grants are durable over the `device_trust` domain while pairing codes are process-local; roles name the section 21 permission columns, permission execution stays with the interaction-reply seam, and admission binds one signature verification to one stream open.
