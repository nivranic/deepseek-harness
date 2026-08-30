---
description: "Settings bridge for the remote link carrier: owns the `remote` namespace (enable cross-device access, allow remote approval, device name) and applies every commit live, for compositions that drive pairing from a settings page."
kind: "package-reference"
---

# @deepseek-ai/dsh-link-settings

English | [中文](README.zh.md)

## Summary

`dsh-link-settings` is the bridge between the user-settings document and the [link carrier](../link-access/README.md): it registers the `remote` namespace — `enabled`, `allowRemoteApproval`, `deviceName` — and pushes every commit live into `ctx.linkAccess`, flipping the TLS listener, the independent approval switch, and the advertised host name. A composition that mounts this bridge makes the namespace the owner of those three fields; headless deployments keep configuring the carrier plugin itself.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the bridge wherever a settings page drives the carrier; it requires the settings service and `ctx.linkAccess`, and is inert until a commit happens.

```yaml
- name: '@deepseek-ai/dsh-device-trust'
- name: '@deepseek-ai/dsh-link-access'
  config:
    enabled: false
- name: '@deepseek-ai/dsh-link-settings'
```

### Observable behavior

The namespace defaults to remote access off, remote approval off, and the OS hostname. A commit applies the name and approval switch before the listener, so a newly enabled carrier advertises the committed identity. A carrier bind failure (for example a taken port) is contained: the namespace keeps the user's intent and the carrier reports the failure through its status. An empty `deviceName` resets to the OS hostname.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

- **The namespace is the owner.** The bridge applies the resolved section once on mount and follows every commit through the registration scope's watcher; disposing the bridge unregisters the namespace, so later commits fail loud instead of silently losing effect.
- **Ordering contract.** `setDeviceName` and `setAllowRemoteApproval` are synchronous assignments ahead of the serialized `setCarrierEnabled` queue, so the listener never advertises a stale identity.
- **No runtime invariant.** The bridge is a pure observer: schema validation rejects bad sections at commit time and the carrier relationship is last-writer-wins by design.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Bridge service, namespace schema, live application |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant: pure observer) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Remote link access subsystem](../../../docs/subsystems/remote-link.md) — the access layer's authoritative contract.
- [link-access carrier](../link-access/README.md) — the runtime-switch surface this bridge drives.
- [remote/ package map](../README.md) — the group's packages and their repository position.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Single bridge per composition** — the settings service rejects a duplicate namespace registration, so two mounts of this plugin fail loud rather than racing.
- **No per-field authorization** — any writer the settings provider accepts may flip the namespace; field-level permissions arrive with the permission-preset coverage for remote settings.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
