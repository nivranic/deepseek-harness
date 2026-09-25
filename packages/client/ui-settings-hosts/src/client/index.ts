/** Saved-Host roster section registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createElement } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { HostsSettingsSection, type HostsSettingsSectionInjected, type HostsSettingsSectionProps } from './HostsSettingsSection.tsx'
import { en, zh, type HostsLocaleKey } from './locales.ts'

export type { HostsSettingsSectionInjected, HostsSettingsSectionProps } from './HostsSettingsSection.tsx'
export type { HostsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Saved-Host roster copy. */
    'settings.hosts': HostsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.hosts'

/** Services required by the Settings registration. */
export const inject = ['slots', 'locale', 'connection']

/** Contribute the saved-Host roster section to Settings. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-hosts: dictionaries')

  const t = ctx.locale.bind(NS)
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.slots.inject('settings.section', () => {
    const injectFace: HostsSettingsSectionInjected = {
      hooks: {
        savedHosts: {
          getSnapshot: () => connection.savedHosts.list(),
          subscribe: listener => connection.savedHosts.subscribe(listener),
        },
        selectedOrigin: connection.target,
      },
      pageOrigin: typeof location === 'undefined' ? undefined : location.origin,
      switchTo: hostId => connection.selectSavedHost(hostId),
      useLocalHost: () => { connection.usePageHost() },
      forget: (hostId) => { connection.forgetSavedHost(hostId) },
      formatTime: epochMs => new Intl.DateTimeFormat(ctx.locale.getSnapshot().active, { dateStyle: 'medium', timeStyle: 'short' }).format(epochMs),
    }
    // Keep the component identity stable across Slot renders.
    const HostsSection = (props: HostsSettingsSectionProps) => createElement(HostsSettingsSection, props)
    return ctx.slots.register({
      name: 'settings.section',
      id: 'hosts',
      order: 15,
      label: () => t('nav'),
      locale: NS,
      inject: (): HostsSettingsSectionInjected => injectFace,
    }, HostsSection)
  })
}
