/** Saved-Host roster section registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createElement } from 'react'
import type { ConnectionHandle, SavedHost } from '@deepseek-ai/dsh-client-connection/client'
import { browserSelectedHostPersistence, switchToSavedHost } from '@deepseek-ai/dsh-client-connection/client'
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
  const selectedHostPersistence = browserSelectedHostPersistence()
  ctx.slots.inject('settings.section', () => {
    const injectFace: HostsSettingsSectionInjected = {
      rows: () => connection.savedHosts.list(),
      selectedOrigin: () => connection.targetOrigin(),
      switchTo: (hostId: string): SavedHost | undefined => {
        const row = switchToSavedHost(connection, hostId)
        if (row !== undefined) selectedHostPersistence?.write(hostId)
        return row
      },
      useLocalHost: () => {
        connection.retarget(undefined)
        selectedHostPersistence?.clear()
      },
      forget: (hostId: string) => { connection.savedHosts.remove(hostId) },
      subscribe: listener => connection.savedHosts.subscribe(listener),
      formatTime: epochMs => new Intl.DateTimeFormat(ctx.locale.getSnapshot().active, { dateStyle: 'medium', timeStyle: 'short' }).format(epochMs),
    }
    // A stable component identity keeps roster state across re-renders; the
    // live readers above re-read on every notification or refresh click.
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
