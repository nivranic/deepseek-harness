/** Browser-local Host bookmarks discovered through the current Host description. */
import type { Context } from '@deepseek-ai/cordis'
import type { HostId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { HostsSettingsSection, type HostsSettingsSectionInjected } from './HostsSettingsSection.tsx'
import { SavedHostsStore, browserSavedHostsPersistence } from './saved-hosts.ts'
import { en, zh, type HostsLocaleKey } from './locales.ts'

export type { HostsSettingsSectionInjected, HostsSettingsSectionProps } from './HostsSettingsSection.tsx'
export type { SavedHost } from './saved-hosts.ts'
export type { HostsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Host bookmark copy. */
    'settings.hosts': HostsLocaleKey
  }
}

const NS = 'settings.hosts'

/** Services for Host discovery and bookmark presentation. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.host']

/** Register Host bookmarks and refresh the current identity after connection changes.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-hosts: dictionaries')
  const t = ctx.locale.bind(NS)
  const connection = ctx.get('connection') as ConnectionHandle
  const roster = new SavedHostsStore(browserSavedHostsPersistence())
  const pageOrigin = typeof location === 'undefined' ? undefined : location.origin
  let currentHost: HostId | undefined
  const listeners = new Set<() => void>()
  const publish = (id: HostId | undefined): void => {
    if (currentHost === id) return
    currentHost = id
    for (const listener of listeners) listener()
  }
  ctx.effect(() => {
    let lifetime: AbortController | undefined
    const refresh = async (): Promise<void> => {
      lifetime?.abort()
      const controller = new AbortController()
      lifetime = controller
      publish(undefined)
      let result: Awaited<ReturnType<typeof ctx.remote.host.describe>>
      try {
        result = await ctx.remote.host.describe()
      } catch (_unavailable) {
        // Bookmarks remain readable while the current Host identity is unconfirmed.
        return
      }
      if (controller.signal.aborted || !result.ok) return
      const host = result.value
      publish(host.hostId)
      if (pageOrigin === undefined) return
      roster.record({
        hostId: host.hostId, displayName: host.displayName, platform: host.platform,
        origin: pageOrigin, lastConnectedAt: Date.now(),
      })
    }
    const refreshNow = (): void => { void refresh() }
    refreshNow()
    const stop = connection.generation.subscribe(refreshNow)
    return () => { stop(); lifetime?.abort(); listeners.clear() }
  }, 'ui-settings-hosts: discovery')
  const face: HostsSettingsSectionInjected = {
    hooks: {
      savedHosts: { getSnapshot: () => roster.list(), subscribe: listener => roster.subscribe(listener) },
      currentHostId: {
        getSnapshot: () => currentHost,
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
    },
    pageOrigin,
    forget: (hostId) => { roster.remove(hostId) },
    rename: (hostId, customName) => { roster.rename(hostId, customName) },
    move: (hostId, direction) => { roster.moveHost(hostId, direction) },
    formatTime: epochMs => new Intl.DateTimeFormat(ctx.locale.getSnapshot().active,
      { dateStyle: 'medium', timeStyle: 'short' }).format(epochMs),
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'hosts', order: 16, label: () => t('nav'), locale: NS, inject: () => face,
  }, HostsSettingsSection))
}
