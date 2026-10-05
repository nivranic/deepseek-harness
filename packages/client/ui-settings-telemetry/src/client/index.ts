/** Five-switch telemetry consent section registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { TelemetryConsent } from '@deepseek-ai/dsh-session-telemetry'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TelemetrySettingsSection, type TelemetrySettingsSectionInjected, type TelemetrySettingsSectionProps } from './TelemetrySettingsSection.tsx'
import { en, zh, type TelemetrySettingsLocaleKey } from './locales.ts'

export type { TelemetrySettingsSectionInjected, TelemetrySettingsSectionProps } from './TelemetrySettingsSection.tsx'
export type { TelemetrySettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Telemetry consent copy; one name and description key per data kind. */
    'settings.telemetry': TelemetrySettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.telemetry'

/**
 * Settings namespace the Host telemetry backend registers; absent when no
 * backend is composed, which keeps the section unregistered.
 */
const TELEMETRY_CONSENT_NAMESPACE = 'telemetry-consent'

/** When the Host owner applies committed consent changes, as the settings seam reports it. */
type SettingsNamespaceApplies = SettingsNamespaceView['applies']

/** Services required by the Settings registration and the settings scope service. */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Contribute the telemetry consent section. The contribution follows the
 * namespace in the settings describe mirror: registered only while a live Host
 * reports it, re-registered when its applies mode changes, withdrawn when it
 * disappears.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-telemetry: dictionaries')

  const t = ctx.locale.bind(NS)
  const describe = ctx.settingsScope.describe()
  const scope: SettingsScope<TelemetryConsent> = ctx.settingsScope.bind({ namespace: TELEMETRY_CONSENT_NAMESPACE })

  ctx.slots.inject('settings.section', () => {
    let remove: (() => void) | undefined
    let registered: 'absent' | SettingsNamespaceApplies = 'absent'
    const refresh = (): void => {
      const view = describe.getSnapshot().view?.namespaces.find(row => row.ns === TELEMETRY_CONSENT_NAMESPACE)
      const state: 'absent' | SettingsNamespaceApplies = view === undefined ? 'absent' : view.applies
      if (state === registered) return
      registered = state
      remove?.()
      remove = undefined
      if (view === undefined) return
      const injectFace: TelemetrySettingsSectionInjected = {
        applies: view.applies,
        hooks: { consent: scope },
        set: (kind, value) => scope.set(kind, value),
      }
      // A new component identity discards the previous document's gesture state.
      const TelemetryForDocument = (props: TelemetrySettingsSectionProps) => createElement(TelemetrySettingsSection, props)
      remove = ctx.slots.register({
        name: 'settings.section',
        id: 'telemetry',
        order: 20,
        label: () => t('nav'),
        locale: NS,
        inject: () => injectFace,
      }, TelemetryForDocument)
    }
    refresh()
    const stop = describe.subscribe(refresh)
    return () => { stop(); remove?.() }
  })
}
