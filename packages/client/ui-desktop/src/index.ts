/**
 * Host half of the desktop-surface preference plugin: it registers the
 * `desktop` settings namespace carrying the close-button behavior. The
 * Electron app shell reads the namespace through the settings service at
 * close-button time; only the desktop composition mounts this row, so the
 * web surface never registers the namespace and never shows its preference.
 * @module @deepseek-ai/dsh-client-ui-desktop
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { DESKTOP_SETTINGS_NAMESPACE, DesktopSettingsSchema } from './desktop-settings.ts'

export type { DesktopCloseAction, DesktopSettings } from './desktop-settings.ts'

/**
 * Register the durable desktop section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(DESKTOP_SETTINGS_NAMESPACE),
      DesktopSettingsSchema,
    )
  })
}
