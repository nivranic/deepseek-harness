---
description: "Host Remote owner for the local link-administration surface: carrier status with LAN endpoint and bind diagnostics, one-time pairing issuance, and trusted-device listing and revocation."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-link-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-link-controller` backs the generated `ctx.remote.link` namespace: the cross-device settings page calls `status` for the live carrier facts (listening state, LAN endpoint, certificate fingerprint, bind diagnostics, device-facing name, approval switch, trusted-device count), `createPairing` for the one-time QR payload, and `devices`/`revokeDevice` for the trusted-device manager. Every method dispatches only through local carriers — the remote allowlist carries none of these endpoints, so a paired device can never mint pairings or revoke its peers.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the controller in any composition that also mounts the link carrier; a composition without one keeps every call failing with `link-unavailable` instead of failing at load.

```yaml
- name: '@deepseek-ai/dsh-device-trust'
- name: '@deepseek-ai/dsh-link-access'
- name: '@deepseek-ai/dsh-api-link-controller'
```

### Observable behavior

`status` merges the carrier status with the live name, approval switch, and device count. `createPairing` re-serves the carrier's QR payload, mapping a stopped or failed carrier to `link-disabled`. Device rows never carry the public key; revocation by id returns the updated row or `undefined` for an unknown id, and an empty id fails with `bad-request`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

- **Projection only.** The controller owns no state: carrier facts come from `ctx.linkAccess`, device rows from the trust store through the carrier's service face, and the wire types drop the public key at the projection boundary.
- **Optional carrier.** The carrier is read lazily per call, so the controller mounts in compositions that enable remote access later through settings.
- **Local-only surface.** The remote allowlist lists none of the `link` endpoints; the authorization guard refuses them on the link carrier before dispatch.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Typert Remote service, failure mapping, device projection |
| [`src/types.ts`](src/types.ts) | Browser-safe wire values and the failure vocabulary |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant: projection only) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Remote link access subsystem](../../../docs/subsystems/remote-link.md) — the access layer's authoritative contract.
- [link-access carrier](../../remote/link-access/README.md) — the service face this owner projects.
- [api/ package map](../README.md) — the Remote layer's packages and their repository position.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No pending-pairing list yet** — issued codes are one-time and unlisted; a cancellation surface arrives with the pairing UX that needs it.
- **No role editing yet** — the role is granted at pairing and shown read-only; changing it arrives with device-management policy.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
