// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { RemoteError, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import type { PluginInventorySettingsTabInjected } from '../src/client/PluginInventorySettingsTab.tsx'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const EMPTY = { entries: [] }
type ListResult =
  | { readonly ok: true; readonly value: typeof EMPTY }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

async function bench(capabilities: string[] = ['plugin.inventory.v1']) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const listeners = new Set<() => void>()
  ctx.provide('connection', { generation: { getSnapshot: () => undefined, subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  } } })
  class RemoteService extends Service {
    $host = { home: undefined, platform: undefined, isLoopback: true, capabilities }
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  const remote = new RemoteService(ctx)
  const list = vi.fn<(signal?: AbortSignal) => Promise<ListResult>>()
    .mockResolvedValue({ ok: true, value: EMPTY })
  ctx.provide('remote.pluginInventory', { list })
  const replace = (next = capabilities) => {
    remote.$host = { ...remote.$host, capabilities: next }
    for (const listener of listeners) listener()
  }
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, list, replace, listeners }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-plugin-inventory browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services used by the Settings Remote contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.pluginInventory', 'connection'])
  })

  it('registers a localized tab without reading the Remote eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).not.toBeUndefined()
    expect(entry.options).toMatchObject({ id: 'all', order: 10 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('插件列表')
    expect(b.list).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => PluginInventorySettingsTabInjected)()
    await expect(injected.list()).resolves.toEqual(EMPTY)
    expect(b.list).toHaveBeenCalledOnce()
    // A newer Host may return a code absent from this Client's declaration map.
    const failure = new RemoteError('future/inventory-unavailable' as never, 'unavailable', { reason: 'maintenance' } as never)
    b.list.mockResolvedValueOnce({ ok: false, error: failure })
    await expect(injected.list()).rejects.toBe(failure)

    // Shipped preset names resolve over the agent-preset dictionaries the
    // real plugin registers; user-authored metadata stays untranslated.
    b.locale.register('settings.agentPreset', 'zh', { presetStandardName: '标准模式' } as never)
    expect(injected.presetName({ id: 'standard', trust: 'system', isDefault: true, rows: [] })).toBe('标准模式')
    expect(injected.presetName({ id: 'mine', trust: 'user', name: '我自己的', isDefault: false, rows: [] })).toBe('我自己的')
    await b.ctx.fiber.dispose()
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.plugins.tab')[0]!.options.label)).toBe('Plugin list')

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).not.toBeUndefined()
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})

it('withdraws the tab and in-flight read immediately, rejecting retained callbacks on restoration', async () => {
  const b = await bench([])
  declare(b.slots)
  const fiber = b.ctx.plugin({ inject: [...inject], apply })
  await fiber
  expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
  expect(b.list).not.toHaveBeenCalled()
  b.replace(['plugin.inventory.v1'])
  const first = b.slots.entries('settings.plugins.tab')[0]!
  const injected = (first.inject as unknown as () => PluginInventorySettingsTabInjected)()
  const gate = Promise.withResolvers<ListResult>()
  b.list.mockReturnValueOnce(gate.promise)
  const pending = injected.list()
  const signal = b.list.mock.calls[0]?.[0]
  expect(signal?.aborted).toBe(false)
  b.replace([])
  expect(signal?.aborted).toBe(true)
  expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
  b.replace(['plugin.inventory.v1'])
  const second = b.slots.entries('settings.plugins.tab')[0]!
  expect(second.component).not.toBe(first.component)
  const next = (second.inject as unknown as () => PluginInventorySettingsTabInjected)()
  await expect(next.list()).resolves.toEqual(EMPTY)
  gate.resolve({ ok: true, value: EMPTY })
  await expect(pending).rejects.toThrow('connection changed')
  await expect(injected.list()).rejects.toThrow('connection changed')
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
  const entry = b.slots.entries('settings.plugins.tab')[0]!
  const old = (entry.inject as unknown as () => PluginInventorySettingsTabInjected)()
  const gate = Promise.withResolvers<ListResult>()
  b.list.mockReturnValueOnce(gate.promise)
  const pending = old.list()
  b.replace()
  const replacement = b.slots.entries('settings.plugins.tab')[0]!
  expect(replacement.component).not.toBe(entry.component)
  gate.reject(new Error('old transport failure'))
  await expect(pending).rejects.toThrow('connection changed')
  await b.ctx.fiber.dispose()
})
