---
description: "The native remote access carrier for hosts enabling cross-device access: a TLS listener with Ed25519 device authentication, a role-gated remote endpoint allowlist, and one-time pairing over the existing Typert gateway surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-link-access

English | [中文](README.zh.md)

## Summary

`dsh-link-access` is the Native Remote Access carrier: a TLS listener that authenticates paired devices (timestamp-windowed Ed25519 request signatures against the [device trust store](../device-trust/README.md)), enforces a role-gated remote endpoint allowlist with an independent remote-approval switch, and dispatches onto the existing Typert gateway surface — unary RPC through the Connection shared `/api` handler and Remote streams through `typertGateway.wireStream` as NDJSON, the same adapter pair the desktop carrier uses. The carrier owns no session, workspace, or approval state: revoking a device cuts its authorization on the next request. Remote access ships disabled by default.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the carrier in a composition that already provides Connection, the Typert gateway, and Device Trust (the `dsh-web-app` bundle ships it disabled). Enable it with a patch overlay:

```yaml
- id: link-access
  disabled: false
  config:
    host: 0.0.0.0
    port: 3090
    allowRemoteApproval: true
```

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Bind the TLS carrier; remote access stays off until explicitly enabled |
| `host` | `127.0.0.1` | Bind address; `0.0.0.0` selects every interface and derives the pairing endpoint from the first non-internal IPv4 address |
| `port` | `0` | Bind port; `0` takes an OS-assigned port |
| `endpoints` | the default remote surface | The complete allowlist, replacing the default; every row states its kind (`unary`/`stream`) and minimum role |
| `allowRemoteApproval` | `false` | Independent switch for answering remote approvals and questions; `Can prompt` never implies this |
| `pairingRole` | `controller` | Role granted to devices at pairing |
| `pairingTtlSeconds` | `300` | Pairing code lifetime |
| `clockSkewSeconds` | `300` | Accepted request-timestamp skew |
| `maxRequestBodyBytes` | 300 MiB | Carrier cap for unary RPC bodies |

### Observable behavior

`ctx.linkAccess.createPairing()` returns the QR payload (host id and name, endpoint, certificate SPKI fingerprint, one-time code, expiry). Every device request carries an identity, a timestamp, and an Ed25519 signature over method, path, and body digest; requests fail 401 on unknown, revoked, stale, or mis-signed devices and 403 on endpoints outside the allowlist, below the device's role, or — for interaction answers — while the approval switch is off. The certificate is generated once (ECDSA P-256) and persisted under `<dshHome>/link-access/`, so paired devices keep working across restarts.

### Default remote surface

Read-only session and workspace observation (`session/list|search|page|modelCatalog|attachment|follow|control`, `workspace/follow`, `workspaceFiles/list|read`, `fileReferences/list`, `$events`) for every device; session control (`prompt`, `cancel`, `updateQueue`, `rename`, `fork`, `selectModel`) for controllers; `$events/result` — answering pending approvals and questions — for controllers behind the approval switch. Everything else (settings mutation, credentials, plugin administration, session creation) is not remote until a deployment lists it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

- **Same wire, different trust fence.** Unary calls build a WHATWG `Request` and hand it to the Connection shared fetch handler; streams pump `wireStream.open` as NDJSON frames (`{"k":"v"}` per item, `{"k":"e"}` on failure). The browser cookie fence never applies; the device fence owns the route.
- **Pin-verified TLS.** The certificate is assembled here as a fixed X.509 v3 template (no extensions, ecdsa-with-SHA256) over a node-generated P-256 key; devices pin the SPKI SHA-256 from the QR payload before writing any request byte, so certificate chains are irrelevant.
- **Allowlist as data.** The endpoint table is resolved at load; the interaction-answer endpoint (`$events/result`) is marked protocol-defined so the approval switch applies regardless of which allowlist lists it.
- **Teardown is honest.** Streams surface a mid-flight carrier loss as an error (`carrier-lost` in the reference client), never as a clean end, so callers resubscribe instead of treating silence as completion.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service, config, TLS server, routes, authentication and authorization |
| [`src/protocol.ts`](src/protocol.ts) | Wire vocabulary: routes, headers, allowlist contract, signing input, payloads |
| [`src/tls.ts`](src/tls.ts) | Certificate generation/persistence and SPKI fingerprinting |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant: rejections are per-request behaviors under carrier test) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Remote link access subsystem](../../../docs/subsystems/remote-link.md) — the trust and authorization contract.
- [Reference client](../link-client/README.md) — the executable contract native companions are checked against.
- [Device trust store](../device-trust/README.md) — the records this carrier authorizes against.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No LAN discovery yet** — the pairing payload carries an explicit endpoint; mDNS advertisement (`_dsh-link._tcp`) is deferred with the Phase 1 host UI.
- **No relay, no NAT traversal** — V1 reaches devices on the LAN or a user-managed private network; public-internet continuation is a separate future project.
- **Timestamp window only** — replay protection is the clock-skew window; per-nonce tracking is deliberately absent until a benchmark proves it necessary.
- **Host describe is minimal** — the description reports identity, versions, runtime class, and capability literals; richer capability negotiation arrives with the first native companion.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
