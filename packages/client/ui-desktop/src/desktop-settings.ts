/** Desktop-surface preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the ui-desktop plugin. */
export const DESKTOP_SETTINGS_NAMESPACE = 'desktop'

/** Field carrying what the window close button does. */
export const DESKTOP_CLOSE_FIELD = 'closeAction'

/** Field carrying whether the app auto-starts hidden at OS login. */
export const DESKTOP_LAUNCH_FIELD = 'launchAtLogin'

/** What the desktop window's close button does. */
export type DesktopCloseAction = 'tray' | 'quit'

/** Durable desktop section shared by the Host schema and the browser scope. */
export interface DesktopSettings {
  /** What the close button does: hide to the system tray (the default) or quit. */
  closeAction: DesktopCloseAction
  /**
   * Whether the OS launches the app at login, hidden to the tray: every
   * process is then already warm, so revealing the window is instant instead
   * of paying the cold boot. Off by default — a login-time footprint is the
   * user's call, never ours.
   */
  launchAtLogin: boolean
}

/** Durable desktop schema; also the wire envelope the browser scope validates against. */
export const DesktopSettingsSchema: z<DesktopSettings> = z.object({
  [DESKTOP_CLOSE_FIELD]: z.union(['tray', 'quit']).default('tray'),
  [DESKTOP_LAUNCH_FIELD]: z.boolean().default(false),
})
