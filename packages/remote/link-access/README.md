---
description: "The native remote access carrier for hosts enabling cross-device access: TLS and Ed25519 device authentication, fixed endpoint resource scopes, and one-time pairing over the existing Typert gateway surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-link-access

English | [中文](README.zh.md)

## Summary

`dsh-link-access` is the Native Remote Access carrier: a TLS listener that authenticates paired devices (timestamp-windowed Ed25519 request signatures against the [device trust store](../device-trust/README.md)), enforces a role-gated endpoint allowlist plus fixed Session and Workspace resource scopes, and dispatches onto the existing Typert gateway surface — unary RPC through the Connection shared `/api` handler and Remote streams through `typertGateway.wireStream` as NDJSON, the same adapter pair the desktop carrier uses. Device Trust owns persisted grants; Session, Workspace, Artifact, Attachment, and Gateway services retain business and pending-interaction state. Remote access and remote approval ship disabled by default.

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
| `endpoints` | the default remote surface | The complete allowlist, replacing the default; every row states its kind (`unary`/`stream`), minimum role, and resource scope |
| `allowRemoteApproval` | `false` | Independent switch for answering remote approvals and questions; `Can prompt` never implies this |
| `pairingRole` | `controller` | Role granted to devices at pairing |
| `pairingAccess` | `{ sessions: all, workspaces: all }` | Session and Workspace grants persisted for each newly paired device; use explicit identity arrays to narrow a deployment |
| `pairingTtlSeconds` | `300` | Pairing code lifetime |
| `clockSkewSeconds` | `300` | Accepted request-timestamp skew |
| `maxRequestBodyBytes` | 300 MiB | Carrier cap for unary RPC bodies |

### Observable behavior

`ctx.linkAccess.createPairing()` returns the QR payload (host id and name, endpoint, certificate SPKI fingerprint, one-time code, expiry). Every device request carries an identity, a timestamp, and an Ed25519 signature over method, path, and body digest; requests fail 401 on unknown, revoked, stale, or mis-signed devices and 403 on endpoints outside the allowlist, below the device's role, outside its persisted grants, or — for interaction answers — while the approval switch is off. Host-wide Session and Workspace collections are projected before socket output. An interaction answer additionally requires the device's Host-issued Client generation, a delivered pending event, and the event's Session grant; disabling approval, revoking the device, or stopping the carrier delegates delivered interactions back to the Host waterfall. The certificate is generated once (ECDSA P-256) and persisted under `<dshHome>/link-access/`, so paired devices keep working across restarts. `link/describe` reports independent Link protocol, contract, and Session format versions so a client can diagnose each compatibility axis without treating application release versions as wire versions.

### Default remote surface

Read-only Session and Workspace observation (`session/list|search|page|modelCatalog|attachment|artifact|follow|control`, `workspace/follow`, `workspaceFiles/list|read`, `subagents/list`, `fileReferences/list`, `$events`) is available within each device's grants. Controllers may run Session actions (`prompt`, `cancel`, `updateQueue`, `rename`, `fork`, `selectModel`) within those grants and submit `session/handoff`, whose snapshot creates a new Full Session and therefore has no existing Session identity to check. `$events/result` answers only interactions that the same controller generation actually received and remains behind the independent approval switch. Settings mutation, credentials, plugin administration, and direct Session creation are not remote until a deployment lists them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

- **Same wire, different trust fence.** Unary calls build a WHATWG `Request` and hand it to the Connection shared fetch handler; streams pump `wireStream.open` as NDJSON frames (`{"k":"v"}` per item, `{"k":"e"}` on failure). The browser cookie fence never applies; the device fence owns the route.
- **Pin-verified TLS.** The certificate is assembled here as a fixed X.509 v3 template (no extensions, ecdsa-with-SHA256) over a node-generated P-256 key; devices pin the SPKI SHA-256 from the QR payload before writing any request byte, so certificate chains are irrelevant.
- **Fixed resource extraction.** Product endpoint scopes are resolved at load and cannot be overridden. The carrier checks top-level Session and Workspace grants before dispatch, filters collection and event outputs before socket writes, and leaves Artifact, Attachment, and Workspace path membership to their existing owners after the top-level grant passes. Custom endpoints must declare `unscoped` explicitly.
- **Gateway-owned interactions.** `$events/result` is accepted only for the authenticated device's active Host-issued Client generation and a delivery the Gateway still reports pending. The carrier records no second approval registry; filtered, disabled, revoked, and stopped generations delegate with the Gateway's existing `next` outcome.
- **Teardown is honest.** Streams surface a mid-flight carrier loss as an error (`carrier-lost` in the reference client), never as a clean end, so callers resubscribe instead of treating silence as completion.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service, config, TLS server, routes, authentication and dispatch |
| [`src/authorization.ts`](src/authorization.ts) | Request scope checks and pre-socket unary, stream, and Remote Event projection |
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
- **No grant administration UI yet** — `pairingAccess` fixes grants for newly paired devices; changing an existing device's grants currently means revoking and pairing it again.
- **Host describe is intentionally declarative** — the description reports identity, three independent wire/data version axes, runtime class, and capability literals; it does not negotiate application release channels or silently downgrade an unsupported contract.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
