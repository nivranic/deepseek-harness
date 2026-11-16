/** Tray ownership and preference commits outside the Host and application renderer. */
import type { DesktopShellPreferences } from './shell-preferences.ts'

/** Window operations needed by the native close-button adapter. */
export interface DesktopTrayWindow {
  hide(): void
}

/** Resource released after the Shell stops accepting work. */
export interface DesktopTrayHandle {
  destroy(): void
  isDestroyed(): boolean
}

/** Native effects supplied by the Electron application owner. */
export interface DesktopShellEffects {
  /** Create a tray with working restore and quit actions before returning. */
  createTray(): DesktopTrayHandle
  /** Reveal the primary window before removing its restore affordance. */
  reveal(): void
  /** Present a tray failure while the ordinary window-close behavior remains available. */
  reportTrayFailure(error: unknown): void
}

/** Preserve a restore affordance for hidden windows and join preference writes on exit. */
export class DesktopShellBehavior {
  private tray: DesktopTrayHandle | undefined
  private closing = false

  /**
   * @param preferences - Serialized Shell preference owner.
   * @param effects - Native tray and window operations.
   */
  constructor(
    private readonly preferences: DesktopShellPreferences,
    private readonly effects: DesktopShellEffects,
  ) {}

  /** Current persisted close preference. */
  get closeToTray(): boolean { return this.preferences.closeToTray }

  /** @returns Completion of writes admitted before an installer takes ownership of application exit. */
  flush(): Promise<void> { return this.preferences.flush() }

  /**
   * Require a working tray before enabling background close behavior.
   * @param enabled - Requested preference.
   * @returns Completion of persistence and native affordance reconciliation.
   */
  async setCloseToTray(enabled: boolean): Promise<void> {
    if (this.closing) throw new Error('Desktop Shell is closing')
    if (enabled) this.ensureTray()
    await this.preferences.setCloseToTray(enabled)
    // Shutdown can begin while the preference replacement is pending.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!this.closing && !this.preferences.closeToTray) {
      this.effects.reveal()
      this.destroyTray()
    }
  }

  /**
   * Intercept an ordinary close only when a working tray can restore the window.
   * @param event - Cancellable Electron window-close event.
   * @param window - Primary application window.
   */
  closeWindow(event: { preventDefault(): void }, window: DesktopTrayWindow): void {
    if (this.closing || !this.preferences.closeToTray) return
    this.hideWindow(event, window)
  }

  /**
   * Hide a login-started application only after providing restore and quit actions.
   * @param window - Window that remains visible when tray creation fails.
   * @returns Whether the window was hidden.
   */
  hideAtLogin(window: DesktopTrayWindow): boolean {
    if (this.closing) return false
    return this.hideWindow(undefined, window)
  }

  /** @returns Completion of admitted preference writes and tray destruction. */
  async close(): Promise<void> {
    this.closing = true
    await this.preferences.close()
    this.destroyTray()
  }

  private hideWindow(event: { preventDefault(): void } | undefined, window: DesktopTrayWindow): boolean {
    try {
      this.ensureTray()
    } catch (error) {
      this.effects.reportTrayFailure(error)
      return false
    }
    event?.preventDefault()
    window.hide()
    return true
  }

  private ensureTray(): void {
    if (this.tray === undefined || this.tray.isDestroyed()) this.tray = this.effects.createTray()
  }

  private destroyTray(): void {
    const tray = this.tray
    this.tray = undefined
    if (tray !== undefined && !tray.isDestroyed()) tray.destroy()
  }
}
