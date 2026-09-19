/** Capability, connection and save-lifecycle coverage for plugin configuration cards. */
import { expect, it, vi, onTestFinished } from 'vitest'
import { stubSettingsScope, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { CardForm, textField } from '../src/client/card-form.ts'
import { WebSearchCardController, type WebSearchSettings } from '../src/client/web-search-card-controller.ts'

const capabilities = ['settings.read.v1', 'settings.write.v1', 'credentials.describe.v1', 'credentials.write.v1']
function bench(hidden: readonly string[] = [], writable = true) {
  const scope = stubSettingsScope<WebSearchSettings>()
  const metadata = (configured: boolean) => ({ ok: true as const, value: { DEEPSEEK_API_KEY: { configured, writable } } })
  const remote = {
    $host: { home: undefined, isLoopback: true, capabilities: capabilities.filter(id => !hidden.includes(id)) },
    credentials: {
      describe: vi.fn(async () => metadata(false)),
      set: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
    },
  }
  const ctx = { remote } as unknown as ConstructorParameters<typeof WebSearchCardController>[1]
  const controller = new WebSearchCardController(scope.scope, ctx)
  onTestFinished(() => { controller.dispose() })
  const face = controller.inject()
  const state = () => face.hooks.webSearchCard.getSnapshot()
  const ready = () => { scope.publish({ status: 'ready', writable: true, value: {}, base: {}, user: {} }) }
  return { scope, remote, controller, face, state, ready, metadata }
}

it('does not probe before namespace acceptance or without credential metadata capability', async () => {
  const b = bench(['credentials.describe.v1'])
  expect(b.remote.credentials.describe).not.toHaveBeenCalled()
  b.ready()
  b.controller.refreshCredential('DEEPSEEK_API_KEY')
  b.face.edit('apiKey', 'fixture-only')
  b.face.save()
  expect(b.state()).toMatchObject({ available: true, apiKeySupported: false, apiKeyWritable: false, dirty: false })
  expect(b.remote.credentials.describe).not.toHaveBeenCalled()
  expect(b.remote.credentials.set).not.toHaveBeenCalled()
  b.face.edit('baseURL', 'https://fixture.invalid')
  expect(b.state().dirty).toBe(true)
})

it('hides unsupported credential writes while still reading supported metadata', async () => {
  const b = bench(['credentials.write.v1'])
  b.ready()
  await vi.waitFor(() => { expect(b.remote.credentials.describe).toHaveBeenCalledOnce() })
  b.face.edit('apiKey', 'fixture-only')
  b.face.save()
  expect(b.state()).toMatchObject({ apiKeySupported: false, apiKeyWritable: false, dirty: false })
  expect(b.remote.credentials.set).not.toHaveBeenCalled()
})

it('keeps provider read-only distinct from unsupported APIs', async () => {
  const b = bench([], false)
  b.ready()
  await vi.waitFor(() => { expect(b.remote.credentials.describe).toHaveBeenCalledOnce() })
  expect(b.state()).toMatchObject({ apiKeySupported: true, apiKeyWritable: false })
  b.face.edit('apiKey', 'fixture-only')
  b.face.save()
  expect(b.remote.credentials.set).not.toHaveBeenCalled()
})

it('allows a supported writable credential even when ordinary Settings writes are read-only', async () => {
  const b = bench(['settings.write.v1'])
  b.scope.publish({ status: 'ready', writable: false, value: {}, user: {} })
  await vi.waitFor(() => { expect(b.state().apiKeyWritable).toBe(true) })
  b.face.edit('baseURL', 'https://fixture.invalid')
  expect(b.state().dirty).toBe(false)
  b.face.edit('apiKey', 'fixture-only')
  b.remote.credentials.describe.mockResolvedValue(b.metadata(true))
  b.face.save()
  await vi.waitFor(() => { expect(b.state()).toMatchObject({ saving: false, dirty: false, failed: false }) })
  expect(b.remote.credentials.set).toHaveBeenCalledOnce()
  expect(b.scope.set).not.toHaveBeenCalled()
})

it('lets only the latest read publish metadata for the same reference', async () => {
  const b = bench()
  const first = Promise.withResolvers<ReturnType<typeof b.metadata>>()
  const second = Promise.withResolvers<ReturnType<typeof b.metadata>>()
  b.remote.credentials.describe.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  b.ready()
  b.controller.refreshCredential('DEEPSEEK_API_KEY')
  second.resolve(b.metadata(false))
  await vi.waitFor(() => { expect(b.state().apiKeyWritable).toBe(true) })
  first.resolve(b.metadata(true))
  await first.promise
  expect(b.state().apiKeyConfigured).toBe(false)
})

it('cannot publish a late read or use retained actions after Host replacement', async () => {
  const b = bench()
  const pending = Promise.withResolvers<ReturnType<typeof b.metadata>>()
  b.remote.credentials.describe.mockReturnValueOnce(pending.promise)
  b.ready()
  b.remote.$host = { ...b.remote.$host }
  b.controller.dispose()
  pending.resolve(b.metadata(true))
  await pending.promise
  b.face.edit('apiKey', 'fixture-only')
  b.face.edit('baseURL', 'https://fixture.invalid')
  b.face.save()
  expect(b.state()).toMatchObject({ available: false, dirty: false, apiKeyConfigured: false })
  expect(b.remote.credentials.set).not.toHaveBeenCalled()
  expect(b.scope.set).not.toHaveBeenCalled()
  expect(b.scope.listenerCount()).toBe(0)
})

it.each(['refused', 'rejected'])('does not report a %s credential write as successful just because an old key is configured', async (outcome) => {
  const b = bench()
  b.remote.credentials.describe.mockResolvedValue(b.metadata(true))
  b.ready()
  await vi.waitFor(() => { expect(b.state().apiKeyWritable).toBe(true) })
  b.remote.credentials.set.mockImplementationOnce(async () => {
    const error = new RemoteError('credential/rejected', 'fixture refusal', { ref: 'DEEPSEEK_API_KEY' })
    if (outcome === 'rejected') throw error
    return { ok: false, error }
  })
  b.face.edit('apiKey', 'fixture-only')
  b.face.save()
  await vi.waitFor(() => { expect(b.state()).toMatchObject({ failed: true, dirty: true, saving: false }) })
  expect(b.state().apiKeyConfigured).toBe(true)
})

it.each(['unavailable', 'dispose'] as const)('stops the remaining save steps after %s and clears drafts', async (kind) => {
  const scope = stubSettingsScope<Record<string, string>>()
  scope.publish({ status: 'ready', writable: true, value: {}, user: {} })
  const writeSecret = vi.fn(async () => true)
  const form = new CardForm(scope.scope, [textField('baseURL')], [{ field: 'apiKey', write: writeSecret }])
  onTestFinished(() => { form.dispose() })
  const pending = Promise.withResolvers<undefined>()
  scope.set.mockReturnValueOnce(pending.promise)
  form.actions().edit('baseURL', 'https://fixture.invalid')
  form.actions().edit('apiKey', 'fixture-only')
  const save = form.save()
  if (kind === 'dispose') form.dispose()
  else {
    scope.publish({ status: 'loading', writable: false })
    scope.publish({ status: 'ready', writable: true, value: {}, user: {} })
  }
  pending.resolve(undefined)
  await save
  expect(writeSecret).not.toHaveBeenCalled()
  expect(form.field('apiKey').text).toBe('')
  expect(form.shell()).toMatchObject({ saving: false, dirty: false, failed: false })
})

it('preserves a new edit made while an older value is saving', async () => {
  const scope = stubSettingsScope<Record<string, string>>()
  scope.publish({ status: 'ready', writable: true, value: {}, user: {} })
  const form = new CardForm(scope.scope, [textField('baseURL')])
  onTestFinished(() => { form.dispose() })
  const pending = Promise.withResolvers<undefined>()
  scope.set.mockReturnValueOnce(pending.promise)
  form.actions().edit('baseURL', 'https://first.invalid')
  const save = form.save()
  form.actions().edit('baseURL', 'https://second.invalid')
  scope.publish({ value: { baseURL: 'https://first.invalid' }, user: { baseURL: 'https://first.invalid' } })
  pending.resolve(undefined)
  await save
  expect(form.field('baseURL').text).toBe('https://second.invalid')
  expect(form.shell()).toMatchObject({ dirty: true, saving: false, failed: false })
})
