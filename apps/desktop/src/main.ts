/**
 * Electron main-process shell for the desktop surface. Registers the
 * privileged `dsh:` scheme before ready, boots the `desktop` profile through
 * the shared dsh profile launcher, wires every renderer request of the scheme
 * to the tree-provided desktopGateway (the in-process fetch bridge), and owns
 * the window and the bounded-shutdown lifecycle — the menu bar is removed and
 * the version surface lives in the web Settings dialog. No preload is needed:
 * the carrier
 * is the scheme itself, so `contextIsolation` stays on with nothing exposed.
 * @module @deepseek-ai/dsh-desktop/main
 */

/* v8 ignore file -- exercised by the packaged app and the desktop e2e boot. */

import { app, BrowserWindow, Menu, protocol } from 'electron'
import { writeFile } from 'node:fs/promises'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import type { Context } from '@deepseek-ai/cordis'
import type { DesktopGateway } from '@deepseek-ai/dsh-host-electron-ipc'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { DSH_SCHEME, ENTRY_URL } from './scheme.ts'

// The package name carries a scope slash, which is invalid inside the
// userData directory path; pin a filesystem-safe app name before any path is
// derived from it.
app.name = 'deepseek-harness-desktop'

/** Privileged-scheme flags: standard URLs, secure origin, fetch-able, streaming bodies (SSE), cached compiled scripts. */
protocol.registerSchemesAsPrivileged([
  {
    scheme: DSH_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: false,
      // Chromium stores the compiled script of every dsh:// response, so the
      // client bundles re-parse for free on every launch after the first.
      codeCache: true,
    },
  },
])

/**
 * Main-process-owned prelude page. The entry URL cannot answer until the
 * gateway's tree settles, so the window first paints this static stand-in —
 * the same wordmark and arc as the client boot page — and swaps to the entry
 * URL the moment the gateway is ready; without it a cold first launch stares
 * at an empty white window through the whole tree boot.
 */
const PRELUDE_URL = `data:text/html,${encodeURIComponent(`<!doctype html>
<meta charset="utf-8">
<style>
  html, body { height: 100%; margin: 0; }
  body { display: grid; place-items: center; background: #fff; }
  .card { display: flex; flex-direction: column; align-items: center; gap: 16px; }
  .wordmark { font: 600 16px/24px system-ui, sans-serif; letter-spacing: 0.08em; color: #0f1115; }
  .spinner { position: relative; width: 20px; height: 20px; border-radius: 50%;
    border: 2px solid rgb(0 0 0 / 10%); animation: spin 0.8s linear infinite; }
  .spinner::after { content: ''; position: absolute; inset: -2px; border-radius: inherit;
    background: conic-gradient(#0f1115 72deg, transparent 0);
    mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 0); }
  .hint { font: 12px/18px system-ui, sans-serif; color: #81858c; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
<div class="card">
  <div class="wordmark">HARNESS</div>
  <div class="spinner"></div>
  <div class="hint">Loading plugins…</div>
</div>`)}`

/** The booted tree, kept for window-close teardown. */
let booted: { ctx: Context; shutdown: { shutdown(code: number): Promise<void> } } | undefined

/** Settle the tree and return the gateway, or throw once boot cannot serve. */
async function startGateway(): Promise<DesktopGateway> {
  const started = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'desktop',
    patchFiles: [],
    args: [],
  })
  booted = started
  // The gateway appears once its injected services resolve; waiting for the
  // Loader to settle guarantees the carrier row finished mounting (or failed
  // loud, in which case fail-loud already owns the exit).
  await started.ctx.get('loader')?.await()
  const gateway = started.ctx.get('desktopGateway')
  if (gateway === undefined) {
    throw new Error('dsh desktop: boot settled without a desktopGateway; the electron-ipc row did not mount')
  }
  return gateway
}

/**
 * The entry URL of the real page; smoke mode rides the query, not an
 * inter-process call: the shell hides blocking overlays itself, because a
 * main-process renderer round-trip mid-boot stalls the plugin load.
 */
function entryUrl(): string {
  const smoke = process.env.DSH_DESKTOP_SMOKE_SHOT
  return smoke === undefined || smoke === '' ? ENTRY_URL : `${ENTRY_URL}?dsh-smoke=1`
}

/** Create the application window: prelude first, the gateway-backed entry page when it can answer. */
function createWindow(gatewayReady: Promise<unknown>): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => { window.show() })
  void window.loadURL(PRELUDE_URL)
  void gatewayReady.then(() => {
    if (!window.isDestroyed()) void window.loadURL(entryUrl())
  }, () => {
    // Boot failure: fail-loud owns the process exit, and the prelude page is
    // what stays on screen until it lands.
  })
  return window
}

/**
 * Smoke-shot hook: `DSH_DESKTOP_SMOKE_SHOT=<path.png>` captures the settled
 * UI once after load and exits through the normal shutdown. Packaging
 * verification only — the ordinary surface never sets it.
 * @param window - the application window.
 */
function armSmokeShot(window: BrowserWindow): void {
  const shotPath = process.env.DSH_DESKTOP_SMOKE_SHOT
  if (shotPath === undefined || shotPath === '') return
  const onFinish = (): void => {
    // The prelude page (a data: URL) settles instantly; only the entry page's
    // load starts the settle timer the capture waits on.
    if (!window.webContents.getURL().startsWith(`${DSH_SCHEME}:`)) return
    window.webContents.off('did-finish-load', onFinish)
    // The shell renders its boot sequence client-side; settle before capture.
    setTimeout(() => {
      void (async () => {
        const image = await window.capturePage()
        await writeFile(shotPath, image.toPNG())
        if (booted !== undefined) await booted.shutdown.shutdown(0)
        app.quit()
      })()
    }, 8_000)
  }
  window.webContents.on('did-finish-load', onFinish)
}

/**
 * Drop the native menu bar: the surface owns no menu actions, and the version
 * surface lives in the web Settings dialog's About section. Without an
 * application menu the window renders no menu row at all.
 */
function clearMenuBar(): void {
  Menu.setApplicationMenu(null)
}

void app.whenReady().then(() => {
  clearMenuBar()
  // Register before any window: renderer fetches queue on the promise until
  // the tree settles, so an early request never sees an unhandled scheme.
  const gatewayReady = startGateway()
  protocol.handle(DSH_SCHEME, request => gatewayReady.then(gateway => gateway.handle(request)))
  const window = createWindow(gatewayReady)
  armSmokeShot(window)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(gatewayReady)
  })
})

app.on('window-all-closed', () => {
  // The desktop surface is single-window by construction: closing it tears
  // down the whole tree through the bounded shutdown, then quits.
  void (async () => {
    if (booted !== undefined) await booted.shutdown.shutdown(0)
    app.quit()
  })()
})
