---
description: "Paired-device trust store for hosts and maintainers securing native remote access: host identity, one-time pairing codes, and device records with role, resource grants, and revocation."
kind: "package-reference"
---

# @deepseek-ai/dsh-device-trust

English | [中文](README.zh.md)

## Summary

`dsh-device-trust` is the Host's durable trust store for native remote access: one SQLite database owns a stable host identity, one-time pairing codes (stored only as SHA-256 digests), and the device records the [link carrier](../link-access/README.md) authorizes requests against. Every record carries the device's Ed25519 public key — the Host never stores device secrets — plus its role, Session and Workspace grants, timestamps, and revocation state. Device credentials never enter LLM-provider credential storage.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the store wherever the link carrier runs; it registers `ctx.deviceTrust` and is inert until something pairs a device.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `path` | `<dshHome>/device-trust.sqlite` | SQLite database file, or `:memory:` (tests) |
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Harness home used when `path` is omitted |

```yaml
- name: '@deepseek-ai/dsh-device-trust'
  config:
    path: /var/lib/dsh/device-trust.sqlite
```

### Observable behavior

`createPairing(ttlSeconds)` issues a 256-bit one-time code. `consumePairing` uses one `BEGIN IMMEDIATE` transaction to burn that code and persist the device with either `all` or explicit Session and Workspace grant rows, so another consumer fails whether the calls race or follow one another and no device can exist without its intended grants. An expired code burns on first use. The first `revoke` keeps the record for audit and emits `device-trust/revoked` after commit so active carriers close the device regardless of which Host component initiated revocation; `touch` records `lastSeenAt` only for trusted devices. A database stamped with another layout version rejects outright — no migration, pre-release stance.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

- **Codes as digests.** The database stores `sha256(code)`; a database read cannot mint credentials, and code lookup on a 256-bit random value needs no timing-safe comparison.
- **Transactional pairing consume.** `BEGIN IMMEDIATE` serializes consumers before reading the code; deleting the code, inserting the device, and inserting its grant rows commit together on the Host's single SQLite connection.
- **Keys verified at the boundary.** Pairing rejects any public key that is not a parseable DER SubjectPublicKeyInfo, so every stored key is usable for request verification.
- **Host identity is meta.** The stable `host_id` lives in the `meta` table and is created lazily on first read, surviving restarts and database remounts.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service, config, pairing/device/identity primitives |
| [`src/schema.ts`](src/schema.ts) | Open sequence, layout version, trust tables |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant: versions and pairing atomicity are open-time and unit checks) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Remote link access subsystem](../../../docs/subsystems/remote-link.md) — the trust model's authoritative contract.
- [link-access carrier](../link-access/README.md) — the consumer that authenticates against these records.
- [remote/ package map](../README.md) — the group's packages and their repository position.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Single-connection database** — the store assumes the Host process is its only writer; a second process writing the same file is out of scope for this phase.
- **No pairing-code cancellation surface yet** — the Windows pairing UI that lists and cancels pending codes arrives with the Phase 1 host UI; the store already burns codes atomically.
- **`administrator` grants nothing yet** — the role round-trips through the store and reserves future host administration; only `observer` and `controller` can be granted at pairing.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
