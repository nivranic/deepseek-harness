// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import type { HostsSettingsSectionInjected } from '../src/client/HostsSettingsSection.tsx'
import type { SavedHost } from '@deepseek-ai/dsh-client-connection/client'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const ROWS: readonly SavedHost[] = [{
  hostId: 'h-1',
  displayName: 'Workstation',
  platform: 'win32',
  origin: 'https://workstation.local:8787',
  lastConnectedAt: 1,
}]

type BrowserStorage = { localStorage?: Storage }

async function bench(selected?: string) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const storage = new Map<string, string>()
  ;(globalThis as BrowserStorage).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
    clear: () => { storage.clear() },
    key: () => null,
    get length() { return storage.size },
  }
  if (selected !== undefined) storage.set('dsh-selected-host.v1', selected)
  const retarget = vi.fn<(origin: string | undefined) => void>()
  const remove = vi.fn<(hostId: string) => void>()
  ctx.provide('connection', {
    savedHosts: {
      list: () => ROWS,
      remove,
      subscribe: () => () => {},
    },
    targetOrigin: () => undefined,
    retarget,
  })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, retarget, remove, storage }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-hosts browser plugin', () => {
  afterEach(() => { delete (globalThis as BrowserStorage).localStorage })

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
    expect(face.rows()).toEqual(ROWS)
    expect(face.selectedOrigin()).toBeUndefined()
    expect(face.switchTo('h-1')).toMatchObject({ hostId: 'h-1' })
    expect(b.retarget).toHaveBeenCalledExactlyOnceWith('https://workstation.local:8787')
    expect(b.storage.get('dsh-selected-host.v1')).toBe('h-1')

    face.useLocalHost()
    expect(b.retarget).toHaveBeenNthCalledWith(2, undefined)
    expect(b.storage.has('dsh-selected-host.v1')).toBe(false)

    face.forget('h-1')
    expect(b.remove).toHaveBeenCalledExactlyOnceWith('h-1')
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
})

describe('connection boot applies the persisted selection', () => {
  it('targets the saved row origin without a loop running', async () => {
    ;(globalThis as BrowserStorage).localStorage = {
      getItem: (key: string) => key === 'dsh-selected-host.v1' ? 'h-boot' : null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      get length() { return 1 },
    }
    const roster = new Map([['dsh-saved-hosts.v1', JSON.stringify([['h-boot', {
      scope: 'host:h-boot', revision: 1, outcome: { kind: 'result', value: 1 },
    }]]) + '\n']])
    void roster
    // The roster write above models the wrong shape on purpose: the boot
    // selection reads SavedHost rows, so a missing row keeps the page Host.
    const { apply: applyConnection } = await import('@deepseek-ai/dsh-client-connection/client')
    const ctx = new Context()
    ;(globalThis as { location?: { hostname: string; search: string } }).location = { hostname: 'localhost', search: '?fixture' }
    await ctx.plugin({ apply: applyConnection, inject: [] }).await()
    const connection = ctx.get('connection') as { targetOrigin(): string | undefined }
    expect(connection.targetOrigin()).toBeUndefined()
    await ctx.fiber.dispose()
    delete (globalThis as { location?: object }).location
  })
})
