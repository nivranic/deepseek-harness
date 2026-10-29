---
description: "The reference client for maintainers and companion implementers: pairing, SPKI-pinned TLS, signed unary RPC, and NDJSON Remote streams against the dsh link-access carrier."
kind: "package-reference"
---

# @deepseek-ai/dsh-link-client

English | [中文](README.zh.md)

## Summary

`dsh-link-client` is the executable reference contract for the [link-access carrier](../link-access/README.md): it pairs from a host's QR payload (verifying the certificate fingerprint during the TLS handshake, before any request byte is written), signs every request with the device's Ed25519 key, calls unary Remote endpoints through `/api`, and consumes Remote streams as NDJSON. Native companions (Swift, Kotlin) reimplement this state machine against the same wire vocabulary; their conformance suites check against this package's behavior.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```ts
import { LinkClient } from '@deepseek-ai/dsh-link-client'
import type { LinkPairingPayload } from '@deepseek-ai/dsh-link-access/protocol'

async function runCompanion(pairingPayload: LinkPairingPayload, sessionId: string): Promise<void> {
  const client = await LinkClient.pair(pairingPayload, { deviceName: 'iPhone' })
  await client.describe()
  await client.call('session/list', {})
  for await (const frame of client.openStream('session/follow', { address: { kind: 'session', sessionId } })) {
    void frame
  }
}
```

`pair` validates the payload's protocol version and expiry, then exchanges the one-time code for a device identity over the pinned connection. `call` throws `LinkError` with the carrier's or gateway's stable code; `openStream` ends quietly on caller abort and throws `LinkError` (`carrier-lost`) when the carrier drops mid-stream — the caller resubscribes, exactly like the browser carrier's stream restart.

### Keep the credentials

Persist the device id and signing key in platform secure storage (Keychain on Apple, Keystore-backed storage on Android). A lost key is recovered by pairing again; the old device record should be revoked.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Remote link access subsystem](../../../docs/subsystems/remote-link.md) — the wire vocabulary and trust model.
- [link-access carrier](../link-access/README.md) — the Host half this client speaks to.
- [remote/ package map](../README.md) — the group's packages.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No reconnect automation** — the client exposes per-request and per-stream primitives; reconnect policy (backoff, resubscribe, cursor resume) belongs to the companion's domain layer, mirroring the browser client's journal stream.
- **Node transport only** — the pinned agent is `node:https`; the Swift and Kotlin transports are companion-owned implementations of the same pinning rule.
- **No background push** — wake-on-approval needs the future relay stage; this client only works while the process runs.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
