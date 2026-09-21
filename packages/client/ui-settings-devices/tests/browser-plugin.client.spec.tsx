// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { RemoteError, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import type { DevicesSettingsSectionInjected } from '../src/client/DevicesSettingsSection.tsx'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const EMPTY: readonly unknown[] = []
type ListResult =
  | { readonly ok: true; readonly value: typeof EMPTY }
  | { readonly ok: false; readonly error: RemoteError }
type MutationResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: RemoteError }

async function bench(capabilities: string[] = ['device.list.v1']) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const listeners = new Set<() => void>()
  ctx.provide('connection', { generation: { subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  } } })
  class RemoteService extends Service {
    $host = { home: undefined, isLoopback: true, capabilities }
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  const remote = new RemoteService(ctx)
  const list = vi.fn<() => Promise<ListResult>>().mockResolvedValue({ ok: true, value: EMPTY })
  const rename = vi.fn<(request: { deviceId: string; deviceName: string }) => Promise<MutationResult>>()
    .mockResolvedValue({ ok: true, value: undefined })
  const revoke = vi.fn<(request: { deviceId: string }) => Promise<MutationResult>>()
    .mockResolvedValue({ ok: true, value: undefined })
  const revokeAll = vi.fn<() => Promise<MutationResult>>()
    .mockResolvedValue({ ok: true, value: { revokedAt: 1, count: 2 } })
  ctx.provide('remote.deviceTrust', {
    listDevices: list,
    renameDevice: rename,
    revokeDevice: revoke,
    revokeAllDevices: revokeAll,
  })
  const replace = (next = capabilities) => {
    remote.$host = { ...remote.$host, capabilities: next }
    for (const listener of listeners) listener()
  }
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, list, rename, revoke, revokeAll, replace, listeners }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-devices browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services used by the Settings Remote contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.deviceTrust', 'connection'])
  })

  it('registers a localized section without reading the Remote eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).not.toBeUndefined()
    expect(entry.options).toMatchObject({ id: 'devices', order: 10 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('设备')
    expect(b.list).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => DevicesSettingsSectionInjected)()
    await expect(injected.list()).resolves.toEqual(EMPTY)
    expect(b.list).toHaveBeenCalledOnce()
    await expect(injected.revokeAll()).resolves.toBe(2)
    expect(b.revokeAll).toHaveBeenCalledOnce()
    await injected.rename('d-1' as never, 'Pixel 9')
    expect(b.rename).toHaveBeenCalledWith({ deviceId: 'd-1', deviceName: 'Pixel 9' })
    await injected.revoke('d-2' as never)
    expect(b.revoke).toHaveBeenCalledWith({ deviceId: 'd-2' })
    // A newer Host may return a code absent from this Client's declaration map.
    const failure = new RemoteError('future/device-gone' as never, 'unavailable', {} as never)
    b.list.mockResolvedValueOnce({ ok: false, error: failure })
    await expect(injected.list()).rejects.toBe(failure)
    await b.ctx.fiber.dispose()
  })

  it('formats timestamps under the active locale', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const injected = (entry.inject as unknown as () => DevicesSettingsSectionInjected)()
    expect(injected.formatTime(0)).toBe(new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(0))
    b.locale.setLocale('en')
    expect(injected.formatTime(0)).toBe(new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(0))
    await b.ctx.fiber.dispose()
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Devices')

    stop()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.section')[0]?.component).not.toBeUndefined()
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})

it('withdraws the section and in-flight read immediately, rejecting retained callbacks on restoration', async () => {
  const b = await bench([])
  declare(b.slots)
  const fiber = b.ctx.plugin({ inject: [...inject], apply })
  await fiber
  expect(b.slots.entries('settings.section')).toHaveLength(0)
  expect(b.list).not.toHaveBeenCalled()
  b.replace(['device.list.v1'])
  const first = b.slots.entries('settings.section')[0]!
  const injected = (first.inject as unknown as () => DevicesSettingsSectionInjected)()
  const gate = Promise.withResolvers<ListResult>()
  b.list.mockReturnValueOnce(gate.promise)
  const pending = injected.list()
  b.replace([])
  expect(b.slots.entries('settings.section')).toHaveLength(0)
  b.replace(['device.list.v1'])
  const second = b.slots.entries('settings.section')[0]!
  expect(second.component).not.toBe(first.component)
  const next = (second.inject as unknown as () => DevicesSettingsSectionInjected)()
  await expect(next.list()).resolves.toEqual(EMPTY)
  gate.resolve({ ok: true, value: EMPTY })
  await expect(pending).rejects.toThrow('connection changed')
  await expect(injected.revokeAll()).rejects.toThrow('connection changed')
  expect(b.revokeAll).not.toHaveBeenCalled()
  expect(b.list).toHaveBeenCalledTimes(2)
  await fiber.dispose()
  expect(b.listeners.size).toBe(0)
  await expect(next.list()).rejects.toThrow('connection changed')
  expect(b.list).toHaveBeenCalledTimes(2)
  await b.ctx.fiber.dispose()
})

it('contains an old read failure after replacement with identical capability support', async () => {
  const b = await bench()
  declare(b.slots)
  await b.ctx.plugin({ inject: [...inject], apply })
  const entry = b.slots.entries('settings.section')[0]!
  const old = (entry.inject as unknown as () => DevicesSettingsSectionInjected)()
  const gate = Promise.withResolvers<ListResult>()
  b.list.mockReturnValueOnce(gate.promise)
  const pending = old.list()
  b.replace()
  const replacement = b.slots.entries('settings.section')[0]!
  expect(replacement.component).not.toBe(entry.component)
  gate.reject(new Error('old transport failure'))
  await expect(pending).rejects.toThrow('connection changed')
  await b.ctx.fiber.dispose()
})
