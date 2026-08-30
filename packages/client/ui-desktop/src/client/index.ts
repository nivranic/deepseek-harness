/**
 * Desktop-surface preference plugin, browser half: the General-settings rows
 * choosing what the window close button does (hide to the system tray, or
 * quit) and whether the app auto-starts hidden at login, written to the
 * `desktop` settings namespace the host half registers. Only the desktop
 * composition composes these rows, so the web surface never sees them —
 * composition is the surface gate, never a runtime fact.
 * Export discipline: packages/client/AGENTS.md.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls ctx.locale, ctx.slots, and ctx.settingsScope Context merges
// into this program. Cross-plugin collaboration goes through the service,
// never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the slots Context merge the injected registry reads.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the remote.link Context merge the devices block calls through.
import type {} from '@deepseek-ai/dsh-api-remotes/types'
import { CloseActionRow } from './CloseActionRow.tsx'
import type { CloseActionRowInjected } from './CloseActionRow.tsx'
import { DeviceNameRow } from './DeviceNameRow.tsx'
import type { DeviceNameRowInjected } from './DeviceNameRow.tsx'
import { LaunchAtLoginRow } from './LaunchAtLoginRow.tsx'
import type { LaunchAtLoginRowInjected } from './LaunchAtLoginRow.tsx'
import { RemoteDevicesRow } from './RemoteDevicesRow.tsx'
import type { LinkAdminApi, RemoteDevicesRowInjected } from './RemoteDevicesRow.tsx'
import { RemoteToggleRow } from './RemoteToggleRow.tsx'
import type { RemoteToggleRowInjected } from './RemoteToggleRow.tsx'
import {
  DESKTOP_CLOSE_FIELD, DESKTOP_LAUNCH_FIELD, DESKTOP_SETTINGS_NAMESPACE, type DesktopSettings,
} from '../desktop-settings.ts'
import {
  REMOTE_APPROVAL_FIELD, REMOTE_DEVICE_NAME_FIELD, REMOTE_ENABLED_FIELD,
  REMOTE_SETTINGS_NAMESPACE, type RemoteSettings,
} from '../remote-settings.ts'
import { en, zh } from './locales.ts'

export type { CloseActionRowComponentProps, CloseActionRowInjected } from './CloseActionRow.tsx'
export type { DeviceNameRowComponentProps, DeviceNameRowInjected } from './DeviceNameRow.tsx'
export type { LaunchAtLoginRowComponentProps, LaunchAtLoginRowInjected } from './LaunchAtLoginRow.tsx'
export type { LinkAdminApi, RemoteDevicesRowComponentProps, RemoteDevicesRowInjected } from './RemoteDevicesRow.tsx'
export type { RemoteToggleRowComponentProps, RemoteToggleRowInjected } from './RemoteToggleRow.tsx'
export type { DesktopSettingsKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.desktop'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'settingsScope', 'remote', 'remote.link']

/**
 * Register the `settings.desktop` dictionaries and the General-section rows.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-desktop: dictionaries')
  // The scope derives from the shared describe mirror; each row re-renders on
  // every commit (its own write, an external settings edit, a reconnect).
  const scope = ctx.settingsScope.bind<DesktopSettings>({ namespace: DESKTOP_SETTINGS_NAMESPACE })
  const injectedClose = (): CloseActionRowInjected => ({
    hooks: { desktopClose: scope },
    select: (value) => { void scope.set(DESKTOP_CLOSE_FIELD, value) },
  })
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-close',
    order: 10,
    locale: NS,
    inject: injectedClose,
  }, CloseActionRow))
  const injectedLaunch = (): LaunchAtLoginRowInjected => ({
    hooks: { desktopLaunch: scope },
    select: (value) => { void scope.set(DESKTOP_LAUNCH_FIELD, value) },
  })
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-launch-at-login',
    order: 11,
    locale: NS,
    inject: injectedLaunch,
  }, LaunchAtLoginRow))

  // The cross-device rows bind the `remote` namespace the link-settings
  // bridge owns on the host; the link Remote API carries the admin calls.
  const remoteScope = ctx.settingsScope.bind<RemoteSettings>({ namespace: REMOTE_SETTINGS_NAMESPACE })
  const injectedAccess = (): RemoteToggleRowInjected => ({
    hooks: { remote: remoteScope },
    field: REMOTE_ENABLED_FIELD,
    titleKey: 'accessTitle',
    descriptionKey: 'accessDescription',
    select: (value) => { void remoteScope.set(REMOTE_ENABLED_FIELD, value) },
  })
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-remote-access',
    order: 12,
    locale: NS,
    inject: injectedAccess,
  }, RemoteToggleRow))
  const injectedApproval = (): RemoteToggleRowInjected => ({
    hooks: { remote: remoteScope },
    field: REMOTE_APPROVAL_FIELD,
    titleKey: 'approvalTitle',
    descriptionKey: 'approvalDescription',
    select: (value) => { void remoteScope.set(REMOTE_APPROVAL_FIELD, value) },
  })
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-remote-approval',
    order: 13,
    locale: NS,
    inject: injectedApproval,
  }, RemoteToggleRow))
  const injectedDeviceName = (): DeviceNameRowInjected => ({
    hooks: { remote: remoteScope },
    titleKey: 'deviceNameTitle',
    descriptionKey: 'deviceNameDescription',
    placeholderKey: 'deviceNamePlaceholder',
    commit: (value) => { void remoteScope.set(REMOTE_DEVICE_NAME_FIELD, value) },
  })
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-remote-device-name',
    order: 14,
    locale: NS,
    inject: injectedDeviceName,
  }, DeviceNameRow))
  // The generated client answers `RemoteResult`; the row wants values or a
  // rejection, so each call unwraps the failure into a thrown Error.
  const unwrap = <T>(call: () => Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>): Promise<T> =>
    call().then((response) => {
      if (response.ok) return response.value
      throw new Error(response.error.message)
    })
  const linkApi: LinkAdminApi = {
    status: () => unwrap(() => ctx.remote.link.status()),
    createPairing: () => unwrap(() => ctx.remote.link.createPairing()),
    devices: () => unwrap(() => ctx.remote.link.devices()),
    revokeDevice: deviceId => unwrap(() => ctx.remote.link.revokeDevice(deviceId)),
  }
  const injectedDevices = (): RemoteDevicesRowInjected => ({
    hooks: { remote: remoteScope },
    api: linkApi,
  })
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-remote-devices',
    order: 15,
    locale: NS,
    inject: injectedDevices,
  }, RemoteDevicesRow))
}
