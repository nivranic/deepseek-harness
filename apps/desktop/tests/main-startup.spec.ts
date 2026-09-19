import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { MenuItem, MenuItemConstructorOptions } from 'electron'
import { DESKTOP_IPC, type DesktopUpdateState } from '../src/ipc.ts'

const harness = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  function deferred() {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((accept, decline) => { resolve = accept; reject = decline })
    return { promise, resolve, reject }
  }
  const windows: FakeWindow[] = []
  const hosts: FakeHost[] = []
  const menus: MenuItemConstructorOptions[][] = []
  const trays: FakeTray[] = []
  const updateHooks = {
    publish: (state: DesktopUpdateState) => state,
    beforeRestart: async () => {},
  }
  const handlers = new Map<string, (event: { senderFrame: { url: string } }) => unknown>()
  let pluginsEnabled = false
  let preparing = deferred()
  let prepared = deferred()
  let hostStarted = deferred()
  let navigated = deferred()
  let errorPublished = deferred()
  let quitCompleted = deferred()
  class FakeWindow extends EventEmitter {
    destroyed = false
    readonly urls: string[] = []
    readonly webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      openDevTools: vi.fn(),
      getURL: () => this.urls.at(-1) ?? '',
      send: vi.fn((channel: string, state: { phase?: string }) => {
        if (channel === 'dsh-desktop:backend-state' && state.phase === 'error') errorPublished.resolve()
      }),
    })
    readonly show = vi.fn()
    readonly hide = vi.fn()
    readonly focus = vi.fn()
    readonly restore = vi.fn()
    constructor(readonly options: { show: boolean }) { super(); windows.push(this) }
    isDestroyed() { return this.destroyed }
    isMinimized() { return false }
    async loadURL(url: string) {
      this.urls.push(url)
      if (url === 'dsh-app://app/index.html') navigated.resolve()
    }
    static getAllWindows() { return windows.filter(window => !window.destroyed) }
    close() {
      const event = { preventDefault: vi.fn() }
      this.emit('close', event)
      if (event.preventDefault.mock.calls.length === 0) { this.destroyed = true; this.emit('closed') }
    }
  }
  class FakeTray extends EventEmitter {
    destroyed = false
    readonly setToolTip = vi.fn()
    readonly setContextMenu = vi.fn()
    constructor() { super(); trays.push(this) }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true }
  }
  class FakeHost {
    readonly ready = deferred()
    readonly exited = deferred()
    readonly stopping = deferred()
    readonly start = vi.fn(() => { hostStarted.resolve(); return this.ready.promise })
    readonly stop = vi.fn(() => {
      this.stopping.resolve()
      this.ready.reject(new Error('child stopped'))
      return this.exited.promise
    })
    constructor(readonly node: string, readonly runtime: string, readonly profile: string) { hosts.push(this) }
  }
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    name: 'Desktop test',
    whenReady: () => Promise.resolve(),
    getLocale: (): string => 'en-US',
    getVersion: () => '1.0.0',
    getAppPath: () => 'desktop-test-app',
    getLoginItemSettings: () => ({ openAtLogin: false, wasOpenedAtLogin: false, executableWillLaunchAtLogin: false }),
    setLoginItemSettings: vi.fn(),
    requestSingleInstanceLock: () => true,
    exit: vi.fn(),
    relaunch: vi.fn(),
    quit: vi.fn(() => {
      const event = { preventDefault: vi.fn() }
      app.emit('before-quit', event)
      if (event.preventDefault.mock.calls.length === 0) quitCompleted.resolve()
    }),
  })
  return {
    windows, hosts, handlers, app, FakeWindow, FakeHost, FakeTray, menus, trays, updateHooks,
    image: { isEmpty: (): boolean => false, resize: vi.fn(() => ({ setTemplateImage: vi.fn() })) },
    dialog: { showErrorBox: vi.fn(), showMessageBox: vi.fn(), showOpenDialog: vi.fn() },
    applyRelease: vi.fn(() => { preparing.resolve(); return prepared.promise }),
    assertProfileRuntime: vi.fn(),
    canRecoverProfile: vi.fn(() => true),
    get preparing() { return preparing }, get prepared() { return prepared },
    get hostStarted() { return hostStarted }, get navigated() { return navigated },
    get errorPublished() { return errorPublished }, get quitCompleted() { return quitCompleted },
    nextHostStart() { hostStarted = deferred(); return hostStarted.promise },
    get pluginsEnabled() { return pluginsEnabled },
    set pluginsEnabled(value: boolean) { pluginsEnabled = value },
    reset() {
      windows.length = 0; hosts.length = 0; handlers.clear(); app.removeAllListeners()
      menus.length = 0; trays.length = 0
      app.isPackaged = true
      pluginsEnabled = false
      preparing = deferred(); prepared = deferred(); hostStarted = deferred()
      navigated = deferred(); errorPublished = deferred(); quitCompleted = deferred()
    },
  }
})

vi.mock('electron', () => ({
  app: harness.app,
  BrowserWindow: harness.FakeWindow,
  dialog: harness.dialog,
  ipcMain: {
    handle: (channel: string, handler: (event: { senderFrame: { url: string } }) => unknown) => { harness.handlers.set(channel, handler) },
  },
  Menu: {
    setApplicationMenu: vi.fn(),
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      harness.menus.push(template)
      return Object.assign(template, { getMenuItemById: (id: string) =>
        (template[0]?.submenu as MenuItemConstructorOptions[] | undefined)?.find(item => item.id === id) ?? null })
    },
  },
  Tray: harness.FakeTray,
  nativeImage: { createFromPath: () => harness.image },
  screen: { getPrimaryDisplay: () => ({ scaleFactor: 1 }) },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}))
vi.mock('../src/paths.ts', () => ({ resolveDesktopPaths: () => ({ root: 'desktop-test-root', profile: 'desktop-test-profile' }) }))
vi.mock('../src/shell-preferences.ts', () => ({
  DesktopShellPreferences: class {
    closeToTray = false
    async setCloseToTray(enabled: boolean) { this.closeToTray = enabled }
    async close() {}
    async flush() {}
  },
}))
vi.mock('../src/project-manager.ts', () => ({
  DesktopProjectManager: class {
    readonly applyRelease = harness.applyRelease
    readonly assertProfileRuntime = harness.assertProfileRuntime
    canRecoverProfile = harness.canRecoverProfile
    async mutate(_mutation: unknown, hooks: { beforeChange(): Promise<void>; afterChange(): Promise<void> }) {
      await hooks.beforeChange()
      harness.pluginsEnabled = false
      await hooks.afterChange()
    }
    async resetConfiguration(hooks: { beforeChange(): Promise<void>; afterChange(): Promise<void> }) {
      await this.mutate(undefined, hooks)
    }
  },
}))
vi.mock('../src/host-process.ts', () => ({ DesktopHostProcess: harness.FakeHost }))
vi.mock('../src/update-coordinator.ts', () => ({
  DesktopUpdateCoordinator: vi.fn(function (
    publish: typeof harness.updateHooks.publish,
    beforeRestart: typeof harness.updateHooks.beforeRestart,
  ) {
    harness.updateHooks.publish = publish
    harness.updateHooks.beforeRestart = beforeRestart
  }),
}))

function nativeItem(id: string): MenuItemConstructorOptions {
  const submenu = harness.menus[0]?.[0]?.submenu as MenuItemConstructorOptions[]
  const item = submenu.find(item => item.id === id)
  if (item === undefined) throw new Error(`missing menu item ${id}`)
  return item
}

function click(item: MenuItemConstructorOptions): void {
  // These template callbacks use the mutable checkbox fields; native integration runs in Electron.
  item.click?.(item as unknown as MenuItem, undefined, {})
}

async function setCloseToTray(enabled: boolean): Promise<void> {
  const item = nativeItem('desktop-close-to-tray')
  item.checked = enabled
  click(item)
  await vi.waitFor(() => { expect(item.enabled).toBe(true) })
  expect(item.checked).toBe(enabled)
}

function invoke(channel: string): unknown {
  const handler = harness.handlers.get(channel)
  if (handler === undefined) throw new Error(`missing handler ${channel}`)
  return handler({ senderFrame: { url: 'dsh-app://shell/startup.html' } })
}

const settingsRoots: string[] = []
function legacySettingsFile(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-main-import-'))
  settingsRoots.push(root)
  const file = join(root, '旧设置.yaml')
  writeFileSync(file, 'formatVersion: 1\ndesktop: {closeAction: tray, launchAtLogin: true}\n')
  return file
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  harness.reset()
  vi.stubEnv('DSH_DESKTOP_NODE_BINARY', 'test-node')
  vi.stubEnv('DSH_DESKTOP_PNPM_ENTRY', 'test-pnpm')
  vi.stubEnv('DSH_DESKTOP_DSH_DIR', 'test-runtime')
  vi.stubGlobal('process', { ...process, resourcesPath: 'desktop-test-resources' })
  vi.stubEnv('DSH_DESKTOP_HOST_INSPECT_PORT', undefined)
})

afterEach(async () => {
  harness.prepared.resolve()
  for (const host of harness.hosts) { host.ready.resolve(); host.exited.resolve() }
  harness.app.quit()
  await harness.quitCompleted.promise
  for (const root of settingsRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
  harness.canRecoverProfile.mockReturnValue(true)
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('desktop main startup', () => {
  it('previews and explicitly imports close behavior while leaving OS login registration untouched', async () => {
    vi.spyOn(harness.app, 'getLocale').mockReturnValue('zh-CN')
    const source = legacySettingsFile()
    const before = readFileSync(source)
    harness.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [source] })
    harness.dialog.showMessageBox.mockResolvedValue({ response: 0 })
    await import('../src/main.ts')
    await harness.preparing.promise
    const item = nativeItem('desktop-import-legacy-settings')
    click(item)
    click(item)
    await vi.waitFor(() => { expect(item.enabled).toBe(true) })
    expect(harness.dialog.showOpenDialog).toHaveBeenCalledTimes(1)
    expect(harness.dialog.showErrorBox).not.toHaveBeenCalled()
    expect(nativeItem('desktop-close-to-tray').checked).toBe(true)
    expect(harness.trays).toHaveLength(1)
    expect(harness.app.setLoginItemSettings).not.toHaveBeenCalled()
    expect(readFileSync(source)).toEqual(before)
    await expect(JSON.stringify(harness.dialog.showMessageBox.mock.calls[0]?.[0], null, 2) + '\n')
      .toMatchFileSnapshot('expected/legacy-settings-import-preview-zh.json')
  })

  it.each(['select', 'confirm', 'changed'] as const)('retains close behavior after import %s cancellation or refusal', async (stage) => {
    const source = legacySettingsFile()
    harness.dialog.showOpenDialog.mockResolvedValue({ canceled: stage === 'select', filePaths: [source] })
    harness.dialog.showMessageBox.mockImplementation(async () => {
      if (stage === 'changed') writeFileSync(source, 'desktop: {closeAction: quit}\n')
      return { response: stage === 'confirm' ? 1 : 0 }
    })
    await import('../src/main.ts')
    await harness.preparing.promise
    const item = nativeItem('desktop-import-legacy-settings')
    click(item)
    await vi.waitFor(() => { expect(item.enabled).toBe(true) })
    expect(nativeItem('desktop-close-to-tray').checked).toBe(false)
    expect(harness.trays).toHaveLength(0)
    expect(harness.app.setLoginItemSettings).not.toHaveBeenCalled()
    if (stage === 'changed') expect(harness.dialog.showErrorBox).toHaveBeenCalledWith(
      'Desktop Preference Failed', 'The settings file changed after the preview. Select it again to review the current values.',
    )
    else expect(harness.dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it.each(['win32', 'darwin'] as const)('records Chinese native preferences on %s', async (platform) => {
    vi.stubGlobal('process', { ...process, platform })
    vi.spyOn(harness.app, 'getLocale').mockReturnValue('zh-CN')
    await import('../src/main.ts')
    await harness.preparing.promise
    const snapshot = (template: MenuItemConstructorOptions[]): unknown => template.map(
      ({ label, type, role, enabled, checked, submenu }) => ({
        label, type, role, enabled, checked,
        ...(Array.isArray(submenu) ? { submenu: snapshot(submenu) } : {}),
      }),
    )
    await expect(JSON.stringify(snapshot(harness.menus[0]!), null, 2) + '\n')
      .toMatchFileSnapshot(`expected/native-menu-${platform}-zh.json`)
    expect(nativeItem('desktop-close-to-tray').checked).toBe(false)
    expect(harness.app.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('records the English development menu with login registration disabled', async () => {
    harness.app.isPackaged = false
    await import('../src/main.ts')
    await harness.hostStarted.promise
    const items = ['desktop-close-to-tray', 'desktop-launch-at-login', 'desktop-import-legacy-settings'].map((id) => {
      const { label, checked, enabled } = nativeItem(id)
      return { id, label, checked, enabled }
    })
    await expect(JSON.stringify(items, null, 2) + '\n').toMatchFileSnapshot('expected/native-menu-development-en.json')
    expect(nativeItem('desktop-launch-at-login').enabled).toBe(false)
    expect(harness.app.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('hides on close, restores from the tray and app activation, then quits through the tray', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    const host = harness.hosts[0]!
    host.ready.resolve()
    await harness.navigated.promise
    await setCloseToTray(true)
    const window = harness.windows[0]!
    window.close()
    expect(window.destroyed).toBe(false)
    expect(window.hide).toHaveBeenCalledOnce()
    expect(host.stop).not.toHaveBeenCalled()
    const trayMenu = harness.menus[1]!
    await expect(JSON.stringify(trayMenu.map(({ label, type }) => ({ label, type })), null, 2) + '\n')
      .toMatchFileSnapshot('expected/native-tray-en.json')
    click(trayMenu[0]!)
    expect(window.show).toHaveBeenCalledOnce()
    harness.app.emit('activate')
    expect(window.show).toHaveBeenCalledTimes(2)
    harness.trays[0]!.emit('click')
    expect(window.show).toHaveBeenCalledTimes(3)
    click(trayMenu[2]!)
    await host.stopping.promise
    expect(harness.app.quit).toHaveBeenCalledOnce()
    host.exited.resolve()
    await harness.quitCompleted.promise
    expect(harness.trays[0]!.destroyed).toBe(true)
    window.close()
    expect(window.destroyed).toBe(true)
  })

  it('disabling close-to-tray reveals the window and permits an ordinary close', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    await setCloseToTray(true)
    const window = harness.windows[0]!
    window.close()
    await setCloseToTray(false)
    expect(window.show).toHaveBeenCalledOnce()
    expect(harness.trays[0]!.destroyed).toBe(true)
    window.close()
    expect(window.destroyed).toBe(true)
  })

  it('consumes hidden startup once and restores through second-instance activation', async () => {
    vi.stubGlobal('process', { ...process, argv: [...process.argv, '--hidden'] })
    await import('../src/main.ts')
    await harness.preparing.promise
    const window = harness.windows[0]!
    expect(window.options.show).toBe(false)
    expect(window.hide).toHaveBeenCalledOnce()
    expect(harness.trays).toHaveLength(1)
    harness.app.emit('second-instance')
    expect(window.show).toHaveBeenCalledOnce()
    window.close()
    harness.app.emit('activate')
    expect(harness.windows[1]!.options.show).toBe(true)
    expect(harness.windows[1]!.hide).not.toHaveBeenCalled()
  })

  it('shows a hidden startup when its tray image is unavailable', async () => {
    vi.stubGlobal('process', { ...process, argv: [...process.argv, '--hidden'] })
    vi.spyOn(harness.image, 'isEmpty').mockReturnValue(true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await import('../src/main.ts')
    await harness.preparing.promise
    expect(harness.windows[0]!.show).toHaveBeenCalledOnce()
    expect(harness.windows[0]!.hide).not.toHaveBeenCalled()
    expect(harness.dialog.showErrorBox).toHaveBeenCalledOnce()
  })

  it('releases installer quit ownership after an update error', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    const host = harness.hosts[0]!
    host.ready.resolve()
    await harness.navigated.promise
    await setCloseToTray(true)
    const preparing = harness.updateHooks.beforeRestart()
    await host.stopping.promise
    host.exited.resolve()
    await preparing
    harness.updateHooks.publish({ phase: 'error', message: 'installer refused replacement' })
    const window = harness.windows[0]!
    window.close()
    expect(window.destroyed).toBe(false)
    expect(window.hide).toHaveBeenCalledOnce()
    harness.app.quit()
    await harness.quitCompleted.promise
    expect(harness.trays[0]!.destroyed).toBe(true)
  })

  it('exits with a diagnostic when both initialization and emergency navigation fail', async () => {
    const exited = Promise.withResolvers<undefined>()
    vi.spyOn(harness.app, 'getLocale').mockImplementationOnce(() => { throw new Error('locale unavailable') })
    vi.spyOn(harness.FakeWindow.prototype, 'loadURL').mockRejectedValueOnce(new Error('emergency navigation failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    harness.app.exit.mockImplementationOnce(() => { exited.resolve(undefined) })
    await import('../src/main.ts')
    await exited.promise
    expect(harness.app.exit).toHaveBeenCalledWith(1)
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'emergency navigation failed' }))
  })

  it('withholds profile recovery after application resources fail to load', async () => {
    harness.canRecoverProfile.mockReturnValue(false)
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.reject(new Error('runtime resources missing'))
    await harness.errorPublished.promise
    expect(invoke(DESKTOP_IPC.backendStatus)).toMatchObject({ phase: 'error', profileRecovery: false })
    const window = harness.windows[0]!
    window.webContents.emit('preload-error', {}, 'preload-app.cjs', new Error('preload unavailable'))
    const html = decodeURIComponent(window.urls.at(-1)!)
    expect(html).toContain('dsh-recovery://restart')
    expect(html).not.toContain('dsh-recovery://reset')
    expect(html).not.toContain('dsh-recovery://plugins')
  })

  it('reloads a crashed startup renderer in the same window', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    const window = harness.windows[0]!
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    await harness.errorPublished.promise
    expect(window.urls).toEqual(['dsh-app://shell/startup.html', 'dsh-app://shell/startup.html'])
    expect(invoke(DESKTOP_IPC.backendStatus)).toMatchObject({ phase: 'error', message: 'Desktop renderer exited: crashed' })
  })

  it.each(['plugins', 'reset'])('runs %s recovery from a document with a broken preload', async (action) => {
    await import('../src/main.ts')
    await harness.preparing.promise
    const window = harness.windows[0]!
    window.webContents.emit('preload-error', {}, 'preload-app.cjs', new Error('preload unavailable'))
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.ready.resolve()
    await Promise.resolve(invoke(DESKTOP_IPC.backendRetry))
    const started = harness.nextHostStart()
    const event = { preventDefault: vi.fn() }
    window.webContents.emit('will-navigate', event, `dsh-recovery://${action}/?`)
    await harness.hosts[0]!.stopping.promise
    harness.hosts[0]!.exited.resolve()
    await started
    harness.hosts[1]!.ready.resolve()
    await harness.navigated.promise
    expect(event.preventDefault).toHaveBeenCalled()
    expect(window.urls.at(-1)).toBe('dsh-app://app/index.html')
  })

  it('allows a full profile reset for an unclassified startup failure', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.exited.resolve()
    harness.hosts[0]!.ready.reject(new Error('Unknown startup failure'))
    await harness.errorPublished.promise
    const started = harness.nextHostStart()
    const reset = Promise.resolve(invoke(DESKTOP_IPC.configurationReset))
    await started
    harness.hosts[1]!.ready.resolve()
    await reset
    expect(invoke(DESKTOP_IPC.backendStatus)).toEqual({ phase: 'ready' })
  })

  it('keeps a self-contained reinstall document in the main window after preload failure', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    const window = harness.windows[0]!
    window.webContents.emit('preload-error', {}, 'preload-app.cjs', new Error('preload unavailable'))
    expect(window.urls.at(-1)).toContain('data:text/html')
    expect(decodeURIComponent(window.urls.at(-1)!)).toContain('preload unavailable')
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.ready.resolve()
    await Promise.resolve(invoke(DESKTOP_IPC.backendRetry))
    expect(harness.windows).toHaveLength(1)
    expect(window.urls.at(-1)).toContain('data:text/html')
    expect(harness.dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('offers plugin recovery and disables plugins before restarting in the same window', async () => {
    harness.pluginsEnabled = true
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.exited.resolve()
    harness.hosts[0]!.ready.reject(new Error('Plugin initialization failed'))
    await harness.errorPublished.promise
    expect(invoke(DESKTOP_IPC.backendStatus)).toMatchObject({ phase: 'error', profileRecovery: true })
    const nextStarted = harness.nextHostStart()
    const recovery = Promise.resolve(invoke(DESKTOP_IPC.pluginsDisableAll))
    await nextStarted
    expect(harness.pluginsEnabled).toBe(false)
    harness.hosts[1]!.ready.resolve()
    await recovery
    expect(harness.windows).toHaveLength(1)
    expect(invoke(DESKTOP_IPC.backendStatus)).toEqual({ phase: 'ready' })
  })

  it('waits for Host exit before relaunching the application', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.ready.resolve()
    await harness.navigated.promise
    const restart = Promise.resolve(invoke(DESKTOP_IPC.applicationRestart))
    await harness.hosts[0]!.stopping.promise
    expect(harness.app.relaunch).not.toHaveBeenCalled()
    harness.hosts[0]!.exited.resolve()
    await restart
    expect(harness.app.relaunch).toHaveBeenCalledOnce()
  })

  it('shows the loading window before profile preparation and starts one actual Host', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    expect(harness.windows).toHaveLength(1)
    const window = harness.windows[0]!
    expect(window.options.show).toBe(true)
    expect(window.urls).toEqual(['dsh-app://shell/startup.html'])
    expect(harness.hosts).toHaveLength(0)
    const retry = invoke(DESKTOP_IPC.backendRetry)
    const secondRetry = invoke(DESKTOP_IPC.backendRetry)
    harness.prepared.resolve()
    await harness.hostStarted.promise
    expect(harness.hosts).toHaveLength(1)
    expect(window.urls).toEqual(['dsh-app://shell/startup.html'])
    harness.hosts[0]!.ready.resolve()
    await Promise.all([retry, secondRetry, harness.navigated.promise])
    expect(harness.applyRelease).toHaveBeenCalledTimes(1)
    expect(harness.assertProfileRuntime).toHaveBeenCalledWith('desktop-test-profile')
    expect(harness.hosts[0]).toMatchObject({
      node: join('desktop-test-resources', 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
      runtime: join('desktop-test-resources', 'dsh'),
      profile: 'desktop-test-profile',
    })
    expect(harness.hosts[0]!.start).toHaveBeenCalledTimes(1)
    expect(harness.windows).toHaveLength(1)
    expect(window.urls).toEqual(['dsh-app://shell/startup.html', 'dsh-app://app/index.html'])
    expect(invoke(DESKTOP_IPC.backendStatus)).toEqual({ phase: 'ready' })
  })

  it('starts the unpackaged Host from the application development directory', async () => {
    harness.app.isPackaged = false
    await import('../src/main.ts')
    await harness.hostStarted.promise
    const project = join(harness.app.getAppPath(), '.desktop-build', 'development', 'project')
    expect(harness.hosts[0]).toMatchObject({ node: 'test-node', runtime: project, profile: project })
    expect(harness.applyRelease).not.toHaveBeenCalled()
    expect(harness.assertProfileRuntime).not.toHaveBeenCalled()
    harness.hosts[0]!.ready.resolve()
    await harness.navigated.promise
    expect(harness.dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('keeps startup errors and a successful retry in the same window', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    const first = harness.hosts[0]!
    const failedRetry = expect(Promise.resolve(invoke(DESKTOP_IPC.backendRetry))).rejects.toThrow('plugin composition failed')
    first.exited.resolve()
    first.ready.reject(new Error('plugin composition failed'))
    await harness.errorPublished.promise
    await failedRetry
    expect(invoke(DESKTOP_IPC.backendStatus)).toEqual({ phase: 'error', message: 'plugin composition failed', profileRecovery: true })
    expect(harness.windows[0]!.urls).toEqual(['dsh-app://shell/startup.html'])
    const nextStarted = harness.nextHostStart()
    const retry = Promise.resolve(invoke(DESKTOP_IPC.backendRetry))
    await nextStarted
    expect(harness.hosts).toHaveLength(2)
    harness.hosts[1]!.ready.resolve()
    await retry
    expect(harness.windows).toHaveLength(1)
    expect(harness.windows[0]!.urls.at(-1)).toBe('dsh-app://app/index.html')
    expect(harness.dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('waits for a pending child to exit on quit without late window navigation', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    const window = harness.windows[0]!
    const host = harness.hosts[0]!
    host.stop.mockImplementation(() => { host.stopping.resolve(); return host.exited.promise })
    window.close()
    harness.app.quit()
    await host.stopping.promise
    expect(harness.app.quit).toHaveBeenCalledTimes(1)
    host.ready.resolve()
    host.exited.resolve()
    await harness.quitCompleted.promise
    expect(host.stop).toHaveBeenCalledTimes(1)
    expect(window.urls).toEqual(['dsh-app://shell/startup.html'])
    expect(harness.windows).toHaveLength(1)
  })
})
