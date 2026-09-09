---
description: "Desktop carrier for the browser surface: the in-process privileged-scheme fetch target answering the shared /api chain, Gateway Remote streams, client plugin bundles, and the boot-manifest-injected frontend dist; binds no socket."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-electron-ipc

English | [中文](README.zh.md)

## Summary

The desktop carrier for the browser surface: a function plugin (injects `clientModules`, `connection`, `typertGateway`) that provides `desktopGateway`, the in-process fetch target the Electron app shell wires to its privileged `dsh:` scheme — the IPC bridge the [webserver documentation](../webserver/README.md) reserves for the desktop shape. This package binds no socket. `handle(request)` dispatches in four branches: `/api` rides the Connection shared-channel chain (the Typert gateway registers its interceptor claims on the connection service itself, with no HTTP trust fence — every request arrives from this process's own renderer, never the network), `/dsh-stream/<endpoint>` carries one Gateway Remote stream as newline-delimited JSON frames through the gateway's `wireStream` adapter, `/plugins` serves the client-module combo bundles from the module registry's fetch-shaped cache, and every other path serves the built frontend dist — traversal outside the dist root is 403, any miss falls back to index.html with 200 (SPA routing), unknown extensions ship as octet-stream, and every index response first carries a transport bootstrap (a plain inline script installing `window.__DSH_TRANSPORT__` with `ownsHost: true` and the NDJSON stream opener) ahead of the injected boot manifest. The dist location is assembly knowledge resolved through `@deepseek-ai/dsh-web-frontend`'s exports, never configured.

## Table of Contents

- [Summary](#summary)
- [Diagnostics export](#diagnostics-export)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="diagnostics-export"></a>
## Diagnostics export

The Windows Settings action saves available diagnostics through the generated `desktopSupport/export` operation and the application's native save dialog. The collector selects application version, build number and channel, process-local Session event counts, and the Link owner's advertised listener/protocol observations. It never serializes Session payloads, device identities, connection addresses or raw error output.

The [native application](../../../apps/desktop/src/support.ts) registers one save callback. The service admits one export at a time; unregistering revokes admission, cancels pending work and waits for it to finish. The [scanner implementation](src/support-export.ts) verifies bundled resources, detects and redacts a synthetic credential, then scans the final immutable JSON through managed subprocess stdin. Only admitted bytes reach the native dialog; saving commits by atomic rename. Cancellation before commit leaves the destination unchanged, while a committed rename reports saved. Scanner and cleanup failures refuse completion without exposing native error text.

The [configuration catalog](../../../docs/config-catalog.md) owns document/report byte limits and scanner/shutdown durations. Export results distinguish saved byte identity, cancellation, a concurrent export and fixed failure categories. The default Link allowlist refuses this local operation. The [support-export decision](../../../.agents/notes/implemented/architecture/2026-09-08-local-runtime-support-export.md) owns privacy and lifecycle rationale.

An omitted `config` block resolves every limit's default before plugin activation. An explicit invalid value remains a load failure; the gateway's `apply` function receives only resolved configuration.

Scanner resource reads compare full-width file and device identifiers before and after opening, including on systems without `O_NOFOLLOW`. A changed identifier or size rejects the resource before scanner execution; byte allocation follows the checked resource limit.

## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The transport bootstrap is injected as the first index-injection row ahead of every boot-manifest row; the page-global carrier hooks it installs are the same seam a worker shell owns.

</details>

## Model Experience

None, as the package serves renderer assets and dispatches renderer fetches; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The frontend dist must be built** — `require.resolve` of the dist fails loud at activation with a build hint; there is no source-serving fallback.
- **Streaming responses ride Electron's protocol handler** — the NDJSON Remote-stream bodies stream through the scheme bridge, and a carrier without streaming support would see event streams stall.
- **Support exports remain partial** — `complete:false` and `uncollected` disclose missing runtime health, connection, effective role, update and native crash producers. Listener state and advertised capabilities do not establish those facts. The Settings export also requires the desktop Gateway and renderer to be available.
