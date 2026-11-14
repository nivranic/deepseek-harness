/** Existing bookmark persistence is validated independently of the transport. */
import { expect, it } from 'vitest'
import type { HostId } from '@deepseek-ai/dsh-api-remotes/client'
import { SavedHostsStore, MAX_SAVED_HOSTS, type SavedHost } from '../src/client/saved-hosts.ts'

const row = (id: string, time = 1): SavedHost => ({
  hostId: id as HostId, displayName: id, platform: 'linux', origin: `https://${id}.example`, lastConnectedAt: time,
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
