/** Models operations and provider reads follow the admitted Host, never a retained draft. */
import { expect, it, vi } from 'vitest'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { createModelsOperations } from '../src/client/operations.ts'
import { settingsSchema } from './settings-schema.client.ts'

const capabilities = ['llm.providers.v1', 'llm.discover-models.v1', 'credentials.describe.v1', 'credentials.write.v1', 'settings.read.v1', 'settings.write.v1']
const view = { ns: 'llm-deepseek', revision: 1, schema: {}, value: { apiKeyEnv: 'FIXTURE_API_KEY' }, base: {}, applies: 'live' as const, secrets: [] }
function bench(hidden: readonly string[] = []) {
  const remote = {
    $host: { home: undefined, platform: undefined, isLoopback: true, capabilities: capabilities.filter(id => !hidden.includes(id)) },
    llm: {
      listProviders: vi.fn(async () => ({ ok: true as const, value: [{ id: 'deepseek-official', name: 'DeepSeek' }] })),
      listConfigurableProviders: vi.fn(async () => ({ ok: true as const, value: [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }] })),
      discoverModels: vi.fn(async () => ({ ok: true as const, value: [] })),
    },
    credentials: {
      describe: vi.fn(async () => ({ ok: true as const, value: { FIXTURE_API_KEY: { configured: false, writable: true } } })),
      set: vi.fn(async () => ({ ok: true as const, value: undefined })),
      unset: vi.fn(async () => ({ ok: true as const, value: undefined })),
    },
    settings: {
      describe: vi.fn(async () => ({ ok: true as const, value: { namespaces: [view], writable: true, hasDocument: false } })),
      mutate: vi.fn(async () => ({ ok: true as const, value: view })),
    },
  }
  const ctx = { remote } as unknown as ConstructorParameters<typeof ModelsSettingsStore>[0]
  const mirror = new SettingsDescribeMirror(ctx)
  const store = new ModelsSettingsStore(ctx, settingsSchema, mirror)
  return { remote, mirror, store, operations: createModelsOperations(ctx, () => 'unavailable'),
    replace: (hidden: readonly string[] = []) => {
      remote.$host = { ...remote.$host, capabilities: capabilities.filter(id => !hidden.includes(id)) }
    } }
}

it.each(['llm.providers.v1', 'settings.read.v1'])('does not probe provider or credential APIs without %s', async (missing) => {
  const { store, remote } = bench([missing])
  await store.load()
  expect(store.store.getSnapshot()).toMatchObject({ status: 'unavailable', rows: [], writable: false })
  expect(remote.llm.listProviders).not.toHaveBeenCalled()
  expect(remote.llm.listConfigurableProviders).not.toHaveBeenCalled()
  expect(remote.credentials.describe).not.toHaveBeenCalled()
  expect(remote.settings.describe).not.toHaveBeenCalled()
})

it('keeps directory and ordinary Settings writes usable without credential or discovery support', async () => {
  const { store, remote, operations } = bench(['credentials.describe.v1', 'credentials.write.v1', 'llm.discover-models.v1'])
  await store.load()
  expect(store.store.getSnapshot()).toMatchObject({ status: 'ready', writable: true, rows: [{ credential: undefined }] })
  expect(remote.credentials.describe).not.toHaveBeenCalled()
  expect(await operations.describeCredential('FIXTURE_API_KEY')).toBeUndefined()
  expect(await operations.storeCredential('FIXTURE_API_KEY', 'fixture-only')).toBe('unavailable')
  expect(await operations.removeCredential('FIXTURE_API_KEY')).toBe('unavailable')
  expect(await operations.discoverModels('llm-deepseek', {})).toMatchObject({ kind: 'refused' })
  expect(remote.credentials.set).not.toHaveBeenCalled()
  expect(remote.credentials.unset).not.toHaveBeenCalled()
  expect(remote.llm.discoverModels).not.toHaveBeenCalled()
  expect(await operations.writeSettings('llm-deepseek', [], 1)).toMatchObject({ kind: 'written' })
})

it('reports credential writability only when both provider and Host permit the operation', async () => {
  const { store, operations } = bench(['credentials.write.v1'])
  await store.load()
  expect(store.store.getSnapshot().rows[0]?.credential?.writable).toBe(false)
  expect(await operations.describeCredential('FIXTURE_API_KEY')).toMatchObject({ writable: false })
})

it('clears old directory state and ignores a provider response after replacement', async () => {
  const { store, remote, replace, mirror } = bench()
  await store.load()
  const before = store.store.getSnapshot().connectionGeneration
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof remote.llm.listProviders>>>()
  remote.llm.listProviders.mockReturnValueOnce(pending.promise)
  const old = store.load()
  replace(['llm.providers.v1'])
  await mirror.load()
  await store.load()
  pending.resolve({ ok: true, value: [{ id: 'late', name: 'Late' }] })
  await old
  expect(store.store.getSnapshot()).toMatchObject({ status: 'unavailable', rows: [], connectionGeneration: before + 1 })
})

it('refuses retained callbacks and late Settings success before any credential follow-up', async () => {
  const { operations, remote, replace } = bench()
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof remote.settings.mutate>>>()
  remote.settings.mutate.mockReturnValueOnce(pending.promise)
  const write = operations.writeSettings('llm-deepseek', [], 1)
  replace()
  pending.resolve({ ok: true, value: view })
  expect(await write).toMatchObject({ kind: 'refused' })
  expect(await operations.storeCredential('FIXTURE_API_KEY', 'fixture-only')).toBe('unavailable')
  expect(await operations.removeCredential('FIXTURE_API_KEY')).toBe('unavailable')
  expect(await operations.describeCredential('FIXTURE_API_KEY')).toBeUndefined()
  expect(await operations.discoverModels('llm-deepseek', {})).toMatchObject({ kind: 'refused' })
  expect(remote.credentials.set).not.toHaveBeenCalled()
  expect(remote.credentials.unset).not.toHaveBeenCalled()
  expect(remote.credentials.describe).not.toHaveBeenCalled()
  expect(remote.llm.discoverModels).not.toHaveBeenCalled()
  expect(await operations.capture().storeCredential('FIXTURE_API_KEY', 'fixture-only')).toBeUndefined()
  expect(remote.credentials.set).toHaveBeenCalledOnce()
})

it('ignores credential enrichment from a replaced Host', async () => {
  const { remote, store, replace, mirror } = bench()
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof remote.credentials.describe>>>()
  remote.credentials.describe.mockReturnValueOnce(pending.promise)
  const old = store.load()
  await vi.waitFor(() =>{  expect(remote.credentials.describe).toHaveBeenCalledOnce() })
  replace(['credentials.describe.v1'])
  await mirror.load()
  await store.load()
  pending.resolve({ ok: true, value: { FIXTURE_API_KEY: { configured: false, writable: true } } })
  await old
  expect(store.store.getSnapshot().rows[0]?.credential).toBeUndefined()
})
