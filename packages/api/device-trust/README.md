---
description: "Device-trust seam on the candidate gateway: one-time pairing issuance, device grants, and revocation."
kind: "package-reference"
---
# Device Trust

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-device-trust` owns the Host `ctx.deviceTrust` service: the device-trust seam named by the [link-access takeover audit](../../../.agents/notes/implemented/architecture/2026-09-20-link-access-takeover-audit.md). The gateway owns device-facing access; pairing is a capability-gated ceremony rather than a resurrected Link server, and permission execution stays with the interaction-reply seam. The service issues one-time expiring pairing codes, redeems them against the device's freshly generated Ed25519 public key, holds the durable grant store over the storage-domain seam, and revokes grants.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load `@deepseek-ai/dsh-api-device-trust` in a Host composition to expose `ctx.deviceTrust`. The Remote surface carries four capability-gated methods (`deviceTrust/issuePairing`, `deviceTrust/redeemPairing`, `deviceTrust/listDevices`, `deviceTrust/revokeDevice`); capabilities declare `device-pair.issue.v1`, `device-pair.redeem.v1`, `device.list.v1`, and `device.revoke.v1`, so a Client refuses the operations an unprepared Host never declared.

A pairing code is a single-use secret with an expiry (`pairingTtlMs`, default five minutes): a second redemption fails with `device/pairing-invalid`, redemption after the expiry fails with `device/pairing-expired`, and a key that is not a base64 Ed25519 SPKI DER fails with `device/key-invalid`. Redemption registers the key's SHA-256 fingerprint; listing returns views without key material. Revocation keeps the grant listed with its revocation time — a later role-mapped admission must treat it as refused.

Roles use the section 21 wire names (`viewer`, `collaborator`, `admin`) and name what the Client may ask next; they never grant capability or permission directly. The Host default role comes from `defaultRole` (default `viewer`).

## Model Experience

None, as the pairing ceremony is Client and Host control state and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; device-trust operations do not alter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Grants live in the durable `device_trust` storage domain (single layout over the composed json backend): they survive Host restarts, an invalid stored record rejects the open, and a failed store write leaves a pairing code redeemable. Pending pairing codes stay process-local by design — a one-time expiring secret must not survive a restart. Role-mapped permission checks through the section 15 seam and request-signature admission remain the next Phase 7 steps.
- The new `device/*` failure codes stay deliberately unclassified in the shared presentation vocabulary until they carry cross-Client semantics.
- No non-localhost admission opens here: the localhost line stays closed until the LAN TLS/pinning decision.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The audit decision recorded in `.agents/notes/implemented/architecture/2026-09-20-link-access-takeover-audit.md` owns the placement: the retired `packages/remote/link-*` and `device-trust` groups stay retired, and this seam is the single owner of device-facing access on the candidate gateway.

</details>

**Runtime invariant:** No companion is published. Grants are durable over the `device_trust` domain while pairing codes are process-local; roles name the next Client step, permission execution stays with the interaction-reply seam.
