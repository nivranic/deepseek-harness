import { expect, it, vi } from 'vitest'
import { closeOwnedKvUnits } from '../src/index.ts'
import type { KvUnit } from '../src/backend.ts'

const unit = (close: () => Promise<void>): KvUnit => ({
  loadAll: async () => ({ tables: {}, global: null }),
  putRecord: async () => {},
  deleteRecord: async () => {},
  setGlobal: async () => {},
  close,
})

it('releases the medium after all owners and units settle, preserving every failure', async () => {
  const release = Promise.withResolvers<undefined>()
  const ownerError = new Error('owner')
  const unitError = new Error('unit')
  const mediumError = new Error('medium')
  const firstClose = vi.fn(async () => { throw unitError })
  const secondClose = vi.fn(async () => {})
  const mediumClose = vi.fn(() => { throw mediumError })
  const closing = closeOwnedKvUnits([
    { unit: unit(firstClose), onBackendClose: async () => { throw ownerError } },
    { unit: unit(secondClose), onBackendClose: async () => { await release.promise } },
  ], mediumClose)
  const failure = expect(closing).rejects.toMatchObject({ errors: [ownerError, unitError, mediumError] })
  try {
    await vi.waitFor(() => { expect(firstClose).toHaveBeenCalledOnce() })
    expect(secondClose).not.toHaveBeenCalled()
    expect(mediumClose).not.toHaveBeenCalled()
  } finally {
    release.resolve(undefined)
    await failure
  }
  expect(secondClose).toHaveBeenCalledOnce()
  expect(mediumClose).toHaveBeenCalledOnce()
})
