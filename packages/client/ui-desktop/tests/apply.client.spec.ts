/**
 * Registration: the General rows come from one apply, defer until the slot they
 * fill has been declared, bind the `desktop` settings namespace through the
 * shared scope service, and route their selects through the wire mutate path.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import type {
  CloseActionRowInjected, DeviceNameRowInjected, LaunchAtLoginRowInjected,
  RemoteDevicesRowInjected, RemoteToggleRowInjected,
} from '../src/client/index.ts'
import { DesktopSettingsSchema, DESKTOP_SETTINGS_NAMESPACE } from '../src/desktop-settings.ts'
import { REMOTE_SETTINGS_NAMESPACE } from '../src/remote-settings.ts'
import z from '@deepseek-ai/schemastery'

const RemoteSettingsTestSchema = z.object({
  enabled: z.boolean().default(false),
  allowRemoteApproval: z.boolean().default(false),
  deviceName: z.string().default('HOST-PC'),
})

function view(closeAction: 'tray' | 'quit', revision: number, launchAtLogin = false) {
  return {
    ns: DESKTOP_SETTINGS_NAMESPACE,
    schema: DesktopSettingsSchema.toJSON(),
    value: { closeAction, launchAtLogin },
    applies: 'live' as const,
    secrets: [],
    revision,
  }
}

function remoteView(enabled: boolean, revision: number) {
  return {
    ns: REMOTE_SETTINGS_NAMESPACE,
    schema: RemoteSettingsTestSchema.toJSON(),
    value: { enabled, allowRemoteApproval: false, deviceName: 'HOST-PC' },
    applies: 'live' as const,
    secrets: [],
    revision,
  }
}

async function bench() {
  const ctx = new Context()
  const mutate = vi.fn()
  const link = {
    status: vi.fn((): Promise<
      | { ok: true; value: { listening: boolean; endpoint: string; hostName: string; allowRemoteApproval: boolean; deviceCount: number } }
      | { ok: false; error: { code: string; message: string; details: Record<string, never> } }
    > => Promise.resolve({ ok: true as const, value: {
      listening: true, endpoint: 'https://192.168.1.4:4931', hostName: 'HOST-PC',
      allowRemoteApproval: false, deviceCount: 1,
    } })),
    createPairing: vi.fn(() => Promise.resolve({ ok: true as const, value: {
      v: 1 as const, kind: 'dsh-link-pairing' as const, hostId: 'host-1', hostName: 'HOST-PC',
      endpoint: 'https://192.168.1.4:4931', spkiFingerprint: 'ab'.repeat(32),
      code: 'pair-once', expiresAt: 1_800_000_000_000,
    } })),
    devices: vi.fn(() => Promise.resolve({ ok: true as const, value: [
      { deviceId: 'device-1', name: 'iPhone', role: 'controller' as const, createdAt: 100, lastSeenAt: 200 },
    ] })),
    revokeDevice: vi.fn((deviceId: string) => Promise.resolve({ ok: true as const, value: {
      deviceId, name: 'iPhone', role: 'controller' as const, createdAt: 100, revokedAt: 500,
    } })),
  }
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  ctx.provide('connection', { isLoopback: true } as never)
  new TestRemote(ctx, {
    settings: {
      describe: () => Promise.resolve({
        ok: true as const,
        value: { writable: true, hasDocument: true, namespaces: [view('tray', 1), remoteView(false, 7)] },
      }),
      mutate: (...args: unknown[]) => {
        mutate(...args)
        const [ns] = args as [string]
        const next = ns === REMOTE_SETTINGS_NAMESPACE ? remoteView(true, 7) : view('quit', 2)
        return Promise.resolve({ ok: true as const, value: next })
      },
    },
    link,
  })
  ctx.get('slots')!.register({
    name: 'root',
    children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { ctx, locale, mutate, link }
}

/** Every row's inject face, as the renderer would materialize them. */
async function rowFaces() {
  const { ctx, locale, mutate, link } = await bench()
  const entries = (ctx.get('slots')!).entries('settings.general.item')
  expect(entries).toHaveLength(6)
  const byId = (id: string) => entries.find(candidate => candidate.options.id === id)!
  expect(byId('desktop-close').options.order).toBe(10)
  expect(byId('desktop-launch-at-login').options.order).toBe(11)
  expect(byId('desktop-remote-access').options.order).toBe(12)
  expect(byId('desktop-remote-approval').options.order).toBe(13)
  expect(byId('desktop-remote-device-name').options.order).toBe(14)
  expect(byId('desktop-remote-devices').options.order).toBe(15)
  const closeFace = (byId('desktop-close').inject as unknown as () => CloseActionRowInjected)()
  const launchFace = (byId('desktop-launch-at-login').inject as unknown as () => LaunchAtLoginRowInjected)()
  const accessFace = (byId('desktop-remote-access').inject as unknown as () => RemoteToggleRowInjected)()
  const approvalFace = (byId('desktop-remote-approval').inject as unknown as () => RemoteToggleRowInjected)()
  const deviceNameFace = (byId('desktop-remote-device-name').inject as unknown as () => DeviceNameRowInjected)()
  const devicesFace = (byId('desktop-remote-devices').inject as unknown as () => RemoteDevicesRowInjected)()
  return { ctx, locale, mutate, link, closeFace, launchFace, accessFace, approvalFace, deviceNameFace, devicesFace }
}

describe('ui-desktop apply', () => {
  it('registers the zh dictionaries under its own namespace', async () => {
    const { locale } = await rowFaces()
    expect(locale.bind('settings.desktop')('title')).toBe('关闭窗口时')
    expect(locale.bind('settings.desktop')('launchTitle')).toBe('开机自启')
    expect(locale.bind('settings.desktop')('accessTitle')).toBe('跨设备访问')
    expect(locale.bind('settings.desktop')('devicesTitle')).toBe('受信设备')
  })

  it('derives the bound scope from the shared describe mirror and writes through mutate', async () => {
    const { closeFace, mutate } = await rowFaces()
    await vi.waitFor(() => { expect(closeFace.hooks.desktopClose.getSnapshot().status).toBe('ready') })
    const snapshot = closeFace.hooks.desktopClose.getSnapshot()
    expect(snapshot.value).toEqual({ closeAction: 'tray', launchAtLogin: false })
    expect(snapshot.writable).toBe(true)
    closeFace.select('quit')
    await vi.waitFor(() => {
      expect(closeFace.hooks.desktopClose.getSnapshot().value).toEqual({ closeAction: 'quit', launchAtLogin: false })
    })
    expect(mutate).toHaveBeenCalledWith(
      DESKTOP_SETTINGS_NAMESPACE,
      [{ op: 'set', path: ['closeAction'], value: 'quit' }],
      1,
    )
  })

  it('binds the remote rows to the bridge namespace and writes through mutate', async () => {
    const { accessFace, approvalFace, deviceNameFace, mutate } = await rowFaces()
    await vi.waitFor(() => { expect(accessFace.hooks.remote.getSnapshot().status).toBe('ready') })
    expect(accessFace.hooks.remote.getSnapshot().value)
      .toEqual({ enabled: false, allowRemoteApproval: false, deviceName: 'HOST-PC' })
    expect(accessFace.field).toBe('enabled')
    expect(approvalFace.field).toBe('allowRemoteApproval')
    accessFace.select(true)
    approvalFace.select(true)
    deviceNameFace.commit('Studio Desk')
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledTimes(3) })
    expect(mutate).toHaveBeenCalledWith(
      REMOTE_SETTINGS_NAMESPACE,
      [{ op: 'set', path: ['enabled'], value: true }],
      7,
    )
    expect(mutate).toHaveBeenCalledWith(
      REMOTE_SETTINGS_NAMESPACE,
      [{ op: 'set', path: ['allowRemoteApproval'], value: true }],
      7,
    )
    expect(mutate).toHaveBeenCalledWith(
      REMOTE_SETTINGS_NAMESPACE,
      [{ op: 'set', path: ['deviceName'], value: 'Studio Desk' }],
      7,
    )
  })

  it('wires the devices row to the link Remote API, unwrapping results and failures', async () => {
    const { devicesFace, link } = await rowFaces()
    await expect(devicesFace.api.status()).resolves.toMatchObject({ listening: true })
    await expect(devicesFace.api.createPairing()).resolves.toMatchObject({ code: 'pair-once' })
    await expect(devicesFace.api.devices()).resolves.toHaveLength(1)
    await expect(devicesFace.api.revokeDevice('device-1')).resolves.toMatchObject({ revokedAt: 500 })
    expect(link.revokeDevice).toHaveBeenCalledWith('device-1')
    link.status.mockImplementationOnce(() => Promise.resolve({
      ok: false as const, error: { code: 'link-unavailable', message: 'no carrier', details: {} },
    }))
    await expect(devicesFace.api.status()).rejects.toThrow('no carrier')
  })

  it('binds the launch row to the same namespace and writes the boolean through mutate', async () => {
    const { launchFace, mutate } = await rowFaces()
    await vi.waitFor(() => { expect(launchFace.hooks.desktopLaunch.getSnapshot().status).toBe('ready') })
    expect(launchFace.hooks.desktopLaunch.getSnapshot().value).toEqual({ closeAction: 'tray', launchAtLogin: false })
    launchFace.select(true)
    await vi.waitFor(() => {
      expect(launchFace.hooks.desktopLaunch.getSnapshot().value).toEqual({ closeAction: 'quit', launchAtLogin: false })
    })
    expect(mutate).toHaveBeenCalledWith(
      DESKTOP_SETTINGS_NAMESPACE,
      [{ op: 'set', path: ['launchAtLogin'], value: true }],
      1,
    )
  })
})
