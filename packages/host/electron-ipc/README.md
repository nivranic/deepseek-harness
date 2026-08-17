# `@deepseek-ai/dsh-host-electron-ipc`

English | [中文](README.zh.md)

The desktop carrier for the browser surface: a function plugin (injects `clientModules`, `connection`, `apiProxy`) that provides `desktopGateway`, the in-process fetch target the Electron app shell wires to its privileged `dsh:` scheme — the IPC bridge the [webserver documentation](../webserver/README.md) reserves for the desktop shape. This package binds no socket. `handle(request)` dispatches in three branches: `/api` rides the Connection shared-channel chain (interceptor claims ahead of the `toFetchHandler(apiProxy)` fallback, with no HTTP trust fence — every request arrives from this process's own renderer, never the network, so the loopback-pinned privileged methods stay reachable for the GUI), `/plugins/<id>/client.js` (plus `.map`) serves the client-module bundles through the module registry, and every other path serves the built frontend dist — traversal outside the dist root is 403, any miss falls back to index.html with 200 (SPA routing), unknown extensions ship as octet-stream, and every index response carries the freshly injected boot manifest (`injectBootManifest` over the current graph). The dist location is assembly knowledge resolved through `@deepseek-ai/dsh-web-frontend`'s exports, never configured.

## Model Experience

None, as the package serves renderer assets and dispatches renderer fetches; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The frontend dist must be built** — `require.resolve` of the dist fails loud at activation with a build hint; there is no source-serving fallback.
- **Streaming responses ride Electron's protocol handler** — SSE bodies stream through the scheme bridge, and a carrier without streaming support would see event streams stall.
