/** OS login registration is authoritative; the Shell keeps no mirrored preference. */
import type { App, LoginItemSettings, LoginItemSettingsOptions, Settings } from 'electron'

/** Native operations used by the login preference adapter. */
export interface DesktopLoginApplication {
  readonly isPackaged: App['isPackaged']
  getLoginItemSettings(options: LoginItemSettingsOptions): LoginItemSettings
  setLoginItemSettings(settings: Settings): void
}

/** Query and mutate only the packaged application's own login registration. */
export class DesktopLoginItem {
  private readonly options: LoginItemSettingsOptions

  /**
   * @param app - Native application owner.
   * @param executable - This application's executable; never a shell or external launcher.
   * @param platform - Native target, used to interpret OS registration results.
   */
  constructor(
    private readonly app: DesktopLoginApplication,
    executable: string,
    private readonly platform: NodeJS.Platform,
  ) {
    this.options = { path: executable, args: ['--hidden'] }
  }

  /** Whether this launch may read or change login registration. */
  get available(): boolean {
    return this.app.isPackaged && (this.platform === 'win32' || this.platform === 'darwin')
  }

  /** Whether the OS will start the application; development launches always return false. */
  get enabled(): boolean {
    if (!this.available) return false
    const state = this.app.getLoginItemSettings(this.options)
    return state.openAtLogin && (this.platform === 'win32'
      ? state.executableWillLaunchAtLogin : state.status === 'enabled')
  }

  /** Whether macOS identified this process as an automatic login launch. */
  get openedAtLogin(): boolean {
    return this.available && this.platform === 'darwin'
      && this.app.getLoginItemSettings(this.options).wasOpenedAtLogin
  }

  /**
   * Apply an explicit user choice and verify the operating system's resulting state.
   * @param enabled - Whether this application should start hidden at login.
   * @throws Error when registration is unavailable, denied, or requires OS approval.
   */
  setEnabled(enabled: boolean): void {
    if (!this.available) throw new Error('Login registration requires a packaged Windows or macOS application')
    this.app.setLoginItemSettings({
      ...this.options,
      openAtLogin: enabled,
      ...(this.platform === 'win32' ? { enabled } : {}),
    })
    if (this.enabled !== enabled) throw new Error('The operating system did not apply the login setting')
  }
}
