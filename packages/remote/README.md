---
description: "Package map for native remote access: the paired-device trust store, the TLS link carrier with its role-gated remote allowlist, and the reference client native companions are checked against."
kind: "package-group"
---

# remote/ — native remote access

English | [中文](README.zh.md)

## Summary

The `remote/` group owns the secure access layer that lets native companion clients reach one Harness host over the network — no second business gateway. `device-trust` persists the host identity, one-time pairing codes, and device records. `link-access` binds a TLS listener that authenticates devices by Ed25519 request signatures, enforces a role-gated endpoint allowlist with an independent remote-approval switch, and dispatches onto the existing Typert gateway surface. `link-client` is the executable reference contract native companions reimplement. `link-contracts` pins the wire vocabulary as fixtures plus the manifest/Swift/Kotlin generator. `link-settings` owns the `remote` settings namespace and applies every commit live to the carrier.

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`device-trust/`](device-trust/README.md) | Paired-device trust store: host identity, one-time pairing codes, device records with role and revocation | `ctx.deviceTrust` |
| [`link-access/`](link-access/README.md) | TLS carrier: device authentication, remote endpoint allowlist, pairing ingress over the existing gateway | `ctx.linkAccess` |
| [`link-client/`](link-client/README.md) | Reference client for the carrier: SPKI pinning, pairing, signed RPC, NDJSON streams | plain library |
| [`link-settings/`](link-settings/README.md) | Settings bridge: owns the `remote` namespace and applies enable/approval/name commits live to the carrier | `ctx.linkSettings` |
| [`link-contracts/`](link-contracts/README.md) | Executable wire contract: schema-pinned fixtures and the manifest/Swift/Kotlin generator | plain library |

## Position

The carrier is a new access layer in front of the existing gateway, not a parallel one: sessions, approvals, and streams keep their single ownership, and revoking a device in the trust store cuts its authorization on the next request. Remote access ships disabled by default in the `dsh-web-app` bundle; a deployment enables it with a patch overlay. The subsystem reference for both services is [remote link access](../../docs/subsystems/remote-link.md).
