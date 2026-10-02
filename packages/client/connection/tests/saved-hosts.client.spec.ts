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

  it('rename sets and clears a custom name in place, keeps order, and notifies only on change', () => {
    const persistence = memoryPersistence()
    const store = new SavedHostsStore(persistence)
    store.record(host('work-pc', 100, 'Work PC'))
    store.record(host('home-pc', 200))
    let notifications = 0
    store.subscribe(() => { notifications += 1 })
    expect(store.rename('absent', 'Nope')).toBe(false)
    expect(store.rename('work-pc', 'Desk')).toBe(true)
    expect(store.rename('work-pc', 'Desk')).toBe(false)
    expect(notifications).toBe(1)
    expect(store.list().map(row => row.hostId)).toEqual(['home-pc', 'work-pc'])
    expect(store.list()[1]?.customName).toBe('Desk')
    const reloaded = new SavedHostsStore(persistence)
    expect(reloaded.list()[1]?.customName).toBe('Desk')
    expect(store.rename('work-pc', undefined)).toBe(true)
    expect(store.list()[1]).not.toHaveProperty('customName')
    expect(new SavedHostsStore(persistence).list()[1]?.customName).toBeUndefined()
  })

  it('record refreshes descriptor facts but keeps the client-chosen name', () => {
    const store = new SavedHostsStore()
    store.record(host('work-pc', 100, 'Work PC'))
    store.rename('work-pc', 'Desk')
    store.record(host('work-pc', 300, 'Renamed Host'))
    const row = store.list()[0]
    expect(row?.customName).toBe('Desk')
    expect(row?.displayName).toBe('Renamed Host')
    expect(row?.lastConnectedAt).toBe(300)
  })

  it('move swaps adjacent rows, stamps an explicit order on every row, and persists it', () => {
    const persistence = memoryPersistence()
    const store = new SavedHostsStore(persistence)
    store.record(host('work-pc', 100))
    store.record(host('home-pc', 200))
    store.record(host('lab', 300))
    let notifications = 0
    store.subscribe(() => { notifications += 1 })
    expect(store.moveHost('home-pc', 'up')).toBe(true)
    expect(store.list().map(row => row.hostId)).toEqual(['home-pc', 'lab', 'work-pc'])
    expect(store.list().map(row => row.order)).toEqual([0, 1, 2])
    expect(store.moveHost('home-pc', 'down')).toBe(true)
    expect(store.list().map(row => row.hostId)).toEqual(['lab', 'home-pc', 'work-pc'])
    expect(notifications).toBe(2)
    const reloaded = new SavedHostsStore(persistence)
    expect(reloaded.list().map(row => row.hostId)).toEqual(['lab', 'home-pc', 'work-pc'])
  })

  it('boundary and unknown moves leave the roster unchanged without notifying', () => {
    const store = new SavedHostsStore()
    store.record(host('work-pc', 100))
    store.record(host('home-pc', 200))
    let notifications = 0
    store.subscribe(() => { notifications += 1 })
    expect(store.moveHost('home-pc', 'up')).toBe(false)
    expect(store.moveHost('work-pc', 'down')).toBe(false)
    expect(store.moveHost('absent', 'up')).toBe(false)
    expect(notifications).toBe(0)
    expect(store.list().map(row => row.hostId)).toEqual(['home-pc', 'work-pc'])
  })

  it('a manual arrangement survives reconnect refreshes, renames, and unordered arrivals', () => {
    const persistence = memoryPersistence()
    const store = new SavedHostsStore(persistence)
    store.record(host('work-pc', 100))
    store.record(host('home-pc', 200))
    store.record(host('lab', 300))
    store.moveHost('work-pc', 'up')
    store.record(host('work-pc', 900))
    store.record(host('lab', 50))
    store.rename('work-pc', 'Desk')
    store.record(host('fresh', 1000))
    expect(store.list().map(row => row.hostId)).toEqual(['lab', 'work-pc', 'home-pc', 'fresh'])
    expect(store.list().map(row => row.order)).toEqual([0, 1, 2, undefined])
    const reloaded = new SavedHostsStore(persistence)
    expect(reloaded.list().map(row => row.hostId)).toEqual(['lab', 'work-pc', 'home-pc', 'fresh'])
    expect(reloaded.list()[1]?.customName).toBe('Desk')
  })

  it('drops persisted rows whose order is not a finite number', () => {
    const persistence = memoryPersistence(JSON.stringify([
      host('good', 10),
      { ...host('bad', 20), order: 'first' },
      { ...host('zero', 30), order: 0 },
    ]))
    expect(new SavedHostsStore(persistence).list().map(row => row.hostId)).toEqual(['zero', 'good'])
  })

  it('drops persisted rows whose customName is not a string', () => {
    const persistence = memoryPersistence(JSON.stringify([
      host('good', 10),
      { ...host('bad', 20), customName: 42 },
    ]))
    expect(new SavedHostsStore(persistence).list().map(row => row.hostId)).toEqual(['good'])
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
