---
description: "Read stable Host identity, independent product/API/Session versions, and the live Remote capability set through authenticated discovery."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-host-description

English | [中文](README.zh.md)

## Summary

Use `host.describe` to identify a connected Harness Host and read its release, API generation, Session writer generation, and supported operation sets. The Host keeps one random identity across launches sharing its configured identity file. Web and Desktop expose the same Remote method through their existing authenticated carriers. Discovery does not modify Session data or grant permission to invoke an operation.

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

The Web bundle mounts this plugin; Desktop uses the same composition with its pipe carrier. Client code imports the API Remotes facade and calls `ctx.remote.host.describe()`, receiving the standard `RemoteResult<HostDescriptor>`.

### Configuration

```yaml
- name: '@deepseek-ai/dsh-api-host-description'
  config:
    identityFile: !!js ctx.dshHomePath('.host-id')
    displayName: DeepSeek Harness
    transports: [http, websocket]
```

| Field | Default | Meaning |
|---|---|---|
| `identityFile` | required | Absolute path to the persistent UUID file |
| `displayName` | `DeepSeek Harness` | Operator-visible label, independent of identity |
| `transports` | required | Nonempty carrier list: `http`, `websocket`, or `desktop-pipe` |
| `identityLockWaitMs` | `2000` | Maximum wait for a concurrent identity writer, in milliseconds |

The [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-api-host-description) owns accepted configuration fields. Desktop configures only `desktop-pipe`; the application must declare the carriers it actually mounts.

`host.describe` returns the protocol-1 discovery representation and advertises `supportedApiProtocolVersions`. `host.negotiate` selects the highest shared version from distinct positive integer offers and returns a descriptor with that selected `apiProtocolVersion`. An empty, duplicate, or malformed offer fails; no shared version returns `gateway/protocol-unsupported`. The Client must retain the same `hostId` across both responses. Negotiation does not change Host state or bind authorization to a protocol number.

### Identity and failures

The identity file contains one lowercase UUID v4 followed by a newline. Concurrent first launches share the persisted identity. An invalid or unreadable file rejects startup and remains unchanged; restore its saved contents before starting the Host. A failed write never falls back to a temporary identity. The id is scoped to this file, not to a machine, user account, or telemetry identity, and is not an authentication credential.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin loads identity and installed release metadata before publishing the `host` Remote namespace. Identity creation reuses the shared cross-process file lock and atomic writer. Each description reads explicit capability declarations from live Gateway bindings, so service disposal and strict-definition withdrawal change subsequent results without another registry.

`productVersion` comes from the installed package release, `apiProtocolVersion` from the selected Gateway request codec, and `sessionFormatVersion` from the Session writer. These values have separate owners. Platform and architecture come from the Host's Node process, and `serverTime` is its UTC clock in milliseconds. The full [descriptor and capability types](../../../docs/subsystems/typert.md#host-discovery) are checked against source.

No runtime invariant companion is published: this service reads authoritative binding and file facts directly and owns no independent event projection to compare with them.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [API Remotes](../remotes/README.md) — the shared Client facade.
- [API Gateway](../gateway/README.md) — invocation and capability availability.
- [Host discovery decision](../../../.agents/notes/implemented/architecture/2026-09-16-host-description-and-capabilities.md) — identity, declarations, and verification limits.

<a id="model-experience"></a>
## Model Experience

None, as this package returns Host metadata to Clients and adds no model input.

#### KV Cache effect

Discovery does not add or modify model request tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Discovery and negotiation report protocol availability; neither grants per-device permissions.
- The [Client assembly](../remotes/README.md) negotiates protocols 2 and 1 before business calls. Capability-based UI admission and a dedicated upgrade interface remain incomplete.
- This package describes the full Harness runtime. It does not provide a Lite runtime or migrate historical Host identities.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
