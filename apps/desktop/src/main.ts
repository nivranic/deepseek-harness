/**
 * Electron main-process shell for the desktop surface. Registers the
 * privileged `dsh:` scheme before ready, boots the `desktop` profile through
 * the shared dsh profile launcher, wires every renderer request of the scheme
 * to the tree-provided desktopGateway (the in-process fetch bridge), and owns
 * the window and the bounded-shutdown lifecycle — the menu bar is removed and
 * the version surface lives in the web Settings dialog. The close button
 * follows the tree's `desktop` settings namespace (hide to the tray by
 * default, or quit), read live at close time; the namespace's `launchAtLogin`
 * (default off) owns the OS login entry, which starts the app hidden in the
 * tray so a later reveal is instant; the app runs single-instance so
 * a second launch reveals the hidden window. No preload is needed:
 * the carrier
 * is the scheme itself, so `contextIsolation` stays on with nothing exposed.
 * @module @deepseek-ai/dsh-desktop/main
 */

/* v8 ignore file -- exercised by the packaged app and the desktop e2e boot. */

import { app, BrowserWindow, Menu, nativeImage, powerMonitor, protocol, screen, Tray } from 'electron'
import { dirname, join } from 'node:path'
import { open, readdir, stat, writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { DesktopGateway } from '@deepseek-ai/dsh-host-electron-ipc'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
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
  /** Mirror of the schema's `launchAtLogin`: OS login autostart, default off. */
  launchAtLogin: boolean
}

// The package name carries a scope slash, which is invalid inside the
// userData directory path; pin a filesystem-safe app name before any path is
// derived from it.
app.name = 'deepseek-harness-desktop'

/** Files above this size are not prefetched; see {@link prefetchInstallTree}. */
const PREFETCH_SKIP_ABOVE_BYTES = 64 << 20

/**
 * Page-cache warmup for the packaged install's renderer hot set: cold-launch
 * file I/O — not CPU — dominates the gap between warm (~1s) and cold (~4s)
 * startup, because the `.pak` resources and small DLLs are demand-paged in
 * scattered faults when the renderer spawns. Reading the same bytes
 * sequentially ahead of that spawn (measured: the ~100MB hot set in ~150ms on
 * the install's NVMe) makes the renderer's load instant instead of a 2-3s
 * race it usually loses, so this warms the install root's files and the two
 * locale paks the UI can pick, chunk-reading each through one shared buffer,
 * size-ascending. Files above {@link PREFETCH_SKIP_ABOVE_BYTES} are skipped:
 * the ~200MB exe is its own image, largely resident as the process runs, and
 * streaming it competes with everything else for the disk. Best-effort by
 * contract: an unreadable file leaves the on-demand path exactly as it was.
 * Undefined when unpackaged, where the "install" would be the repository
 * checkout — the window then skips the bounded wait below.
 */
async function prefetchInstallTree(): Promise<void> {
  /** Chunk size for the shared read buffer; large enough to keep reads sequential. */
  const CHUNK = 1 << 20
  const buffer = Buffer.alloc(CHUNK)
  const warmFile = async (path: string): Promise<void> => {
    let handle
    try {
      handle = await open(path, 'r')
      // Read to EOF through the shared buffer; the page cache keeps the bytes.
      let bytesRead = CHUNK
      while (bytesRead === CHUNK) bytesRead = (await handle.read(buffer, 0, CHUNK, null)).bytesRead
    } catch {
      // Best-effort prefetch: a locked or unreadable file keeps its normal
      // on-demand read, so nothing here may fail the boot.
      return
    } finally {
      try { await handle?.close() } catch { /* the warmup read already got what it could */ }
    }
  }
  const installRoot = dirname(dirname(app.getAppPath()))
  try {
    // Size-ascending order: the megabyte-scale resources the renderer needs
    // first, any multi-megabyte tail last.
    const batch: { path: string; size: number }[] = []
    for (const entry of await readdir(installRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) continue
      const path = join(installRoot, entry.name)
      const size = (await stat(path)).size
      if (size > PREFETCH_SKIP_ABOVE_BYTES) continue
      batch.push({ path, size })
    }
    // Every locale pak is large but exactly one is read at boot; warm the two
    // the UI locale can resolve to. A missing pak sizes 0 — warmFile's own
    // catch then skips it without aborting the batch.
    for (const locale of ['zh-CN.pak', 'en-US.pak']) {
      const path = join(installRoot, 'locales', locale)
      batch.push({ path, size: (await stat(path).catch(() => ({ size: 0 }))).size })
    }
    batch.sort((left, right) => left.size - right.size)
    for (const file of batch) await warmFile(file.path)
  } catch {
    // The install root vanished or is unreadable mid-walk: the on-demand
    // reads (and their loud failures) own the rest.
    return
  }
}
const installWarmup = app.isPackaged ? prefetchInstallTree() : undefined

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
/** A login-autostart launch (`--hidden` from the OS login entry): stay in the tray until revealed. */
const hiddenLaunch = process.argv.includes('--hidden')
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
/** Whether the missing launch-at-login setting was already reported. */
let reportedMissingLaunchSetting = false

/**
 * The OS login entry follows the `desktop` namespace's `launchAtLogin`
 * (default off): a login-hidden start is what makes a later reveal instant,
 * and the registry entry must exist BEFORE the next login for that to happen,
 * so the shell syncs it once the tree serves settings and again on every
 * settings commit — a toggle takes effect immediately.
 * @param section - the freshly resolved `desktop` section.
 */
function syncLaunchAtLogin(section: unknown): void {
  const enabled = (section as DesktopSettings | undefined)?.launchAtLogin
  if (enabled !== true && enabled !== false) {
    if (!reportedMissingLaunchSetting) {
      reportedMissingLaunchSetting = true
      console.error(
        'dsh desktop: the launch-at-login setting is unreadable (the ui-desktop roster row drifted); '
        + 'the OS login entry keeps its current state',
      )
    }
    return
  }
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
}

/**
 * Apply the launch-at-login preference once the tree serves settings and
 * follow every `settings/updated` commit afterwards: the event carries the
 * namespace's resolved section, so the OS login entry tracks the toggle
 * without polling.
 */
function watchLaunchAtLogin(): void {
  const ctx = booted?.ctx
  if (ctx === undefined) return
  syncLaunchAtLogin(ctx.get('settings')?.get(desktopNamespace))
  ctx.on('settings/updated', (ns: string, next: unknown) => {
    if (ns === desktopNamespace) syncLaunchAtLogin(next)
  })
}

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


/**
 * Settle the tree and return the gateway, or throw once boot cannot serve.
 *
 * The boot graph (`dsh/profile-boot` and its module-fallback heal) loads
 * DYNAMICALLY here so the call can start at module top, before `app.ready`:
 * the tree boot's ~2s of parse/execute then overlaps Electron's core
 * initialization instead of starting after it. The heal's synchronous prefix
 * (a stamped no-op walk when the install is unchanged, a full manifest walk
 * after each rebuild) may hold the main thread for its own duration before
 * `ready` fires — paid back by the boot finishing that much earlier.
 */
async function startGateway(): Promise<DesktopGateway> {
  const [{ runProfile }, { loadLayeredEnv }] = await Promise.all([
    import('@deepseek-ai/dsh/profile-boot'),
    import('@deepseek-ai/dsh-app-boot'),
  ])
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

/**
 * Create the application window: prelude first, the gateway-backed entry page
 * when it can answer. `gatewayReady` never rejects — a boot failure surfaces
 * through fail-loud, which owns the process exit while the prelude page stays
 * on screen — so the swap needs no rejection arm.
 * @param gatewayReady - settles once the booted tree's gateway is live.
 */
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
  window.once('ready-to-show', () => {
    if (!hiddenLaunch) {
      window.show()
      return
    }
    // The login entry starts the app in the tray state: the tree boots and
    // the entry page swaps in while hidden, so a later reveal is instant. A
    // tray that cannot be built must never strand the window invisible.
    try {
      ensureTray()
    } catch (error) {
      console.error('dsh desktop: hidden launch cannot build the tray; showing the window instead', error)
      window.show()
    }
  })
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

  // The gateway settles into this deferred: renderer fetches queue on it
  // until the tree boots, so an early request never sees an unhandled
  // scheme, and the window swaps to the entry URL the moment it resolves.
  // Boot starts at module top — its tree-mount CPU overlaps Electron's core
  // initialization rather than following it — but only AFTER the install
  // warmup finishes: the tree boot's ~1100 file opens and the warmup's bulk
  // reads share one disk, and racing them made both slower (measured: the
  // renderer window lost ~1.5s to the contention). Boot failures surface
  // through fail-loud (it owns the process exit); the prelude page stays on
  // screen until it lands.
  let resolveGateway!: (gateway: DesktopGateway) => void
  const gatewayReady = new Promise<DesktopGateway>((resolve) => { resolveGateway = resolve })
  void (installWarmup ?? Promise.resolve()).then(() => {
    void startGateway().then((gateway) => {
      // Settings serve from here on: apply the login preference once, then
      // follow every commit so the toggle lands in the registry immediately.
      watchLaunchAtLogin()
      resolveGateway(gateway)
    })
  })

  void app.whenReady().then(async () => {
    clearMenuBar()
    // Windows derives notification origin from the AppUserModelId; pin one so
    // the closed-to-tray balloon names the app, not the exe path.
    app.setAppUserModelId('com.deepseek-ai.dsh-desktop')
    protocol.handle(DSH_SCHEME, request => gatewayReady.then(gateway => gateway.handle(request)))
    // The window waits — bounded to half a second — for the renderer hot set
    // warmup (usually long finished by ready): spawning the renderer into
    // guaranteed-warm resources costs ~0, while racing the warmup made the
    // renderer's load a 2-3s coin flip on cold installs. Past the bound the
    // window proceeds regardless, never slower than the un-waited launch.
    await (installWarmup === undefined
      ? undefined
      : Promise.race([installWarmup, new Promise((resolve) => { setTimeout(resolve, 500) })]))
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
