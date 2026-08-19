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

/** Privileged-scheme flags: standard URLs, secure origin, fetch-able, streaming bodies (SSE). */
protocol.registerSchemesAsPrivileged([
  {
    scheme: DSH_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: false,
    },
  },
])

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

/** Create the application window pointed at the in-process entry URL. */
function createWindow(): BrowserWindow {
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
  void window.loadURL(ENTRY_URL)
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
  window.webContents.once('did-finish-load', () => {
    // The shell renders its boot sequence client-side; settle before capture.
    setTimeout(() => {
      void (async () => {
        const image = await window.capturePage()
        await writeFile(shotPath, image.toPNG())
        if (booted !== undefined) await booted.shutdown.shutdown(0)
        app.quit()
      })()
    }, 8_000)
  })
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
  const window = createWindow()
  armSmokeShot(window)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
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
