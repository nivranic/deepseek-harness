/** Browser storage availability and durable saved-origin admission. */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { SavedHostsStore, MAX_SAVED_HOSTS, browserSavedHostsPersistence, browserSelectedHostPersistence } from '../src/client/saved-hosts.ts'

function storageProperty(descriptor: PropertyDescriptor): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor })
  onTestFinished(() => {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
    else Object.defineProperty(globalThis, 'localStorage', previous)
  })
}

const row = (hostId: string, origin: string, lastConnectedAt = 1) => ({
  hostId, origin, lastConnectedAt, displayName: undefined, platform: undefined,
})

describe('saved Host storage', () => {
  it('keeps both adapters absent when the storage getter is denied', () => {
    storageProperty({ get() { throw new DOMException('denied', 'SecurityError') } })
    expect(browserSavedHostsPersistence()).toBeUndefined()
    expect(browserSelectedHostPersistence()).toBeUndefined()
  })

  it('keeps in-memory rows and selection actions usable after storage permission or quota failure', () => {
    const denied = (): never => { throw new DOMException('denied', 'SecurityError') }
    storageProperty({ value: { getItem: denied, setItem: denied, removeItem: denied } })
    const saved = browserSavedHostsPersistence()!
    const selected = browserSelectedHostPersistence()!
    expect(saved.read()).toBeUndefined()
    expect(selected.read()).toBeUndefined()
    const store = new SavedHostsStore(saved)
    expect(() => { store.record(row('host', 'https://target.local')) }).not.toThrow()
    expect(store.list()).toHaveLength(1)
    expect(() => { selected.write('host'); selected.clear() }).not.toThrow()
  })

  it.each(['ftp://target.local', 'https://target.local/path', 'https://user:password@target.local', 'null', 'broken'])(
    'does not restore the invalid origin %s', (origin) => {
      const saved = new SavedHostsStore({ read: () => JSON.stringify([row('bad', origin), row('good', 'https://valid.local')]), write: () => {} })
      expect(saved.list().map(value => value.hostId)).toEqual(['good'])
    },
  )

  it('bounds a restored roster before publishing it', () => {
    const rows = Array.from({ length: MAX_SAVED_HOSTS + 3 }, (_, index) => row(String(index), 'https://valid.local', index))
    const saved = new SavedHostsStore({ read: () => JSON.stringify(rows), write: () => {} })
    expect(saved.list()).toHaveLength(MAX_SAVED_HOSTS)
    expect(saved.list()[0]?.hostId).toBe(String(rows.length - 1))
  })

  it('continues delivery after one roster observer throws', () => {
    const saved = new SavedHostsStore()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    onTestFinished(() => { error.mockRestore() })
    const removeThrowing = saved.subscribe(() => { throw new Error('observer failure') })
    const next = vi.fn()
    const removeNext = saved.subscribe(next)
    onTestFinished(() => { removeThrowing(); removeNext() })
    expect(() => { saved.record(row('host', 'https://valid.local')) }).not.toThrow()
    expect(next).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledOnce()
  })
})
