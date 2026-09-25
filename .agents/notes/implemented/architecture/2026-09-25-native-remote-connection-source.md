# Agent Note: Native devices use a separate TLS source on the existing Gateway

Status: implemented

English | [中文](2026-09-25-native-remote-connection-source.zh.md)

## Problem

Local Web cookies and Host/Origin checks do not authenticate a native device. Reusing that listener by relaxing its browser defenses would grant network reachability the authority of a local browser. A separate Link dispatcher would duplicate the Gateway's permissions and interaction ownership. The [takeover decision](2026-09-20-link-access-takeover-audit.md) therefore requires an encrypted Connection source before native access can open.

## Decision

[Native Remote](../../../../packages/api/native-remote/README.md) is an opt-in Host plugin with explicit interface and resource limits. It serves only Connection RPC envelopes and the Gateway mux over TLS 1.2 or newer. It rejects browser Origin and Fetch Metadata headers and has no browser assets, Cookie authority, CORS, or local exact Fetch routes. Existing local Web authentication remains owned by Connection.

Gateway owns the device adapter. Every unary operation and logical stream requires a fresh device proof, except the existing one-time pairing redemption. Capability permissions and device-owned reply checks stay in the dispatcher. A physical mux connection grants no business authority. Device business streams subscribe to revocation before awaiting admission and retain that subscription through iterator teardown, so a delayed admission cannot register a revoked stream and buffered values cannot outlive the grant.

The credentials provider owns the `api-native-remote/tls-identity` grant. The source generates a self-signed P-256 certificate with the maintained `@peculiar/x509` library, persists it before listening, and renews it at startup with the same private key. Native clients confirm the Host by an out-of-band lowercase SHA-256 SPKI fingerprint before sending HTTP bytes. This keeps identity independent of changing IP addresses and certificate renewal. Invalid or mismatched stored material rejects startup instead of silently changing a paired identity.

The library's parser and ASN.1 declarations must resolve the same schema registry. A version-scoped pnpm override makes `@peculiar/x509@2.1.0` use `@peculiar/asn1-schema@2.9.5`, matching its declarations; reusing the existing 2.9.4 parser loses `SubjectPublicKeyInfo` metadata. Reassess this override with a library upgrade. The compiled dependency works under plain Node and the repository's ESM-only TypeScript launcher without enabling a CommonJS transform hook.

The Settings pairing consumer reads authenticated listener metadata and uses the existing Device Trust issuer. It validates the operator-entered HTTPS origin against the actual listener port before issuance and carries the selected role into the grant. The versioned QR payload contains public Host identity and a short-lived single-use code, never a private key or durable bearer token. Component lifetime and connection-generation checks prevent stale issuance from appearing after close or Host replacement; expiry and input edits hide the payload. Browser storage and diagnostics do not own the code. Native metadata requires device.admin; advertised capability presence alone grants no authority.

Settings renders its modal through a document-body portal, independent of the sidebar that owns its trigger. This prevents phone drawer visibility and transforms from hiding pairing controls. Phone-width navigation uses a horizontal scroll row, while the content retains vertical scrolling for QR details and copy controls. A real browser resize and an ancestor-visibility component regression exercise this ownership.

The [Kotlin core consumer](../../../../apps/android/README.md) uses this source through the existing `WireDriving` abstraction. It pins TLS before HTTP bytes, negotiates API 2 independently of the Session writer, and places device proofs beside ordinary arguments but inside the reserved event-stream arguments. Host identity, granted role, and key fingerprint must match before credentials are saved; a failed post-redemption check preserves the prior local identity but can leave a Host grant requiring operator revocation. A credential-format marker prevents interpreting legacy Link identities as current grants. One mux owns bounded logical-stream queues and closes them with its client; reconnect creates new proofs and stream generations. The actual Android shell remains a separate adoption step.

## Alternatives considered

- **Allow Mobile through local Web cookies or relaxed Origin checks.** Rejected: that changes local browser authority and does not authenticate a device key.
- **Restore the retired Link server.** Rejected: the existing Gateway already owns argument validation, permissions, streams, and replies.
- **Generate ASN.1 by hand or require an OpenSSL executable.** Rejected: a maintained JavaScript library provides certificate generation across the supported Node hosts without a second platform installation requirement.
- **Use a public-CA hostname as the sole Host identity.** Rejected for local native pairing: deployment addresses can change, while the established native pin model identifies the Host's key. TLS still encrypts traffic; the pin authenticates its peer.

## Consequences

The Host source can be mounted through a normal profile composition without enabling a network listener in shipped defaults. Tests cover persistent and concurrent identity creation, renewal without key rotation, invalid stored identity, wrong pins, unsigned requests, replay, insufficient permission, browser-header rejection, request bounds, and teardown. Gateway tests cover revocation during admission and during business-stream iteration. Android shell and Swift client adoption, Relay/discovery integration, and physical-device acceptance remain separate work; legacy fixture success proves none of them. Certificate renewal requires listener restart before expiry.
