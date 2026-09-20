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

Load `@deepseek-ai/dsh-api-device-trust` in a Host composition to expose `ctx.deviceTrust`. The Remote surface carries five capability-gated methods (`deviceTrust/issuePairing`, `deviceTrust/redeemPairing`, `deviceTrust/admitDevice`, `deviceTrust/listDevices`, `deviceTrust/revokeDevice`); capabilities declare `device-pair.issue.v1`, `device-pair.redeem.v1`, `device.admit.v1`, `device.list.v1`, and `device.revoke.v1`, so a Client refuses the operations an unprepared Host never declared.

A pairing code is a single-use secret with an expiry (`pairingTtlMs`, default five minutes): a second redemption fails with `device/pairing-invalid`, redemption after the expiry fails with `device/pairing-expired`, and a key that is not a base64 Ed25519 SPKI DER fails with `device/key-invalid`. Redemption registers the key's SHA-256 fingerprint; listing returns views without key material. Revocation keeps the grant listed with its revocation time — a later admission must treat it as refused.

Roles use the section 21 table names (`viewer`, `collaborator`, `controller`, `owner`) and hold exactly that table's permission columns (`view`, `prompt.send`, `question.respond`, `approval.respond`, `device.admin` via `DEVICE_ROLE_PERMISSIONS`); they never grant capability or permission beyond it. The Host default role comes from `defaultRole` (default `viewer`).

`admitDevice` verifies one signed admission: the signature is base64 Ed25519 over the UTF-8 bytes of `deviceId + "\n" + timestamp` made with the paired key, and the timestamp must sit inside the acceptance window (`admissionWindowMs`, default five minutes). Checks run cheapest-first — unknown device (`device/not-found`), revoked grant (`device/already-revoked`), stale or future timestamp (`device/admission-expired`), then signature (`device/key-invalid`) — and the Gateway resolves one admission per Remote event stream open, deriving the client's reply permissions from the returned role set.

## Model Experience

None, as the pairing ceremony and admission are Client and Host control state and register no prompt, tool, or session event.

#### KV Cache effect

No direct effect; device-trust operations do not alter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Grants live in the durable `device_trust` storage domain (single layout over the composed json backend): they survive Host restarts, an invalid stored record rejects the open, and a failed store write leaves a pairing code redeemable. Pending pairing codes stay process-local by design — a one-time expiring secret must not survive a restart.
- Admission is verified once per Remote event stream open; a revocation takes effect at the device's next reconnect, and per-request business-RPC signatures stay deferred. The acceptance window is replay hygiene, not a replay-proof nonce ledger.
- The `device/*` failure codes stay deliberately unclassified in the shared presentation vocabulary except `device/admission-expired` (authentication: re-sign and retry); the pairing ceremony codes carry no cross-Client semantics yet.
- No non-localhost admission opens here: the localhost line stays closed until the LAN TLS/pinning decision.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The audit decision recorded in `.agents/notes/implemented/architecture/2026-09-20-link-access-takeover-audit.md` owns the placement: the retired `packages/remote/link-*` and `device-trust` groups stay retired, and this seam is the single owner of device-facing access on the candidate gateway.

</details>

**Runtime invariant:** No companion is published. Grants are durable over the `device_trust` domain while pairing codes are process-local; roles name the section 21 permission columns, permission execution stays with the interaction-reply seam, and admission binds one signature verification to one stream open.
