import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import { apply, defineDomain, descriptorOf, DomainFacility, domainTable } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { DomainChanged } from '../src/events.ts'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'

const itemSchema = z.object({ label: z.string(), count: z.number().int() })
type Item = z.infer<typeof itemSchema>

const settingsSchema = z.object({ theme: z.string() })

const spec = defineDomain({
  name: 'demo',
  version: 1,
  global: { schema: settingsSchema, initial: { theme: 'plain' } },
  tables: { items: domainTable<string, Item>(itemSchema) },
})

const bareSpec = defineDomain({
  name: 'bare',
  version: 1,
  tables: { rows: domainTable<string, Item>(itemSchema) },
})

/** Boot a context with the storage hub, one memory backend, and a facility over it. */
async function harness(options?: { pool?: MemoryMediaPool; config?: Partial<Config> }) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new MemoryStorageBackend(options?.pool)
  ctx.storage.backend.register('memory', backend)
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {}, ...options?.config })
  // Mounted, not just constructed: the package invariant resolves the form
  // through ctx.storage to cross-check every domain/changed emission.
  ctx.storage.mount('domain', facility)
  const changes: DomainChanged[] = []
  ctx.on('domain/changed', (change) => { changes.push(change) })
  return { ctx, backend, facility, changes }
}

describe('defineDomain', () => {
  it('rejects invalid names and versions loudly', () => {
    expect(() => defineDomain({ name: 'Bad-Name', version: 1, tables: {} })).toThrow(/must match/)
    expect(() => defineDomain({ name: 'ok', version: 1.5, tables: {} })).toThrow(/non-negative integer/)
    expect(() => defineDomain({
      name: 'ok', version: 1, tables: { 'Bad Table': domainTable<string, Item>(itemSchema) },
    })).toThrow(/table name/)
  })

  it('rejects a global schema that accepts null (the never-written sentinel)', () => {
    expect(() => defineDomain({
      name: 'ok',
      version: 1,
      global: { schema: settingsSchema.nullable(), initial: null },
      tables: {},
    })).toThrow(/must not accept null/)
  })

  it('validates compatibleVersions entries and projects them onto the descriptor', () => {
    expect(() => defineDomain({ name: 'ok', version: 2, compatibleVersions: [1.5], tables: {} }))
      .toThrow(/compatibleVersions/)
    expect(() => defineDomain({ name: 'ok', version: 2, compatibleVersions: [2], tables: {} }))
      .toThrow(/below version/)
    expect(() => defineDomain({ name: 'ok', version: 2, compatibleVersions: [-1], tables: {} }))
      .toThrow(/compatibleVersions/)
    expect(descriptorOf(defineDomain({ name: 'ok', version: 2, compatibleVersions: [0, 1], tables: {} })))
      .toMatchObject({ compatibleVersions: [0, 1] })
    // An undeclared set is absent from the descriptor.
    expect(descriptorOf(spec)).not.toHaveProperty('compatibleVersions')
  })

  it('rejects an unknown invalidRecords policy', () => {
    expect(() => defineDomain({
      name: 'ok', version: 1, invalidRecords: 'zap' as 'backup-and-skip', tables: {},
    })).toThrow(/invalidRecords/)
  })

  it('rejects an invalid layout and projects the declared one onto the descriptor', () => {
    // A spec built from config can carry any value; the union type is
    // compile-time only, so the runtime boundary check must reject it.
    expect(() => defineDomain({ name: 'ok', version: 1, layout: 'every-record' as 'single', tables: {} }))
      .toThrow(/layout/)
    expect(descriptorOf(defineDomain({ name: 'per', version: 1, layout: 'per-record', tables: {} })))
      .toMatchObject({ name: 'per', layout: 'per-record' })
    // The default (single) layout is absent from the descriptor.
    expect(descriptorOf(spec)).not.toHaveProperty('layout')
  })
})

describe('DomainFacility.open', () => {
  it('opens, reads back stored records, and rejects a second open of the same name', async () => {
    const { facility } = await harness()
    const domain = await facility.open(spec)
    await domain.table('items').put('a', { label: 'first', count: 1 })
    await expect(facility.open(spec)).rejects.toMatchObject({ name: 'DomainError', code: 'already-open' })
    expect(domain.table('items').get('a')).toEqual({ label: 'first', count: 1 })
  })

  it('routes per domain name and fails loud on an unregistered route target', async () => {
    const { facility } = await harness({ config: { routes: { demo: 'nonexistent' } } })
    await expect(facility.open(spec)).rejects.toMatchObject({
      name: 'StorageError',
      code: 'backend-not-found',
    })
    // The failed open releases the name for a later attempt.
    const { facility: healthy } = await harness()
    await expect(healthy.open(spec)).resolves.toBeDefined()
  })

  it('rejects a backend without the kv facet', async () => {
    const { ctx, facility } = await harness({ config: { backend: 'nokv' } })
    ctx.storage.backend.register('nokv', { close: async () => {} })
    await expect(facility.open(spec)).rejects.toMatchObject({ code: 'facet-unsupported' })
  })

  it('falls back to the default backend when no route table is configured', async () => {
    // A second, unmounted facility whose config omits `routes` entirely
    // (exactOptionalPropertyTypes forbids an explicit undefined). Opening
    // emits no events, so the mounted facility's invariant never consults it.
    const { ctx } = await harness()
    const routeless = new DomainFacility(ctx, { backend: 'memory' })
    await expect(routeless.open(bareSpec)).resolves.toBeDefined()
  })

  it('treats a table key the backend omitted from loadAll as empty', async () => {
    // A sparse backend: loadAll omits declared table keys entirely instead of
    // returning them as empty objects.
    const { ctx, facility } = await harness({ config: { backend: 'sparse' } })
    ctx.storage.backend.register('sparse', {
      kv: {
        open: async () => ({
          loadAll: async () => ({ tables: {}, global: null }),
          putRecord: async () => {},
          deleteRecord: async () => {},
          setGlobal: async () => {},
          close: async () => {},
        }),
      },
      close: async () => {},
    })
    const domain = await facility.open(bareSpec)
    expect(domain.table('rows').size).toBe(0)
  })

  it('rejects stored records that fail their schema, naming table and key', async () => {
    const pool = new MemoryMediaPool()
    {
      const { facility } = await harness({ pool })
      await (await facility.open(spec)).table('items').put('bad', { label: 'x', count: 2 })
    }
    pool.media.get('demo')!.tables.get('items')!.set('bad', { label: 'x', count: 'NaN' })
    const { facility } = await harness({ pool })
    await expect(facility.open(spec)).rejects.toMatchObject({
      code: 'invalid-record',
      detail: { table: 'items', key: 'bad' },
    })
  })

  it('keeps the rejecting default under backup-and-skip when the backend cannot move documents', async () => {
    // The memory backend has no backupRecord, so the declared policy cannot
    // apply and the open falls back to failing loud.
    const salvageSpec = defineDomain({
      name: 'salvage',
      version: 1,
      invalidRecords: 'backup-and-skip',
      tables: { items: domainTable<string, Item>(itemSchema) },
    })
    const pool = new MemoryMediaPool()
    {
      const { facility } = await harness({ pool })
      await (await facility.open(salvageSpec)).table('items').put('bad', { label: 'x', count: 2 })
    }
    pool.media.get('salvage')!.tables.get('items')!.set('bad', { label: 'x', count: 'NaN' })
    const { facility } = await harness({ pool })
    await expect(facility.open(salvageSpec)).rejects.toMatchObject({
      code: 'invalid-record',
      detail: { table: 'items', key: 'bad' },
    })
  })

  it('rejects a stored global that fails its schema with the global marker', async () => {
    const pool = new MemoryMediaPool()
    pool.versions.set('demo', 1)
    pool.media.set('demo', { tables: new Map(), global: { theme: 42 } })
    const { facility } = await harness({ pool })
    await expect(facility.open(spec)).rejects.toMatchObject({
      code: 'invalid-record',
      detail: { table: '', key: '' },
    })
  })

  it('passes through a backend version mismatch', async () => {
    const pool = new MemoryMediaPool()
    pool.versions.set('demo', 7)
    const { facility } = await harness({ pool })
    await expect(facility.open(spec)).rejects.toMatchObject({
      name: 'StorageError',
      code: 'version-mismatch',
    })
  })
})

describe('plugin apply', () => {
  it('uses only the default backend when routes are omitted', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const backend = new MemoryStorageBackend()
    ctx.storage.backend.register('memory', backend)
    const disposeBackend = ctx.provide(storageBackendServiceKey('memory'), backend)

    const fiber = await ctx.plugin({
      name: 'storage-domain-routeless-test',
      inject: ['storage'],
      apply: (domainCtx: Context) => apply(domainCtx, { backend: 'memory' }),
    })
    await vi.waitFor(() => { expect(ctx.storageDomain).toBeInstanceOf(DomainFacility) })

    disposeBackend()
    await vi.waitFor(() => { expect(ctx.get('storageDomain')).toBeUndefined() })
    await fiber.dispose()
  })

  it('waits for routed backends, then mounts one lifecycle-bound service and form', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const DomainPlugin = await import('../src/index.ts')
    const fiber = await ctx.plugin(DomainPlugin, { backend: 'memory' })
    expect(ctx.get('storageDomain')).toBeUndefined()
    expect(() => ctx.storage.form('domain')).toThrow(/not mounted/)

    const backend = new MemoryStorageBackend()
    ctx.storage.backend.register('memory', backend)
    const disposeBackend = ctx.provide(storageBackendServiceKey('memory'), backend)
    await vi.waitFor(() => { expect(ctx.storageDomain).toBeInstanceOf(DomainFacility) })
    expect(ctx.storage.domain).toBe(ctx.storageDomain)

    disposeBackend()
    await vi.waitFor(() => {
      expect(ctx.get('storageDomain')).toBeUndefined()
      expect(() => ctx.storage.form('domain')).toThrow(/not mounted/)
    })
    await fiber.dispose()
  })
})

describe('table and snapshot reads', () => {
  it('serves entries, keys, and size as stable snapshots; unknown table names throw', async () => {
    const { facility } = await harness()
    const domain = await facility.open(spec)
    const table = domain.table('items')
    await table.put('a', { label: 'x', count: 1 })
    await table.put('b', { label: 'y', count: 2 })
    expect(table.size).toBe(2)
    expect([...table.keys()].sort()).toEqual(['a', 'b'])
    expect(new Map(table.entries()).get('a')).toEqual({ label: 'x', count: 1 })
    expect(() => domain.table('nope' as never)).toThrow(/declares no table/)
  })
})

describe('KvTable writes', () => {
  it('serializes concurrent updates on one key without losing increments', async () => {
    const { facility } = await harness()
    const table = (await facility.open(spec)).table('items')
    await table.put('counter', { label: 'c', count: 0 })
    await Promise.all(Array.from({ length: 50 }, () =>
      table.update('counter', current => ({ ...current, count: current.count + 1 }))))
    expect(table.get('counter')).toEqual({ label: 'c', count: 50 })
  })

  it('update rejects a missing key; delete reports prior existence', async () => {
    const { facility } = await harness()
    const table = (await facility.open(spec)).table('items')
    await expect(table.update('ghost', v => v)).rejects.toMatchObject({ code: 'missing-key' })
    await table.put('a', { label: 'x', count: 1 })
    await expect(table.delete('a')).resolves.toBe(true)
    await expect(table.delete('a')).resolves.toBe(false)
  })

  it('emits domain/changed per durable write, in order, with tombstones and global marker', async () => {
    const { facility, changes } = await harness()
    const domain = await facility.open(spec)
    const table = domain.table('items')
    await table.put('a', { label: 'x', count: 1 })
    await table.update('a', current => ({ ...current, count: 2 }))
    await table.delete('a')
    await table.delete('a') // no event: already absent
    await domain.global.set({ theme: 'dark' })
    expect(changes).toEqual([
      { domain: 'demo', table: 'items', key: 'a', operation: 'put', value: { label: 'x', count: 1 } },
      { domain: 'demo', table: 'items', key: 'a', operation: 'put', value: { label: 'x', count: 2 } },
      { domain: 'demo', table: 'items', key: 'a', operation: 'deleted' },
      { domain: 'demo', table: '', key: '', operation: 'put', value: { theme: 'dark' } },
    ])
  })
})

describe('durability failure', () => {
  it('leaves memory untouched and emits nothing when the backend rejects a write', async () => {
    const pool = new MemoryMediaPool()
    const { facility, changes } = await harness({ pool })
    const domain = await facility.open(spec)
    const table = domain.table('items')
    await table.put('a', { label: 'x', count: 1 })
    const seen = changes.length

    pool.failNextWrites = 3
    await expect(table.put('a', { label: 'x', count: 99 })).rejects.toThrow(/injected/)
    await expect(table.update('a', c => ({ ...c, count: c.count + 1 }))).rejects.toThrow(/injected/)
    await expect(table.delete('a')).rejects.toThrow(/injected/)

    // Reads still serve the pre-failure record; no events leaked.
    expect(table.get('a')).toEqual({ label: 'x', count: 1 })
    expect(pool.media.get('demo')!.tables.get('items')!.get('a')).toEqual({ label: 'x', count: 1 })
    expect(changes).toHaveLength(seen)

    // The chain survives rejections: the next write lands cleanly with no residue.
    await table.update('a', c => ({ ...c, count: c.count + 1 }))
    expect(table.get('a')).toEqual({ label: 'x', count: 2 })
  })

  it('keeps serving initial when the first global set fails durability', async () => {
    const pool = new MemoryMediaPool()
    const { facility } = await harness({ pool })
    const domain = await facility.open(spec)
    pool.failNextWrites = 1
    await expect(domain.global.set({ theme: 'dark' })).rejects.toThrow(/injected/)
    expect(domain.global.get()).toEqual({ theme: 'plain' })
    expect(pool.media.get('demo')!.global).toBeNull()
  })
})

describe('global singleton', () => {
  it('serves initial before first set without materializing, then persists the first set', async () => {
    const pool = new MemoryMediaPool()
    {
      const { facility } = await harness({ pool })
      const domain = await facility.open(spec)
      expect(domain.global.get()).toEqual({ theme: 'plain' })
      expect(pool.media.get('demo')!.global).toBeNull() // initial never touches the medium
      await domain.global.set({ theme: 'dark' })
      expect(pool.media.get('demo')!.global).toEqual({ theme: 'dark' })
    }
    const { facility } = await harness({ pool })
    expect((await facility.open(spec)).global.get()).toEqual({ theme: 'dark' })
  })

  it('throws on access when the spec declares no global', async () => {
    const { facility } = await harness()
    const domain = await facility.open(bareSpec)
    expect(() => (domain as { global: unknown }).global).toThrow(/declares no global/)
  })
})

describe('close and lifecycle', () => {
  it.each(['facility', 'backend'] as const)('reports initialization cleanup failure to the concurrent %s close', async (closer) => {
    const { backend, facility } = await harness()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const loadError = new Error('load failed during teardown')
    const closeError = new Error('initialization cleanup failed')
    const open = backend.kv.open.bind(backend.kv)
    vi.spyOn(backend.kv, 'open').mockImplementation(async (descriptor, onBackendClose) => {
      const unit = await open(descriptor, onBackendClose)
      vi.spyOn(unit, 'loadAll').mockImplementation(async () => {
        entered.resolve(undefined)
        await release.promise
        throw loadError
      })
      const close = unit.close.bind(unit)
      vi.spyOn(unit, 'close').mockImplementation(async () => { await close(); throw closeError })
      return unit
    })
    const opening = expect(facility.open(spec)).rejects.toMatchObject({ errors: [loadError, closeError] })
    await entered.promise
    const closing = closer === 'facility' ? facility.closeAll() : backend.close()
    const failure = expect(closing).rejects.toMatchObject({
      errors: [{ errors: [closeError] }, ...(closer === 'backend' ? [closeError] : [])],
    })
    release.resolve(undefined)
    await Promise.all([opening, failure])
    expect(facility.get(spec.name)).toBeUndefined()
  })

  it('joins every facility owner before reporting a failed unit close', async () => {
    const { backend, facility } = await harness()
    const failure = new Error('first unit close failed')
    const open = backend.kv.open.bind(backend.kv)
    vi.spyOn(backend.kv, 'open').mockImplementation(async (descriptor, onBackendClose) => {
      const unit = await open(descriptor, onBackendClose)
      if (descriptor.name === spec.name) {
        const close = unit.close.bind(unit)
        vi.spyOn(unit, 'close').mockImplementation(async () => { await close(); throw failure })
      }
      return unit
    })
    await facility.open(spec)
    const second = await facility.open({ ...spec, name: 'second' })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const pending = second.table('items').put('accepted', { label: 'drained', count: 1 }, async () => {
      entered.resolve(undefined)
      await release.promise
    })
    await entered.promise
    const closing = facility.closeAll()
    let settled = false
    const checked = expect(closing).rejects.toMatchObject({ errors: [failure] }).then(() => { settled = true })
    try {
      expect(facility.closeAll()).toBe(closing)
      await expect(facility.open(bareSpec)).rejects.toMatchObject({ code: 'closed' })
      expect(settled).toBe(false)
    } finally {
      release.resolve(undefined)
      await Promise.all([pending, checked])
    }
    expect(facility.get('second')).toBeUndefined()
    expect(backend.pool.media.get('second')?.tables.get('items')?.get('accepted')).toEqual({ label: 'drained', count: 1 })
  })

  it.each(['facility', 'backend'] as const)('joins initialization and refuses a handle when the %s closes during load', async (closer) => {
    const { backend, facility } = await harness()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const open = backend.kv.open.bind(backend.kv)
    vi.spyOn(backend.kv, 'open').mockImplementation(async (descriptor, onBackendClose) => {
      const unit = await open(descriptor, onBackendClose)
      const load = unit.loadAll.bind(unit)
      vi.spyOn(unit, 'loadAll').mockImplementation(async () => {
        entered.resolve(undefined)
        await release.promise
        return load()
      })
      return unit
    })
    const opening = facility.open(spec)
    const outcome = opening.then(() => ({ published: true }), (error: unknown) => ({ error }))
    await entered.promise
    const closing = closer === 'facility' ? facility.closeAll() : backend.close()
    try {
      await expect(facility.open(bareSpec)).rejects.toMatchObject({ code: 'closed' })
    } finally {
      release.resolve(undefined)
      await closing
    }
    expect(await outcome).toMatchObject({ error: { code: 'closed' } })
    expect(facility.get(spec.name)).toBeUndefined()
    await facility.closeAll()
  })

  it('stops new writes and drains the domain queue before backend close', async () => {
    const pool = new MemoryMediaPool()
    const { backend, facility, changes } = await harness({ pool })
    const domain = await facility.open(spec)
    const table = domain.table('items')
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const pending = table.put('late', { label: 'durable', count: 1 }, async () => {
      entered.resolve(undefined)
      await release.promise
    })
    await entered.promise
    const closing = backend.close()
    try {
      await expect(table.put('refused', { label: 'closed', count: 2 })).rejects.toMatchObject({ code: 'closed' })
      expect(changes).toEqual([])
    } finally {
      release.resolve(undefined)
      await Promise.all([pending, closing])
    }
    expect(pool.media.get(spec.name)?.tables.get('items')?.get('late')).toEqual({ label: 'durable', count: 1 })
    expect(facility.get(spec.name)).toBeUndefined()
    expect(() => table.get('late')).toThrow(/closed/u)
  })

  it('preserves initialization and unit cleanup failures together', async () => {
    const { backend, facility } = await harness()
    const loadError = new Error('load failed')
    const closeError = new Error('close failed')
    const open = backend.kv.open.bind(backend.kv)
    vi.spyOn(backend.kv, 'open').mockImplementation(async (descriptor, onBackendClose) => {
      const unit = await open(descriptor, onBackendClose)
      vi.spyOn(unit, 'loadAll').mockRejectedValue(loadError)
      const close = unit.close.bind(unit)
      vi.spyOn(unit, 'close').mockImplementation(async () => { await close(); throw closeError })
      return unit
    })
    await expect(facility.open(spec)).rejects.toMatchObject({ errors: [loadError, closeError] })
    expect(facility.get(spec.name)).toBeUndefined()
    await facility.closeAll()
  })

  it('drains a queued durability prerequisite and later writes before close', async () => {
    const pool = new MemoryMediaPool()
    const { facility, changes } = await harness({ pool })
    const domain = await facility.open(spec)
    const table = domain.table('items')
    const entered = Promise.withResolvers<undefined>()
    const ready = Promise.withResolvers<undefined>()
    const first = table.put('a', { label: 'first', count: 1 }, async () => {
      entered.resolve(undefined)
      await ready.promise
    })
    await entered.promise
    const later = table.put('a', { label: 'latest', count: 2 })
    const closing = domain.close()
    try {
      expect(changes).toEqual([])
      expect(table.get('a')).toBeUndefined()
      await expect(table.put('rejected', { label: 'closed', count: 3 })).rejects.toMatchObject({ code: 'closed' })
    } finally {
      ready.resolve(undefined)
      await Promise.all([first, later, closing])
    }
    expect(changes.map(change => change.operation === 'put' ? change.value : undefined)).toEqual([
      { label: 'first', count: 1 }, { label: 'latest', count: 2 },
    ])
    const reopened = await facility.open(spec)
    expect(reopened.table('items').get('a')).toEqual({ label: 'latest', count: 2 })
    await reopened.close()
  })

  it.each(['throw', 'reject'] as const)('skips a failed %s prerequisite without poisoning later writes', async (failure) => {
    const { facility, changes } = await harness()
    const domain = await facility.open(spec)
    const table = domain.table('items')
    const error = new Error('log durability failed')
    const beforeWrite = (): Promise<void> => {
      if (failure === 'throw') throw error
      return Promise.reject(error)
    }
    await expect(table.put('lost', { label: 'lost', count: 1 }, beforeWrite)).rejects.toBe(error)
    expect(table.get('lost')).toBeUndefined()
    expect(changes).toEqual([])
    await table.put('kept', { label: 'kept', count: 2 })
    expect(table.get('kept')).toEqual({ label: 'kept', count: 2 })
    expect(changes).toHaveLength(1)
    await domain.close()
  })

  it('does not invoke a prerequisite when the domain has already closed', async () => {
    const { facility } = await harness()
    const domain = await facility.open(spec)
    const table = domain.table('items')
    await domain.close()
    const beforeWrite = vi.fn(async () => {})
    await expect(table.put('a', { label: 'unused', count: 1 }, beforeWrite)).rejects.toMatchObject({ code: 'closed' })
    expect(beforeWrite).not.toHaveBeenCalled()
  })

  it('close drains queued writes, then rejects reads and writes, and frees the name', async () => {
    const pool = new MemoryMediaPool()
    const { facility } = await harness({ pool })
    const domain = await facility.open(spec)
    const table = domain.table('items')
    const pending = Promise.all([
      table.put('a', { label: 'x', count: 1 }),
      table.put('b', { label: 'y', count: 2 }),
    ])
    await Promise.all([domain.close(), domain.close()]) // idempotent
    await pending // queued before close → still landed
    // Durability is the drain contract: both queued writes reached the medium.
    expect([...pool.media.get('demo')!.tables.get('items')!.keys()].sort()).toEqual(['a', 'b'])
    await expect(table.put('c', { label: 'z', count: 3 })).rejects.toMatchObject({ code: 'closed' })
    expect(() => table.get('a')).toThrow(/closed/)
    // The name is free again: reopening sees the drained state.
    const reopened = await facility.open(spec)
    expect([...reopened.table('items').keys()].sort()).toEqual(['a', 'b'])
  })

  it('facility unmount closes domains the consumer never closed', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const backend = new MemoryStorageBackend()
    ctx.storage.backend.register('memory', backend)
    ctx.provide(storageBackendServiceKey('memory'), backend)
    const DomainPlugin = await import('../src/index.ts')
    const fiber = await ctx.plugin(DomainPlugin, { backend: 'memory' })
    const domain = await ctx.storageDomain.open(bareSpec)
    const table = domain.table('rows')
    await table.put('a', { label: 'x', count: 1 })
    await fiber.dispose()
    await expect(table.put('b', { label: 'y', count: 2 })).rejects.toMatchObject({ code: 'closed' })
    expect(() => ctx.storage.form('domain')).toThrow(/not mounted/)
  })

  it('contains a throwing domain/changed listener without rejecting the committed write', async () => {
    const pool = new MemoryMediaPool()
    const { ctx, facility, changes } = await harness({ pool })
    const domain = await facility.open(spec)
    const table = domain.table('items')
    ctx.on('domain/changed', () => {
      throw new Error('hostile observer')
    })
    await expect(table.put('a', { label: 'x', count: 1 })).resolves.toBeUndefined()
    // Commit survived intact on both planes, and well-behaved listeners
    // (registered before the thrower) still observed the event.
    expect(table.get('a')).toEqual({ label: 'x', count: 1 })
    expect(pool.media.get('demo')!.tables.get('items')!.get('a')).toEqual({ label: 'x', count: 1 })
    expect(changes).toHaveLength(1)
    // The chain is unpoisoned: subsequent writes proceed normally.
    await expect(table.delete('a')).resolves.toBe(true)
  })
})
