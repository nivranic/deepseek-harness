/**
 * Electron main-process shell for the desktop surface. Registers the
 * privileged `dsh:` scheme before ready, boots the `desktop` profile through
 * the shared dsh profile launcher, wires every renderer request of the scheme
 * to the tree-provided desktopGateway (the in-process fetch bridge), and owns
 * the window and the bounded-shutdown lifecycle — the menu bar is removed and
 * the version surface lives in the web Settings dialog. The close button
 * follows the tree's `desktop` settings namespace (hide to the tray by
 * default, or quit), read live at close time; the app runs single-instance so
 * a second launch reveals the hidden window. No preload is needed:
 * the carrier
 * is the scheme itself, so `contextIsolation` stays on with nothing exposed.
 * @module @deepseek-ai/dsh-desktop/main
 */

/* v8 ignore file -- exercised by the packaged app and the desktop e2e boot. */

import { app, BrowserWindow, Menu, nativeImage, powerMonitor, protocol, screen, Tray } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import type { Context } from '@deepseek-ai/cordis'
import type { DesktopGateway } from '@deepseek-ai/dsh-host-electron-ipc'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { DSH_SCHEME, ENTRY_URL } from './scheme.ts'

/**
 * The settings namespace the ui-desktop host half registers — a local mirror
 * of `DESKTOP_SETTINGS_NAMESPACE`, kept honest by the desktop composition e2e
 * (it round-trips the real namespace the composition serves). The package
 * itself stays unimported here: any import would pull its sources into this
 * host project (TS6307), and a project reference would drag its client half
 * into the typert host-face programs.
 */
const desktopNamespace = settingsNamespace('desktop')

/** What the desktop window's close button does (mirror of the ui-desktop schema's union). */
type DesktopCloseAction = 'tray' | 'quit'

/** The `desktop` settings section (mirror of the ui-desktop package's type). */
interface DesktopSettings {
  closeAction: DesktopCloseAction
}

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

/** The application window, tracked for tray restore and second-instance focus. */
let mainWindow: BrowserWindow | undefined
/** The tray holding the hidden window; created on the first close-to-tray. */
let tray: Tray | undefined
/** Set while the application is already quitting: the close handler must not intercept. */
let quitting = false
/** Set when a tray build failed: closing must never strand a hidden window again. */
let trayBroken = false
/** Whether this run already showed the closed-to-tray balloon hint. */
let hinted = false
/** Whether the missing close-behavior service was already reported. */
let reportedMissingBehavior = false

/**
 * The close-button behavior from the booted tree's `desktop` settings
 * namespace: `tray` hides the window, `quit` tears down. The fallback is the
 * schema default, so a tree that is still booting or has drifted keeps the
 * window closable instead of stranding it.
 */
function closeAction(): DesktopCloseAction {
  const section = booted?.ctx.get('settings')?.get(desktopNamespace) as DesktopSettings | undefined
  const action = section?.closeAction
  if (action === 'tray' || action === 'quit') return action
  if (!reportedMissingBehavior) {
    reportedMissingBehavior = true
    console.error(
      'dsh desktop: the desktop close-action setting is unreadable (tree still booting, or the ui-desktop '
      + 'roster row drifted); closing defaults to tray',
    )
  }
  return 'tray'
}

/** Tray affordance copy follows the OS locale: the tray lives outside the web locale. */
function trayLabels(): { open: string; quit: string; hintTitle: string; hintBody: string } {
  const os = app.getLocale().toLowerCase()
  return os.startsWith('zh')
    ? {
      open: '打开 DeepSeek Harness',
      quit: '退出',
      hintTitle: 'DeepSeek Harness 仍在运行',
      hintBody: '窗口已缩小到系统托盘，点击托盘图标可恢复。',
    }
    : {
      open: 'Open DeepSeek Harness',
      quit: 'Quit',
      hintTitle: 'DeepSeek Harness is still running',
      hintBody: 'The window was closed to the system tray. Click the tray icon to restore it.',
    }
}

/** Bring the window back from the tray (or the taskbar) and focus it. */
function showWindow(): void {
  const window = mainWindow
  if (window === undefined || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/**
 * Materialize the tray icon the first time the window hides to it. The icon
 * is the app's own transparent PNG resource: extracting it from the exe with
 * `app.getFileIcon` instead loses the alpha channel on the way through the
 * HICON conversion, and the tray renders the circle on an opaque white
 * square. Resizing to the tray's physical slot avoids Explorer's own
 * rescaling, which is another alpha-losing path.
 */
function ensureTray(): void {
  if (tray !== undefined) return
  const factor = screen.getPrimaryDisplay().scaleFactor
  const slot = Math.min(32, Math.max(16, Math.round(16 * factor)))
  const source = nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'tray-icon.png'))
  if (source.isEmpty()) throw new Error('tray-icon.png missing or unreadable under the app path')
  const icon = source.resize({ width: slot, height: slot })
  const labels = trayLabels()
  const composed = new Tray(icon)
  composed.setToolTip('DeepSeek Harness')
  composed.setContextMenu(Menu.buildFromTemplate([
    { label: labels.open, click: () => { showWindow() } },
    { type: 'separator' },
    { label: labels.quit, click: () => { app.quit() } },
  ]))
  composed.on('click', () => { showWindow() })
  tray = composed
}

/**
 * Hide the window to the tray: the affordance is built FIRST, so the window
 * never vanishes with nothing to bring it back. A tray that cannot be built
 * (resource unreadable) closes the window for real, exiting through the
 * normal teardown; the balloon hint shows once per run.
 */
function hideToTray(window: BrowserWindow): void {
  try {
    ensureTray()
  } catch (error) {
    trayBroken = true
    console.error('dsh desktop: building the tray failed; closing the window for real', error)
    window.close()
    return
  }
  window.hide()
  if (hinted) return
  hinted = true
  const { hintTitle: title, hintBody: content } = trayLabels()
  tray?.displayBalloon({ iconType: 'info', title, content })
}


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
  mainWindow = window
  window.once('ready-to-show', () => { window.show() })
  window.on('close', (event) => {
    // Real exits (`before-quit`, Windows session end) must pass through, and a
    // platform without the tray's icon extraction — or a tray that failed to
    // build — must never hide a window it cannot bring back.
    if (quitting || trayBroken || process.platform !== 'win32' || closeAction() !== 'tray') return
    event.preventDefault()
    hideToTray(window)
  })
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

// One instance owns the launch path: with close-to-tray as the default, a
// second launch must reveal the hidden window instead of stacking a second
// tree. The packaged smoke run is alone (the release chain stops the app
// before packaging).
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { showWindow() })

  void app.whenReady().then(() => {
    clearMenuBar()
    // Windows derives notification origin from the AppUserModelId; pin one so
    // the closed-to-tray balloon names the app, not the exe path.
    app.setAppUserModelId('com.deepseek-ai.dsh-desktop')
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
}

// The tray's Quit, the smoke shutdown, and anything else that calls
// app.quit() pass through the close handler without interception.
app.on('before-quit', () => { quitting = true })
// System shutdown/logoff: never intercept the session's close of the window.
void app.whenReady().then(() => { powerMonitor.on('shutdown', () => { quitting = true }) })

app.on('window-all-closed', () => {
  // The desktop surface is single-window by construction: closing it tears
  // down the whole tree through the bounded shutdown, then quits.
  void (async () => {
    if (booted !== undefined) await booted.shutdown.shutdown(0)
    app.quit()
  })()
})
