---
description: "Desktop carrier for the browser surface: the in-process privileged-scheme fetch target answering the shared /api chain, Gateway Remote streams, client plugin bundles, and the boot-manifest-injected frontend dist; binds no socket."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-electron-ipc

English | [中文](README.zh.md)

## Summary

The desktop carrier for the browser surface: a function plugin providing `desktopGateway`, the in-process fetch target the Electron app shell wires to its privileged `dsh:` scheme. No socket is bound. `handle(request)` dispatches four branches: `/api` rides the Connection shared-channel chain (requests arrive from this process's renderer, never the network), `/dsh-stream/<endpoint>` carries a Gateway Remote stream as NDJSON frames, `/plugins` serves the client-module combo bundles, and every other path serves the frontend dist — traversal outside the dist root is 403, misses fall back to index.html for SPA routing, and each index response carries the transport bootstrap script.

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
