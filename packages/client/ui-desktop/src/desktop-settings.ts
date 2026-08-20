/** Desktop-surface preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the ui-desktop plugin. */
export const DESKTOP_SETTINGS_NAMESPACE = 'desktop'

/** Field carrying what the window close button does. */
export const DESKTOP_CLOSE_FIELD = 'closeAction'

/** What the desktop window's close button does. */
export type DesktopCloseAction = 'tray' | 'quit'

/** Durable desktop section shared by the Host schema and the browser scope. */
export interface DesktopSettings {
  /** What the close button does: hide to the system tray (the default) or quit. */
  closeAction: DesktopCloseAction
}

/** Durable desktop schema; also the wire envelope the browser scope validates against. */
export const DesktopSettingsSchema: z<DesktopSettings> = z.object({
  [DESKTOP_CLOSE_FIELD]: z.union(['tray', 'quit']).default('tray'),
})
