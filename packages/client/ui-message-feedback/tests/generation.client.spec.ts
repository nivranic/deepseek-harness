import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { MessageId, RemoteHostFacts, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { MessageFeedbackItem, MessageFeedbackVersion } from '@deepseek-ai/dsh-message-feedback/types'
import { MessageFeedbackController } from '../src/client/controller.ts'
import { FeedbackSurface } from '../src/client/surface.ts'
import { createFeedbackAccess } from '../src/client/access.ts'

const CAPS = ['feedback.message.read.v1', 'feedback.message.put.v1', 'feedback.message.delete.v1', 'feedback.session.record.v1']
const SID = 'session' as SessionId
const MID = 'message' as MessageId
const item = (version: string): MessageFeedbackItem => ({
  messageId: MID, rating: 'positive', version: version as MessageFeedbackVersion, createdAt: 1, updatedAt: 1,
})
const listResult = (version: string) => ({ ok: true, value: { ok: true, value: { items: [item(version)] } } })
const putResult = (version: string) => ({ ok: true, value: { ok: true, value: item(version) } })

function bench(capabilities: readonly string[] = CAPS) {
  let host: RemoteHostFacts = { home: undefined, isLoopback: true, capabilities }
  const list = vi.fn(async () => listResult('initial'))
  const put = vi.fn(async () => putResult('written'))
  const remove = vi.fn(async () => ({ ok: true, value: { ok: true, value: { absent: true } } }))
  const record = vi.fn(async () => ({ ok: true, value: { ok: true, value: { recorded: true } } }))
  const ctx = { remote: {
    get $host() { return host }, messageFeedback: { list, put, delete: remove }, sessionFeedback: { record },
  } } as unknown as Context
  const controller = new MessageFeedbackController(ctx, SID)
  const replace = (next = CAPS) => { host = { ...host, capabilities: next }; controller.handleGenerationChanged() }
  return { ctx, controller, list, put, remove, record, replace }
}

it('does not probe absent reads or send mutations without their independent capability', async () => {
  const b = bench([])
  await b.controller.ensure()
  await b.controller.rate(MID, 'positive')
  await b.controller.retract(MID, 'positive')
  expect(b.list).not.toHaveBeenCalled()
  expect(b.put).not.toHaveBeenCalled()
  expect(b.remove).not.toHaveBeenCalled()
  b.replace(['feedback.message.read.v1'])
  await b.controller.ensure()
  await b.controller.rate(MID, 'positive')
  await b.controller.retract(MID, 'positive')
  expect(b.controller.getSnapshot().items.get(MID)?.version).toBe('initial')
  expect(b.put).not.toHaveBeenCalled()
  expect(b.remove).not.toHaveBeenCalled()
})

it('discards a late list without releasing the replacement list request', async () => {
  const b = bench()
  const old = Promise.withResolvers<ReturnType<typeof listResult>>()
  const next = Promise.withResolvers<ReturnType<typeof listResult>>()
  b.list.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
  const first = b.controller.ensure()
  b.replace()
  const second = b.controller.ensure()
  old.resolve(listResult('old'))
  await first
  const shared = b.controller.ensure()
  expect(b.list).toHaveBeenCalledTimes(2)
  expect(b.controller.getSnapshot().items.size).toBe(0)
  next.resolve(listResult('new'))
  await Promise.all([second, shared])
  expect(b.controller.getSnapshot().items.get(MID)?.version).toBe('new')
})

it('rejects queued old-Host mutations and cannot publish their late acknowledgement', async () => {
  const b = bench()
  await b.controller.ensure()
  const old = Promise.withResolvers<ReturnType<typeof putResult>>()
  b.put.mockReturnValueOnce(old.promise)
  const first = b.controller.rate(MID, 'negative')
  await vi.waitFor(() => { expect(b.put).toHaveBeenCalledTimes(1) })
  const queued = b.controller.rate(MID, 'positive')
  b.replace()
  b.list.mockResolvedValueOnce(listResult('new'))
  await b.controller.ensure()
  old.resolve(putResult('old'))
  for (const pending of [first, queued]) expect(await pending).toMatchObject({ ok: false, error: { code: 'connection-changed' } })
  expect(b.put).toHaveBeenCalledTimes(1)
  expect(b.controller.getSnapshot().items.get(MID)?.version).toBe('new')
})

it('contains rejected reads and mutations and permits an explicit retry', async () => {
  const b = bench()
  b.list.mockRejectedValueOnce(new Error('transport'))
  expect(await b.controller.ensure()).toMatchObject({ ok: false })
  await b.controller.ensure()
  b.put.mockRejectedValueOnce(new Error('transport'))
  expect(await b.controller.rate(MID, 'positive')).toMatchObject({ ok: false })
  expect(await b.controller.rate(MID, 'positive')).toEqual({ ok: true })
})

it('cannot remove replacement feedback when an old delete acknowledges', async () => {
  const b = bench()
  await b.controller.ensure()
  const old = Promise.withResolvers<Awaited<ReturnType<typeof b.remove>>>()
  b.remove.mockReturnValueOnce(old.promise)
  const pending = b.controller.retract(MID, 'positive')
  await vi.waitFor(() => { expect(b.remove).toHaveBeenCalledTimes(1) })
  b.replace()
  b.list.mockResolvedValueOnce(listResult('replacement'))
  await b.controller.ensure()
  old.resolve({ ok: true, value: { ok: true, value: { absent: true } } })
  expect(await pending).toMatchObject({ ok: false, error: { code: 'connection-changed' } })
  expect(b.controller.getSnapshot().items.get(MID)?.version).toBe('replacement')
})

it('makes a rejected Session remark retryable and discards its state on disposal', async () => {
  const b = bench()
  const surface = new FeedbackSurface(b.ctx, SID)
  b.record.mockRejectedValueOnce(new Error('transport'))
  surface.open({ kind: 'session' })
  surface.dialog.edit({ text: 'retry this remark' })
  await surface.dialog.submitDraft()
  expect(surface.dialog.state.getSnapshot()).toMatchObject({ text: 'retry this remark', submitting: false, failure: 'request-failed' })
  await surface.dialog.submitDraft()
  expect(surface.dialog.state.getSnapshot().toast).toBe(1)
  surface.dispose()
  surface.open({ kind: 'session' })
  expect(surface.dialog.state.getSnapshot()).toMatchObject({ target: null, toast: 0 })
})

it('withdraws Session feedback drafts and ignores a prior success after opening a replacement draft', async () => {
  const b = bench()
  const surface = new FeedbackSurface(b.ctx, SID)
  const old = Promise.withResolvers<Awaited<ReturnType<typeof b.record>>>()
  b.record.mockReturnValueOnce(old.promise)
  surface.open({ kind: 'session' })
  surface.dialog.edit({ text: 'old draft' })
  const pending = surface.dialog.submitDraft()
  b.replace()
  surface.handleGenerationChanged()
  surface.open({ kind: 'session' })
  surface.dialog.edit({ text: 'new draft' })
  old.resolve({ ok: true, value: { ok: true, value: { recorded: true } } })
  await pending
  expect(surface.dialog.state.getSnapshot()).toMatchObject({ text: 'new draft', submitting: false, toast: 0, failure: null })
  b.replace([])
  surface.handleGenerationChanged()
  surface.open({ kind: 'session' })
  expect(surface.dialog.state.getSnapshot().target).toBeNull()
  expect(b.record).toHaveBeenCalledTimes(1)
})

it('invalidates retained access checks across equally capable connections and disposal', () => {
  const b = bench()
  let alive = true
  const source = createFeedbackAccess(() => b.ctx.remote.$host, () => alive, () => () => {})
  const old = source.getSnapshot()
  expect(source.getSnapshot()).toBe(old)
  b.replace()
  expect(old.current()).toBe(false)
  const next = source.getSnapshot()
  expect(next).toMatchObject({ read: true, put: true, delete: true, record: true })
  alive = false
  expect(next.current()).toBe(false)
  expect(source.getSnapshot().read).toBe(false)
})
