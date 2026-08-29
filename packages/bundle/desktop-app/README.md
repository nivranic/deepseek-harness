---
description: "The dsh desktop surface: the Electron application window over the same agent, tools, and safety defaults as the web surface, carried by an in-process privileged-scheme bridge."
kind: "package-bundle"
---

# @deepseek-ai/dsh-desktop-app

English | [中文](README.zh.md)

## Summary

The desktop surface bundle: the Electron application window for dsh, ready for interactive chat with the agent, model and settings management, and session history, backed by the same model access, tools, and safety defaults as every other surface. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-base`](../base/README.md): it sets the coding persona, inserts the desktop host rows (workspace, the [`electron-ipc`](../../host/electron-ipc/README.md) carrier) and the browser plugin roster of the Web surface plus one desktop-only row ([ui-desktop](../../client/ui-desktop/README.md), the close-button preference), and mounts this package's `desktop-runtime` glue plugin (config `{surfaceContext}`). The surface differs from [`dsh-web-app`](../web-app/README.md) in exactly its carrier: no webserver row binds, no `webStartup` flags parse, and the Connection row stays mounted with an empty trust list for its registry service and browser half. The electron-ipc row provides `desktopGateway`, which the Electron app shell (`apps/desktop`) wires to its privileged scheme; the adaptive directory picker declares its loopback bind fact through `bindHost` because no server bind exists to read. No URL line, shell variable, or HTTP seat exists on this surface.

## Table of Contents

- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The bundle is a patch layer, not code: every row it inserts is an existing package's composition, and the only code this package owns is the `desktop-runtime` glue plugin. The storage stack and projection cache come from `dsh-base`; the desktop overlay's workspace and message-feedback rows consume that shared `storageDomain` service. The desktop carrier answers the renderer's privileged-scheme fetches with the shared `/api` chain, Gateway Remote streams over `/dsh-stream`, the client-plugin combo bundles, and the transport-bootstrap plus boot-manifest-injected dist; the Typert gateway row comes from the base layer and dispatches through the connection service's shared fetch handler.

### Composition map

| Concern | Row |
|---|---|
| Carrier (no socket) | `electron-ipc` → [`dsh-host-electron-ipc`](../../host/electron-ipc/README.md) |
| Browser transport | `connection` → [`dsh-client-connection`](../../client/connection/README.md), `trustedHosts: []` |
| Loopback posture without a server | `directory-picker` → [`dsh-host-directory-picker-auto`](../../host/directory-picker-auto/README.md), `bindHost: 127.0.0.1` |
| Desktop preference | `ui-desktop` → [`dsh-client-ui-desktop`](../../client/ui-desktop/README.md) |
| Glue plugin | `desktop-runtime` → this package, config `{surfaceContext}` |

</details>

-----

<a id="model-experience"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The desktop exe is built by `scripts/build-desktop-release.ts` from `apps/desktop`; the window title follows the live session by design.

</details>

## Model Experience

### Harness-source and desktop-surface context

#### What the model sees

When `surfaceContext` is true, the `harness:source` section identifies the on-disk Harness implementation without claiming it is the working directory, and the `app:desktop-surface` global section (order −98) orients the model to the desktop window: the "this page" referent, the absence of implicit DOM/route/screenshot context, the no-URL contract (the window loads the built frontend in-process; no HTTP server serves it), and the instruction not to start a `dsh web` server unless asked. When it is false, neither section is registered.

#### Token effect

One source line and one prompt paragraph per session; constant per process.

#### KV Cache effect

The prompt section sits near the system prompt's head and is stable for the life of the process, so it does not invalidate the cache across turns.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The frontend dist must be built** — the carrier's `require.resolve` of the dist fails loud at activation with a build hint; there is no source-serving fallback.
