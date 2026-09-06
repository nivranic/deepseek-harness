/**
 * Shared KV-backend conformance suite. Each backend's spec file calls
 * {@link runKvBackendContract} with a factory bound to its own medium; the
 * suite asserts every clause of the `src/backend.ts` contract so both
 * backends are held to identical semantics.
 * @module
 */

import { describe, expect, it } from 'vitest'
import type { KvUnitDescriptor, StorageBackend } from '../src/backend.ts'

/** One conformance run: a fresh backend plus a way to reopen the same medium (crash simulation). */
export interface KvBackendContractHarness {
  /** The backend under test, freshly created over an empty medium. */
  backend: StorageBackend
  /** Open a NEW backend instance over the SAME medium, as after a process restart. */
  reopen(): Promise<StorageBackend>
}

const DESCRIPTOR: KvUnitDescriptor = {
  name: 'contract_unit',
  version: 3,
  tables: ['alpha', 'beta'],
  hasGlobal: true,
}

/**
 * Run the shared conformance suite against one backend implementation.
 * @param label - Suite label, e.g. `json` / `sqlite`.
 * @param create - Factory producing a fresh harness per test.
 */
export function runKvBackendContract(label: string, create: () => Promise<KvBackendContractHarness>) {
  describe(`kv backend contract: ${label}`, () => {
    it('joins owner work before closing its medium, including concurrent close calls', async () => {
      const harness = await create()
      const { backend } = harness
      const entered = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      let calls = 0
      const unit = await backend.kv!.open(DESCRIPTOR, async () => {
        calls++
        entered.resolve(undefined)
        await release.promise
        await unit.putRecord('alpha', 'last', { count: 42 })
        await unit.close()
      })
      try {
        const closing = backend.close()
        await entered.promise
        const alsoClosing = backend.close()
        await expect(backend.kv!.open({ ...DESCRIPTOR, name: 'late' })).rejects.toMatchObject({ code: 'closed' })
        release.resolve(undefined)
        await Promise.all([closing, alsoClosing])
        expect(calls).toBe(1)
        const next = await harness.reopen()
        try {
          expect((await (await next.kv!.open(DESCRIPTOR)).loadAll()).tables.alpha).toEqual({ last: { count: 42 } })
        } finally {
          await next.close()
        }
      } finally {
        release.resolve(undefined)
        await backend.close()
      }
    })

    it('releases all units and the medium even when an owner rejects teardown', async () => {
      const harness = await create()
      const { backend } = harness
      const failure = new Error('owner teardown failed')
      const unit = await backend.kv!.open(DESCRIPTOR, () => Promise.reject(failure))
      const other = await backend.kv!.open({ ...DESCRIPTOR, name: 'other' })
      await expect(backend.close()).rejects.toMatchObject({ errors: [failure] })
      await expect(unit.loadAll()).rejects.toMatchObject({ code: 'closed' })
      await expect(other.loadAll()).rejects.toMatchObject({ code: 'closed' })
      const next = await harness.reopen()
      await next.close()
    })

    it('opens a missing unit as empty and serves loadAll immediately', async () => {
      const { backend } = await create()
      const unit = await backend.kv!.open(DESCRIPTOR)
      const snapshot = await unit.loadAll()
      expect(snapshot.tables).toEqual({ alpha: {}, beta: {} })
      expect(snapshot.global).toBeNull()
      await backend.close()
    })

    it('round-trips records and global durably across reopen', async () => {
      const harness = await create()
      const unit = await harness.backend.kv!.open(DESCRIPTOR)
      await unit.putRecord('alpha', 'k1', { n: 1 })
      await unit.putRecord('alpha', 'k2', { n: 2 })
      await unit.putRecord('beta', 'weird key / with:stuff', { ok: true })
      await unit.setGlobal({ counter: 7 })
      await harness.backend.close()

      const reopened = await harness.reopen()
      const unit2 = await reopened.kv!.open(DESCRIPTOR)
      const snapshot = await unit2.loadAll()
      expect(snapshot.tables['alpha']).toEqual({ k1: { n: 1 }, k2: { n: 2 } })
      expect(snapshot.tables['beta']).toEqual({ 'weird key / with:stuff': { ok: true } })
      expect(snapshot.global).toEqual({ counter: 7 })
      await reopened.close()
    })

    it('putRecord overwrites and deleteRecord is idempotent', async () => {
      const { backend } = await create()
      const unit = await backend.kv!.open(DESCRIPTOR)
      await unit.putRecord('alpha', 'k', { v: 'old' })
      await unit.putRecord('alpha', 'k', { v: 'new' })
      await unit.deleteRecord('alpha', 'k')
      await unit.deleteRecord('alpha', 'k')
      await unit.deleteRecord('alpha', 'never-existed')
      const snapshot = await unit.loadAll()
      expect(snapshot.tables['alpha']).toEqual({})
      await backend.close()
    })

    it('rejects a version mismatch on reopen without touching the data', async () => {
      const harness = await create()
      const unit = await harness.backend.kv!.open(DESCRIPTOR)
      await unit.putRecord('alpha', 'k', { v: 1 })
      await harness.backend.close()

      const reopened = await harness.reopen()
      await expect(reopened.kv!.open({ ...DESCRIPTOR, version: 4 })).rejects.toMatchObject({
        name: 'StorageError',
        code: 'version-mismatch',
      })
      // Original version still opens and still holds the data.
      const unit2 = await reopened.kv!.open(DESCRIPTOR)
      expect((await unit2.loadAll()).tables['alpha']).toEqual({ k: { v: 1 } })
      await reopened.close()
    })

    it('rejects operations after unit close, and close is idempotent', async () => {
      const { backend } = await create()
      const unit = await backend.kv!.open(DESCRIPTOR)
      await unit.close()
      await unit.close()
      await expect(unit.putRecord('alpha', 'k', {})).rejects.toMatchObject({ code: 'closed' })
      await expect(unit.loadAll()).rejects.toMatchObject({ code: 'closed' })
      await backend.close()
      await backend.close()
    })
  })
}
