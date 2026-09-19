/** Current Host admission, cancellation and native action status through generated Remote calls. */
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { PresentedOpenController } from '../src/client/present-open.ts'
import { presentedFileKey } from '../src/presented.ts'
import { nativeFileRemote } from './native-file-fixture.client.ts'

const id = SessionId('fork')
const key = presentedFileKey(id, 2, 1)

it('makes no speculative metadata or action requests before capability discovery', async () => {
  const api = nativeFileRemote([])
  const controller = new PresentedOpenController(api.remote)
  await controller.loadHost()
  await controller.open(id, 2, 1)
  await controller.open(id, 2, 1, 'reveal')
  expect(controller.host.getSnapshot()).toBe('unsupported')
  expect(api.desktop).not.toHaveBeenCalled()
  expect(api.open).not.toHaveBeenCalled()
  expect(api.reveal).not.toHaveBeenCalled()
  api.remote.$host = { ...api.remote.$host, capabilities: ['presented-file.desktop.v1', 'presented-file.open.v1'] }
  controller.resetHost()
  await controller.loadHost()
  expect(controller.host.getSnapshot()).toMatchObject({ actions: ['open'] })
  await controller.dispose()
})

it.each([{ actions: [] }, { actions: ['open'] }, { actions: ['reveal'] }, { actions: ['open', 'reveal'] }] as const)('admits native actions independently: %j', async ({ actions }) => {
  const api = nativeFileRemote(['presented-file.desktop.v1', ...actions.map(action => 'presented-file.' + action + '.v1')])
  const controller = new PresentedOpenController(api.remote)
  await controller.loadHost()
  expect(controller.host.getSnapshot()).toMatchObject({ actions })
  await controller.open(id, 2, 1)
  await controller.open(id, 2, 1, 'reveal')
  expect(api.open).toHaveBeenCalledTimes(actions.some(action => action === 'open') ? 1 : 0)
  expect(api.reveal).toHaveBeenCalledTimes(actions.some(action => action === 'reveal') ? 1 : 0)
  await controller.dispose()
})

it('coalesces pending gestures for the same coordinates and allows a fresh later gesture', async () => {
  const api = nativeFileRemote()
  const reply = Promise.withResolvers<Awaited<ReturnType<typeof api.open>>>()
  api.open.mockReturnValueOnce(reply.promise)
  const controller = new PresentedOpenController(api.remote)
  await controller.loadHost()
  const pending = controller.open(id, 2, 1)
  await controller.open(id, 2, 1, 'reveal')
  expect(api.open).toHaveBeenCalledOnce()
  expect(api.reveal).not.toHaveBeenCalled()
  expect(api.open.mock.calls[0]?.[0]).toEqual({ sessionId: id, seq: 2, index: 1 })
  expect(controller.state.getSnapshot()[key]).toBe('opening')
  reply.resolve({ ok: true, value: { completed: true } })
  await pending
  expect(controller.state.getSnapshot()[key]).toBe('opened')
  await controller.open(id, 2, 1)
  expect(api.open).toHaveBeenCalledTimes(2)
  await controller.dispose()
})

it.each(['remote', 'transport'] as const)('reports retryable %s failures', async (failure) => {
  const api = nativeFileRemote()
  if (failure === 'remote') api.open.mockResolvedValueOnce({ ok: false, error: new RemoteError('presented-file/action-failed', 'unavailable', {}) })
  else api.open.mockRejectedValueOnce(new Error('offline'))
  const controller = new PresentedOpenController(api.remote)
  await controller.loadHost()
  await controller.open(id, 2, 1)
  expect(controller.state.getSnapshot()[key]).toBe('error')
  await controller.open(id, 2, 1)
  expect(controller.state.getSnapshot()[key]).toBe('opened')
  await controller.dispose()
})

it.each(['open', 'reveal'] as const)('keeps a verified-path refusal distinguishable for %s', async (action) => {
  const api = nativeFileRemote()
  api[action].mockResolvedValueOnce({ ok: false, error: new RemoteError('presented-file/path-unavailable', 'unavailable', {}) })
  const controller = new PresentedOpenController(api.remote)
  await controller.loadHost()
  await controller.open(id, 2, 1, action)
  expect(controller.state.getSnapshot()[key]).toBe('nativeUnavailable')
  await controller.dispose()
})

it('blocks retained callbacks when capability or metadata generation is withdrawn', async () => {
  const api = nativeFileRemote()
  const controller = new PresentedOpenController(api.remote)
  await controller.loadHost()
  api.remote.$host = { ...api.remote.$host, capabilities: [] }
  await controller.open(id, 2, 1)
  expect(api.open).not.toHaveBeenCalled()
  controller.resetHost()
  expect(controller.host.getSnapshot()).toBe('unsupported')
  expect(controller.state.getSnapshot()).toEqual({})
  await controller.dispose()
})

it('respects native policy even when every operation is advertised', async () => {
  const api = nativeFileRemote()
  api.desktop.mockResolvedValue({ ok: true, value: { name: 'headless', available: false, fileManager: null } })
  const controller = new PresentedOpenController(api.remote)
  await controller.loadHost()
  await controller.open(id, 2, 1)
  await controller.open(id, 2, 1, 'reveal')
  expect(api.open).not.toHaveBeenCalled()
  expect(api.reveal).not.toHaveBeenCalled()
  await controller.dispose()
})

it('retries failed metadata reads', async () => {
  const api = nativeFileRemote()
  api.desktop.mockRejectedValueOnce(new Error('offline'))
  const controller = new PresentedOpenController(api.remote)
  await controller.loadHost()
  expect(controller.host.getSnapshot()).toBe('error')
  await controller.loadHost()
  expect(controller.host.getSnapshot()).toMatchObject({ name: 'desktop' })
  await controller.dispose()
  await controller.loadHost()
  expect(api.desktop).toHaveBeenCalledTimes(2)
})

it('cancels old metadata and coalesces the replacement read without accepting late results', async () => {
  const api = nativeFileRemote()
  const old = Promise.withResolvers<Awaited<ReturnType<typeof api.desktop>>>()
  const next = Promise.withResolvers<Awaited<ReturnType<typeof api.desktop>>>()
  api.desktop.mockReturnValueOnce(old.promise).mockReturnValue(next.promise)
  const controller = new PresentedOpenController(api.remote)
  const first = controller.loadHost()
  api.remote.$host = { ...api.remote.$host }
  controller.resetHost()
  expect(api.desktop.mock.calls[0]?.[0]?.aborted).toBe(true)
  const second = controller.loadHost()
  old.resolve({ ok: true, value: { name: 'old', available: true, fileManager: 'finder' } })
  await first
  expect(controller.host.getSnapshot()).toBeNull()
  expect(api.desktop).toHaveBeenCalledTimes(2)
  next.resolve({ ok: true, value: { name: 'current', available: true, fileManager: 'explorer' } })
  await second
  expect(controller.host.getSnapshot()).toMatchObject({ name: 'current' })
  await controller.dispose()
})

it('cancels a pending action on replacement without replaying or publishing its old acknowledgement', async () => {
  const api = nativeFileRemote()
  const reply = Promise.withResolvers<Awaited<ReturnType<typeof api.open>>>()
  api.open.mockReturnValueOnce(reply.promise)
  const controller = new PresentedOpenController(api.remote)
  await controller.loadHost()
  const pending = controller.open(id, 2, 1)
  api.remote.$host = { ...api.remote.$host }
  controller.resetHost()
  expect(api.open.mock.calls[0]?.[1]?.aborted).toBe(true)
  reply.resolve({ ok: true, value: { completed: true } })
  await pending
  expect(controller.state.getSnapshot()).toEqual({})
  await controller.loadHost()
  expect(api.open).toHaveBeenCalledOnce()
  await controller.open(id, 2, 1)
  expect(api.open).toHaveBeenCalledTimes(2)
  await controller.dispose()
})

it('awaits outstanding actions on disposal and rejects later gestures', async () => {
  const api = nativeFileRemote()
  const reply = Promise.withResolvers<Awaited<ReturnType<typeof api.open>>>()
  api.open.mockReturnValueOnce(reply.promise)
  const controller = new PresentedOpenController(api.remote)
  await controller.loadHost()
  const pending = controller.open(id, 2, 1)
  let disposed = false
  const disposal = controller.dispose().then(() => { disposed = true })
  expect(api.open.mock.calls[0]?.[1]?.aborted).toBe(true)
  expect(disposed).toBe(false)
  reply.resolve({ ok: true, value: { completed: true } })
  await Promise.all([pending, disposal])
  expect(controller.state.getSnapshot()[key]).toBe('opening')
  await controller.open(id, 2, 1)
  expect(api.open).toHaveBeenCalledOnce()
})
