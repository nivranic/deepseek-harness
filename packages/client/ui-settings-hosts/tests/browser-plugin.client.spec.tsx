// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import type { HostsSettingsSectionInjected } from '../src/client/HostsSettingsSection.tsx'
import { apply as connectionApply, type ConnectionHandle, type SavedHost } from '@deepseek-ai/dsh-client-connection/client'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const ROWS: readonly SavedHost[] = [{
  hostId: 'h-1',
  displayName: 'Workstation',
  platform: 'win32',
  origin: location.origin,
  lastConnectedAt: 1,
}]

async function bench(selected?: string) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  onTestFinished(() => {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
    else Object.defineProperty(globalThis, 'localStorage', previous)
  })
  const storage = new Map<string, string>([['dsh-saved-hosts.v1', JSON.stringify(ROWS)]])
  const adapter: Storage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value) },
    removeItem: (key) => { storage.delete(key) },
    clear: () => { storage.clear() },
    key: () => null,
    get length() { return storage.size },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: adapter })
  if (selected !== undefined) storage.set('dsh-selected-host.v1', selected)
  await ctx.plugin({ apply: connectionApply, inject: [] }).await()
  const connection = ctx.get('connection') as ConnectionHandle
  const retarget = vi.spyOn(connection, 'retarget')
  const remove = vi.spyOn(connection.savedHosts, 'remove')
  return { ctx, slots: ctx.get('slots') as SlotRegistry, connection, retarget, remove, storage }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-hosts browser plugin', () => {

  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services the local roster needs', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers a localized section whose face reads the roster and switches with persistence', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).not.toBeUndefined()
    expect(entry.options).toMatchObject({ id: 'hosts', order: 15 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('主机')

    const face = (entry.inject as unknown as () => HostsSettingsSectionInjected)()
    expect(face.hooks.savedHosts.getSnapshot()).toEqual(ROWS)
    expect(face.hooks.selectedOrigin.getSnapshot()).toBeUndefined()
    expect(face.switchTo('h-1')).toMatchObject({ hostId: 'h-1' })
    expect(b.retarget).toHaveBeenCalledExactlyOnceWith(location.origin)
    expect(b.storage.get('dsh-selected-host.v1')).toBe('h-1')

    face.useLocalHost()
    expect(b.retarget).toHaveBeenNthCalledWith(2, undefined)
    expect(b.storage.has('dsh-selected-host.v1')).toBe(false)

    face.forget('h-1')
    expect(b.remove).toHaveBeenCalledExactlyOnceWith('h-1')
    await b.ctx.fiber.dispose()
  })

  it('renames through the handle into the persisted roster', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const face = (entry.inject as unknown as () => HostsSettingsSectionInjected)()
    const rename = vi.spyOn(b.connection.savedHosts, 'rename')
    face.rename('h-1', 'Desk')
    face.rename('h-1', undefined)
    expect(rename).toHaveBeenNthCalledWith(1, 'h-1', 'Desk')
    expect(rename).toHaveBeenNthCalledWith(2, 'h-1', undefined)
    const persisted = JSON.parse(b.storage.get('dsh-saved-hosts.v1')!) as readonly { customName?: string }[]
    expect(persisted[0]).not.toHaveProperty('customName')
    await b.ctx.fiber.dispose()
  })

  it('keeps a switch that misses the roster off the connection and the storage', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const face = (entry.inject as unknown as () => HostsSettingsSectionInjected)()
    expect(face.switchTo('missing')).toBeUndefined()
    expect(b.retarget).not.toHaveBeenCalled()
    expect(b.storage.has('dsh-selected-host.v1')).toBe(false)
    await b.ctx.fiber.dispose()
  })

  it('forgets the persisted selection without replacing the live connection', async () => {
    const b = await bench('h-1')
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const face = (entry.inject as unknown as () => HostsSettingsSectionInjected)()
    face.forget('h-1')
    expect(b.remove).toHaveBeenCalledExactlyOnceWith('h-1')
    expect(b.storage.has('dsh-selected-host.v1')).toBe(false)
    expect(b.retarget).not.toHaveBeenCalled()
    expect(b.connection.targetOrigin()).toBe(ROWS[0]!.origin)
    await b.ctx.fiber.dispose()
  })
})
