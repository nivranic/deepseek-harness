# `@deepseek-ai/dsh-desktop-app`

English | [中文](README.zh.md)

The dsh desktop-surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-base`](../base/README.md): it sets the coding persona, inserts the desktop host rows (API gateway, workspace, projection cache, storage, the [`electron-ipc`](../../host/electron-ipc/README.md) carrier) and the browser plugin roster of the Web surface plus one desktop-only row ([ui-desktop](../../client/ui-desktop/README.md), the close-button preference), and mounts this package's `desktop-runtime` glue plugin (config `{surfaceContext}`). The surface differs from [`dsh-web-app`](../web-app/README.md) in exactly its carrier: no webserver row binds, no `webStartup` flags parse, and the Connection row stays mounted with an empty trust list for its transport-neutral registry service and browser half. The electron-ipc row provides `desktopGateway`, which the Electron app shell (`apps/desktop`) wires to its privileged scheme; the adaptive directory picker declares its loopback bind fact through `bindHost` because no server bind exists to read. The glue plugin registers the harness-source and `app:desktop-surface` prompt sections when `surfaceContext` is true: the desktop window orientation with the no-URL contract and the instruction not to start a `dsh web` replacement. No URL line, shell variable, or HTTP seat exists on this surface.

## Model Experience

### Harness-source and desktop-surface context

#### What the model sees

When `surfaceContext` is true, the `harness:source` section identifies the on-disk Harness implementation without claiming it is the working directory, and the `app:desktop-surface` global section (order −98) orients the model to the desktop window: the "this page" referent, the absence of implicit DOM/route/screenshot context, the no-URL contract (the window loads the built frontend in-process; no HTTP server serves it), and the instruction not to start a `dsh web` server unless asked. When it is false, neither section is registered.

#### Token effect

One source line and one prompt paragraph per session; constant per process.

#### KV Cache effect

The prompt section sits near the system prompt's head and is stable for the life of the process, so it does not invalidate the cache across turns.

## Known Limitations and Deferred Work

- **The frontend dist must be built** — the carrier's `require.resolve` of the dist fails loud at activation with a build hint; there is no source-serving fallback.
