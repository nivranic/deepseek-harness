/** Existing bookmark persistence is validated independently of the transport. */
import { expect, it, onTestFinished, vi } from 'vitest'
import type { HostId } from '@deepseek-ai/dsh-api-remotes/client'
import { browserSavedHostsPersistence, SavedHostsStore, MAX_SAVED_HOSTS, type SavedHost } from '../src/client/saved-hosts.ts'

const row = (id: string, time = 1): SavedHost => ({
  hostId: id as HostId, displayName: id, platform: 'linux', origin: `https://${id}.example`, lastConnectedAt: time,
})

it('drops malformed persisted rows while accepting in-process and legacy hosts', () => {
  const invalid: unknown[] = [
    null, false, {}, { ...row('a'), hostId: '' }, { ...row('a'), displayName: 1 },
    { ...row('a'), customName: false }, { ...row('a'), platform: [] },
    { ...row('a'), origin: '' }, { ...row('a'), origin: 'invalid URL' },
    { ...row('a'), order: 'first' },
  ]
  const local = { ...row('local'), origin: 'in-process' }
  const raw = JSON.stringify([...invalid, local, row('legacy')])
  expect(new SavedHostsStore({ read: () => raw, write: () => {} }).list()).toEqual([local, row('legacy')])
  for (const field of ['lastConnectedAt', 'order']) {
    const overflowing = JSON.stringify(row('a')).replace(/}$/, `,"${field}":1e400}`)
    expect(new SavedHostsStore({ read: () => overflowing, write: () => {} }).list()).toEqual([])
  }
})

it('retains manual order without a custom name and contains subscriber failures', () => {
  const store = new SavedHostsStore()
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => { report.mockRestore() })
  const stop = store.subscribe(() => { throw new Error('subscriber failed') })
  store.record(row('first'))
  store.record(row('first'))
  store.rename('first' as HostId, 'Desk')
  store.record(row('first'))
  expect(store.list()[0]?.customName).toBe('Desk')
  store.rename('first' as HostId, undefined)
  store.record(row('second', 2))
  expect(store.rename('missing' as HostId, 'name')).toBe(false)
  expect(store.rename('first' as HostId, undefined)).toBe(false)
  expect(store.moveHost('missing' as HostId, 'up')).toBe(false)
  expect(store.moveHost('first' as HostId, 'down')).toBe(false)
  expect(store.moveHost('first' as HostId, 'up')).toBe(true)
  store.record(row('first', 3))
  expect(store.list()[0]).toMatchObject({ hostId: 'first', order: 0 })
  expect(store.rename('first' as HostId, 'Desk')).toBe(true)
  expect(store.moveHost('first' as HostId, 'down')).toBe(true)
  expect(report).toHaveBeenCalledWith('[ui-settings-hosts] bookmark listener threw:', expect.any(Error))
  stop()
})

it('keeps browser persistence optional when access or quota is denied', () => {
  onTestFinished(() => { vi.unstubAllGlobals() })
  vi.stubGlobal('localStorage', undefined)
  expect(browserSavedHostsPersistence()).toBeUndefined()
  const storage = {
    getItem: vi.fn<() => string | null>().mockReturnValue(null),
    setItem: vi.fn<() => void>(),
  }
  vi.stubGlobal('localStorage', storage)
  const persistence = browserSavedHostsPersistence()!
  expect(persistence.read()).toBeUndefined()
  storage.getItem.mockReturnValue('[]')
  expect(persistence.read()).toBe('[]')
  persistence.write('[]')
  expect(storage.setItem).toHaveBeenCalledWith('dsh-saved-hosts.v1', '[]')
  storage.getItem.mockImplementation(() => { throw new Error('denied') })
  storage.setItem.mockImplementation(() => { throw new Error('quota') })
  expect(persistence.read()).toBeUndefined()
  expect(() => { persistence.write('[]') }).not.toThrow()
})

it('starts without persistence when the browser storage getter throws', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  onTestFinished(() => {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
    else Object.defineProperty(globalThis, 'localStorage', previous)
  })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied') } })
  expect(browserSavedHostsPersistence()).toBeUndefined()
})

it('retains names and manual order across discovery and reload', () => {
  let raw: string | undefined
  const persistence = { read: () => raw, write: (value: string) => { raw = value } }
  const store = new SavedHostsStore(persistence)
  store.record(row('first'))
  store.record(row('second', 2))
  store.rename('first' as HostId, 'My Host')
  store.moveHost('first' as HostId, 'up')
  store.record({ ...row('first', 3), displayName: 'Updated Host' })
  const restored = new SavedHostsStore(persistence).list()
  expect(restored.map(host => host.hostId)).toEqual(['first', 'second'])
  expect(restored[0]).toMatchObject({ customName: 'My Host', displayName: 'Updated Host', lastConnectedAt: 3 })
  store.rename('first' as HostId, undefined)
  expect(new SavedHostsStore(persistence).list()[0]?.customName).toBeUndefined()
})

it('rejects corrupt storage and unsafe origins while retaining valid legacy rows', () => {
  for (const raw of ['invalid JSON', '{}', 'null']) {
    expect(new SavedHostsStore({ read: () => raw, write: () => {} }).list()).toEqual([])
  }
  const raw = JSON.stringify([
    row('valid'), { ...row('script'), origin: 'javascript:alert(1)' },
    { ...row('path'), origin: 'https://host.example/path' }, { ...row('invalid'), lastConnectedAt: null },
  ])
  expect(new SavedHostsStore({ read: () => raw, write: () => {} }).list()).toEqual([row('valid')])
})

it('bounds the roster and notifies only for changes, releasing subscribers', () => {
  const store = new SavedHostsStore()
  let changes = 0
  const stop = store.subscribe(() => { changes += 1 })
  for (let i = 0; i <= MAX_SAVED_HOSTS; i += 1) store.record(row(`host-${i}`, i))
  expect(store.list()).toHaveLength(MAX_SAVED_HOSTS)
  expect(store.list().some(host => host.hostId === 'host-0')).toBe(false)
  const before = changes
  expect(store.moveHost(store.list()[0]!.hostId, 'up')).toBe(false)
  store.remove('missing' as HostId)
  expect(changes).toBe(before)
  stop()
  store.remove(store.list()[0]!.hostId)
  expect(changes).toBe(before)
})
