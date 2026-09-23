/** §28 saved-Host roster: persistence boundary, upsert ordering, cap, and generation recording. */
import { describe, expect, it } from 'vitest'
import { MAX_SAVED_HOSTS, SavedHostsStore, browserSavedHostsPersistence, type SavedHost, type SavedHostsPersistence } from '../src/client/saved-hosts.ts'

function memoryPersistence(initial?: string): SavedHostsPersistence & { written: string[] } {
  const written: string[] = []
  let value = initial
  return {
    written,
    read: () => value,
    write: (next) => { value = next; written.push(next) },
  }
}

const host = (hostId: string, lastConnectedAt: number, displayName?: string): SavedHost => ({
  hostId,
  displayName,
  platform: 'win32',
  origin: 'https://work.example.com',
  lastConnectedAt,
})

describe('SavedHostsStore', () => {
  it('upserts by hostId, most recently connected first', () => {
    const store = new SavedHostsStore()
    store.record(host('work-pc', 100, 'Work PC'))
    store.record(host('home-pc', 200))
    store.record(host('work-pc', 300, 'Work PC 2'))
    expect(store.list().map(row => row.hostId)).toEqual(['work-pc', 'home-pc'])
    expect(store.list()[0]?.displayName).toBe('Work PC 2')
    expect(store.list()[0]?.lastConnectedAt).toBe(300)
  })

  it('keeps only the newest MAX_SAVED_HOSTS rows', () => {
    const store = new SavedHostsStore()
    for (let index = 0; index < MAX_SAVED_HOSTS + 3; index++) {
      store.record(host(`host-${index}`, index))
    }
    expect(store.list()).toHaveLength(MAX_SAVED_HOSTS)
    expect(store.list()[0]?.hostId).toBe(`host-${MAX_SAVED_HOSTS + 2}`)
    expect(store.list().at(-1)?.hostId).toBe('host-3')
  })

  it('persists on every change and reloads across store lifetimes', () => {
    const persistence = memoryPersistence()
    const first = new SavedHostsStore(persistence)
    first.record(host('work-pc', 100, 'Work PC'))
    first.record(host('home-pc', 200))
    const second = new SavedHostsStore(persistence)
    expect(second.list().map(row => row.hostId)).toEqual(['home-pc', 'work-pc'])
    expect(second.list()[1]?.displayName).toBe('Work PC')
  })

  it('drops corrupt persisted rows and non-array payloads without crashing', () => {
    const persistence = memoryPersistence(`${JSON.stringify([
      host('good', 10),
      { hostId: 42 },
      'not-an-object',
    ])}\n`)
    expect(new SavedHostsStore(persistence).list().map(row => row.hostId)).toEqual(['good'])
    expect(new SavedHostsStore(memoryPersistence('{"rows":true}')).list()).toEqual([])
    expect(new SavedHostsStore(memoryPersistence('not-json')).list()).toEqual([])
  })

  it('remove deletes exactly one row and notifies subscribers; absent ids change nothing', () => {
    const store = new SavedHostsStore()
    store.record(host('work-pc', 100))
    store.record(host('home-pc', 200))
    let notifications = 0
    const unsubscribe = store.subscribe(() => { notifications += 1 })
    store.remove('absent')
    expect(notifications).toBe(0)
    store.remove('work-pc')
    expect(notifications).toBe(1)
    expect(store.list().map(row => row.hostId)).toEqual(['home-pc'])
    unsubscribe()
  })

  it('the browser adapter reads and writes the roster key when storage exists', () => {
    const adapter = browserSavedHostsPersistence()
    if (adapter === undefined) return // environments without storage get no persistence, by design
    adapter.write('[]')
    expect(adapter.read()).toBe('[]')
  })
})
