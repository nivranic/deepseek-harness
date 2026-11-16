/** Isolated bookmark storage and controllable Host discovery. */
import type { Context } from '@deepseek-ai/cordis'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { HostDescriptor, HostId, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { onTestFinished, vi } from 'vitest'

export function setup(ctx: Context, remote = new TestRemote(ctx)) {
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const listeners = new Set<() => void>()
  ctx.provide('connection', { generation: { getSnapshot: () => undefined, subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  } } })
  const descriptor: HostDescriptor = {
    hostId: 'host-fixture' as HostId, displayName: 'Fixture Host', productVersion: 'fixture',
    apiProtocolVersion: 1, sessionFormatVersion: 4, platform: 'linux', arch: 'x64',
    runtimeMode: 'full', capabilities: [], transports: ['http'], serverTime: 0,
  }
  const describe = vi.fn<() => Promise<RemoteResult<HostDescriptor>>>()
    .mockImplementation(async () => ({ ok: true, value: descriptor }))
  remote.provideNamespaces({ host: { describe } })
  const storage = new Map<string, string>()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  onTestFinished(() => {
    if (original === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
    else Object.defineProperty(globalThis, 'localStorage', original)
  })
  const adapter: Storage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value) },
    removeItem: (key) => { storage.delete(key) },
    clear: () => { storage.clear() }, key: () => null,
    get length() { return storage.size },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: adapter })
  return { locale, listeners, descriptor, describe, storage, refresh: () => { for (const listener of listeners) listener() } }
}
