/** Paired-device management section registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createElement } from 'react'
import type { DeviceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { DevicesSettingsSection, type DevicesSettingsSectionInjected, type DevicesSettingsSectionProps } from './DevicesSettingsSection.tsx'
import { en, zh, type DevicesLocaleKey } from './locales.ts'

export type { DevicesSettingsSectionInjected, DevicesSettingsSectionProps } from './DevicesSettingsSection.tsx'
export type { DevicesLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Paired-device management copy. */
    'settings.devices': DevicesLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.devices'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.deviceTrust', 'connection']

/** Contribute the Devices management section to Settings. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-devices: dictionaries')

  const t = ctx.locale.bind(NS)
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.slots.inject('settings.section', () => {
    let remove: (() => void) | undefined
    const refresh = (): void => {
      remove?.()
      remove = undefined
      const host = ctx.remote.$host
      if (host.capabilities?.includes('device.list.v1') !== true) return
      const controller = new AbortController()
      const current = (): boolean => !controller.signal.aborted && ctx.remote.$host === host
      const changed = (): Error => new Error('deviceTrust: connection changed')
      // One Remote call guarded on both ends of the await: a generation
      // change mid-flight (or its transport failure) surfaces as `changed`.
      const settle = async <T>(run: () => Promise<RemoteResult<T>>): Promise<T> => {
        if (!current()) throw changed()
        let result: RemoteResult<T>
        try {
          result = await run()
        } catch (error) {
          if (!current()) throw changed()
          throw error
        }
        if (!current()) throw changed()
        if (!result.ok) throw result.error
        return result.value
      }
      const injectFace: DevicesSettingsSectionInjected = {
        list: () => settle(() => ctx.remote.deviceTrust.listDevices()),
        rename: async (deviceId: DeviceId, deviceName: string) => {
          await settle(() => ctx.remote.deviceTrust.renameDevice({ deviceId, deviceName }))
        },
        revoke: async (deviceId: DeviceId) => {
          await settle(() => ctx.remote.deviceTrust.revokeDevice({ deviceId }))
        },
        revokeAll: async () => (await settle(ctx.remote.deviceTrust.revokeAllDevices)).count,
        formatTime: epochMs => new Intl.DateTimeFormat(ctx.locale.getSnapshot().active, { dateStyle: 'medium', timeStyle: 'short' }).format(epochMs),
      }
      // A new component identity discards the previous Host's list and row state.
      const DevicesForConnection = (props: DevicesSettingsSectionProps) => createElement(DevicesSettingsSection, props)
      const unregister = ctx.slots.register({
        name: 'settings.section',
        id: 'devices',
        order: 10,
        label: () => t('nav'),
        locale: NS,
        inject: (): DevicesSettingsSectionInjected => injectFace,
      }, DevicesForConnection)
      remove = () => { controller.abort(); unregister() }
    }
    refresh()
    const stop = connection.generation.subscribe(refresh)
    return () => { stop(); remove?.() }
  })
}
