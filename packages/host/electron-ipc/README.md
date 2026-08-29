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
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

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
