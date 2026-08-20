/**
 * Desktop-surface preference plugin, browser half: the General-settings row
 * choosing what the window's close button does (hide to the system tray, or
 * quit), written to the `desktop` settings namespace the host half registers.
 * Only the desktop composition composes this row, so the web surface never
 * sees it — composition is the surface gate, never a runtime fact.
 * Export discipline: packages/client/AGENTS.md.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls ctx.locale and ctx.settingsScope Context merges into this
// program. Cross-plugin collaboration goes through the service, never a value
// import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { CloseActionRow } from './CloseActionRow.tsx'
import type { CloseActionRowInjected } from './CloseActionRow.tsx'
import { DESKTOP_CLOSE_FIELD, DESKTOP_SETTINGS_NAMESPACE, type DesktopSettings } from '../desktop-settings.ts'
import { en, zh } from './locales.ts'

export type { CloseActionRowComponentProps, CloseActionRowInjected } from './CloseActionRow.tsx'
export type { DesktopSettingsKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.desktop'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Register the `settings.desktop` dictionaries and the General-section row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-desktop: dictionaries')
  // The scope derives from the shared describe mirror; the row re-renders on
  // every commit (its own write, an external settings edit, a reconnect).
  const scope = ctx.settingsScope.bind<DesktopSettings>({ namespace: DESKTOP_SETTINGS_NAMESPACE })
  const injected = (): CloseActionRowInjected => ({
    hooks: { desktopClose: scope },
    select: (value) => { void scope.set(DESKTOP_CLOSE_FIELD, value) },
  })
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-close',
    order: 10,
    locale: NS,
    inject: injected,
  }, CloseActionRow))
}
