---
description: "Opt-in encrypted native access with pinned Host identity and signed device admission, separate from local browser authentication."
kind: "package-reference"
---
# Native Remote Connection

English | [中文](README.zh.md)

## Summary

Native devices can reach a Host over a separate TLS listener while local Web retains its cookie and Origin checks. Devices pin the Host certificate's SubjectPublicKeyInfo fingerprint and sign each operation with a paired key. The listener is opt-in and requires explicit interface and resource limits. It serves Gateway RPC and streams without browser assets or local exact Fetch routes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount `@deepseek-ai/dsh-api-native-remote` in a named `dsh` profile's composition beside credentials, Device Trust, and Gateway. The package is a plugin, not a bundle or standalone launcher. No shipped profile enables the listener by default. Declare every listener limit in configuration; the [configuration catalog](../../../docs/config-catalog.md) lists accepted fields.

The local operator reads `ctx.nativeRemote.describe()` for the actual port and lowercase SHA-256 SPKI fingerprint. An all-interface bind address is not a destination: the operator supplies the reachable address separately. Pairing distributes that pin and a one-time Device Trust code out of band. The native client must check the certificate pin before sending HTTP bytes; a matching certificate hostname or successful TLS handshake alone does not establish the Host identity.

RPC uses Connection's `client-request` envelope at `/api/<endpoint>`. `deviceTrust/redeemPairing` is the sole unsigned operation; every other call carries versioned Gateway metadata with a fresh signed device admission. The shared `/api/remote.mux` WebSocket requires a signed admission for each logical stream, including `$events`. Cookies confer no authority. Requests carrying Origin or Fetch Metadata headers are rejected, and the source does not implement CORS.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The credentials grant `api-native-remote/tls-identity` stores a self-signed P-256 certificate and PKCS#8 private key through the composed provider. Concurrent creation is serialized by its record writer. Startup renews a certificate near expiry using the same private key, preserving the paired SPKI; malformed or mismatched material fails startup instead of silently replacing identity. Changing the key requires clients to confirm a new pin.

Connection owns RPC envelope parsing and bounded HTTP buffering. Gateway's device adapter owns admission, capability permissions, reply ownership, and stream revocation. The TLS listener owns sockets and their teardown; the shared mux applies per-message and per-connection stream limits. The [architecture decision](../../../.agents/notes/implemented/architecture/2026-09-25-native-remote-connection-source.md) owns these responsibilities and certificate-library constraints.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Device Trust](../device-trust/README.md) — one-time pairing, signed admissions, and revocation.
- [Gateway](../gateway/README.md) — Remote framing and permission dispatch.
- [Connection](../../client/connection/README.md) — RPC codec and local browser authentication.

-----

<a id="model-experience"></a>
## Model Experience

None, as this carrier registers no prompt, tool, or Session event and transports existing Gateway operations.

#### KV Cache effect

No direct effect; the invoked capabilities own model-visible changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The package provides the Host transport, with these adoption limits:

- Operator pairing presentation and native client adoption are separate consumers. The legacy Android fixture protocol is not this Gateway protocol.
- Certificate renewal runs at listener startup, not continuously while the process stays running. Restart the listener before certificate expiry.
- The source does not serve local download/upload Fetch routes, browser assets, discovery, or relay access.
- No runtime invariant companion is published: admission and key consistency are enforced at their owning operations, with no independent projection maintained here.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
