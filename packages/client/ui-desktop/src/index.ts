/**
 * Host half of the desktop-surface preference plugin: the desktop
 * preferences are this entry's volatile configuration — what the window
 * close button does, and whether the app auto-starts hidden at login. The
 * Electron app shell reads the section through the settings service (the
 * close behavior at close-button time, the autostart on every commit) and
 * the browser rows in `./client` edit the same section; only the desktop
 * composition mounts this entry, so the web surface never sees these
 * preferences.
 * @module @deepseek-ai/dsh-client-ui-desktop
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
// Type-only: pulls the settings Context merge into this program.
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { DESKTOP_CLOSE_FIELD, DESKTOP_LAUNCH_FIELD } from './desktop-settings.ts'

export type { DesktopCloseAction, DesktopSettings } from './desktop-settings.ts'

/** The entry's live desktop preferences. */
export interface Config {
  /** What the window close button does; tray by default. */
  closeAction: Volatile<'tray' | 'quit'>
  /** Whether the OS launches the app at login, hidden to the tray; off by default. */
  launchAtLogin: Volatile<boolean>
}

/** The `ui-desktop` entry's configuration: the durable desktop section. */
export const Config = z.object({
  [DESKTOP_CLOSE_FIELD]: z.union(['tray', 'quit']).default('tray').volatile(),
  [DESKTOP_LAUNCH_FIELD]: z.boolean().default(false).volatile(),
})

/**
 * Keep this instance off the generated Settings pages: the browser rows in
 * `./client` render its section by hand as General-settings entries.
 * @param ctx - Host context whose optional settings service owns the page policy.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}
