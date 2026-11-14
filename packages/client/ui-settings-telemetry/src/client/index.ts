/** Five-switch telemetry consent section registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TelemetrySettingsSection, type TelemetrySettingsSectionInjected, type TelemetrySettingsValue } from './TelemetrySettingsSection.tsx'
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
const NS = 'settings.telemetry'

/**
 * Loader entry owned by the telemetry backend in the shipped profiles.
 */
const TELEMETRY_ENTRY = 'session-telemetry-otel'

/** Services required by the Settings registration and shared configuration forms. */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Contribute the telemetry consent section. The contribution follows the
 * backend entry in the shared settings mirror and disappears when that entry
 * is no longer exposed.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-telemetry: dictionaries')

  const t = ctx.locale.bind(NS)
  const form = ctx.configForms.get<TelemetrySettingsValue>(TELEMETRY_ENTRY)
  const face: TelemetrySettingsSectionInjected = {
    hooks: { consent: form },
    set: (kind, value) => form.mutate([{ op: 'set', path: ['consent', kind], value }]),
  }
  ctx.effect(() => ctx.configForms.whileServed([TELEMETRY_ENTRY], () => ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'telemetry',
      order: 21,
      label: () => t('nav'),
      locale: NS,
      inject: () => face,
    }, TelemetrySettingsSection))), 'ui-settings-telemetry: section')
}
