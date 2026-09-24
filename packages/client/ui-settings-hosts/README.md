---
description: "Saved-Host roster section in Web Settings for the dsh web client: local roster rows with a switch action into the section 28 seam, current selection marking, page-Host return, and cross-session selection persistence."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-hosts

English | [中文](README.zh.md)

## Summary

The **Hosts** section shows every Host this page has reached, straight from the local saved-Host roster: display name, platform, origin, and last-connected time. One click switches the connection to a saved Host through the section 28 seam — unary calls and the stream carrier both retarget — and the switch persists across page reloads; returning to the page Host clears the selection at any time. The selected row is marked, its switch action hides, and in-page rows carry no origin to target, so they never offer a switch.

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

The section is always available: the roster is local page state, so it registers without any Host capability and survives connection replacement with its rows intact.

### Switching Hosts

Open the **Hosts** section in Settings. Each row names the Host, tags its platform when known, and shows the origin together with the last-connected time. **Switch** on one row routes through `switchToSavedHost` — the row origin flows into `connection.retarget` and the hostId persists under `dsh-selected-host.v1`, so the next reload applies the selection before any loop runs. The switched row gains the Current tag and loses its switch action; **Back to the page Host** clears the selection and the persisted id together. **Forget** removes one roster row; the connection never targets a forgotten Host.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

One React section plus its registration; all data is local.

- **The face** — `HostsSettingsSectionInjected` exposes live readers (`rows`, `selectedOrigin`) rather than one fetched snapshot: the section re-renders on roster notifications, its own actions, and the refresh control. Switching composes the shared [`switchToSavedHost`](../connection/README.md) orchestration and writes the persistence on success only; an unknown id never touches the connection or the storage.
- **Persistence** — the selection rides `dsh-selected-host.v1` through `browserSelectedHostPersistence`; the Connection plugin applies a persisted id at boot before any carrier or loop exists, so applying is a pure assignment. A missing or in-process row keeps the page Host.

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-client-connection`](../connection/README.md) owns the roster, the retarget seam, and the boot application of the persisted selection.
- The [Gateway stream carrier](../../api/gateway/README.md) builds every physical WebSocket URL from the same selection.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side Host-roster projection that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The selection reader is polled, not observed: a switch made outside this section appears after the next roster notification or refresh, not immediately.
- A cross-origin Host additionally needs its own browser-trust pairing before calls succeed; switching only redirects the carriers.
- No roster editing beyond Forget; sorting stays most-recent-first.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The section is the section 28 switching surface; the seam and carrier adoption live in `dsh-client-connection` and `dsh-api-gateway` and carry their own records.

</details>
