import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import AttachmentStore, { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type {
  FileAttachmentRef, ImageAttachmentRef, SaveFileAttachment, SaveFileStreamAttachment,
} from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import FileUploads from '@deepseek-ai/dsh-client-file-upload'
import type { FileUploadReceiptId, ImageUploadReceiptId } from '@deepseek-ai/dsh-client-file-upload/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import type { SessionRequestId } from '../src/types.ts'

const SESSION = SessionId('upload-session')
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function uploadHarness(origin?: 'subagent'): Promise<{
  ctx: Context
  controller: SessionCommandController
  uploads: FileUploads
  agent: Agent
  followup: ReturnType<typeof vi.fn>
  saveFile: ReturnType<typeof vi.fn>
  saveFileStream: ReturnType<typeof vi.fn>
  saveImages: ReturnType<typeof vi.fn>
  ensureFileByDigest: ReturnType<typeof vi.fn>
  disposeAgent: () => void
  uploadRoute: (request: Request) => Promise<Response>
  serializeImageAdmission: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SESSION, {
    meta: { cwd: '/workspace', ...(origin === undefined ? {} : { origin }) },
  })
  const inbox = createInboxStub()
  const followup = vi.fn()
  const agent = {
    id: session.id,
    session,
    inbox,
    status: 'idle',
    ctx: undefined,
    steer: vi.fn(),
    followup,
    cancel: vi.fn(),
  } as unknown as Agent
  ;(agent as { ctx: Context }).ctx = createScope(ctx, agent).ctx
  const disposeAgent = ctx.agents.register(agent)
  const saveFile = vi.fn((input: SaveFileAttachment): Promise<FileAttachmentRef> => Promise.resolve({
    attachmentId: AttachmentId(`sha256:${'cd'.repeat(32)}`),
    name: input.name ?? 'file',
    bytes: input.data.byteLength,
  }))
  const saveFileStream = vi.fn(async (input: SaveFileStreamAttachment): Promise<FileAttachmentRef> => {
    let bytes = 0
    for await (const chunk of input.data) bytes += chunk.byteLength
    return {
      attachmentId: AttachmentId(`sha256:${'ef'.repeat(32)}`),
      name: input.name ?? 'file',
      bytes,
    }
  })
  const saveImages = vi.fn((): Promise<readonly ImageAttachmentRef[]> =>
    Promise.reject(new Error('fixture did not expect image persistence')))
  const ensureFileByDigest = vi.fn((): Promise<FileAttachmentRef | undefined> => Promise.resolve(undefined))
  ctx.provide('attachments', Object.setPrototypeOf(
    {
      saveFile, saveFileStream, saveImages, ensureFileByDigest,
      imageLimits: {
        maxImageBytes: 4, maxImagesPerMessage: 2, maxMessageImageBytes: 4,
        maxImagePixels: 4, maxImageDimension: 2, mediaTypes: ['image/png'],
      },
    },
    AttachmentStore.prototype,
  ) as never)
  let uploadRoute: ((request: Request) => Promise<Response>) | undefined
  ctx.provide('connection', {
    fetch: {
      register: (route: { readonly fetch: (request: Request) => Promise<Response> }) => {
        uploadRoute = route.fetch
        return () => {}
      },
    },
  } as never)
  ctx.provide('llm', {
    listProviders: () => [{ id: 'fixture', name: 'Fixture' }],
    resolveModelInfo: () => Promise.resolve({ provider: 'fixture', id: 'fixture-model', name: 'Fixture' }),
  } as never)
  const selection: ModelSelectionRef = {
    current: { provider: 'fixture', model: 'fixture-model' },
    assembled: undefined,
  }
  const serializeImageAdmission = vi.fn(<Value>(_agent: Agent, operation: () => Promise<Value>) => operation())
  const agents = {
    resolveAgent: () => Promise.resolve({ agent }),
    selectionFor: () => selection,
    serializeImageAdmission,
  } as unknown as ApiSessionAgentController
  const uploads = new FileUploads(ctx)
  if (uploadRoute === undefined) throw new Error('file upload route was not registered')
  return {
    ctx,
    controller: new SessionCommandController(ctx, agents, '/workspace'),
    uploads,
    agent,
    followup,
    saveFile,
    saveFileStream,
    saveImages,
    ensureFileByDigest,
    disposeAgent,
    uploadRoute,
    serializeImageAdmission,
  }
}

function promptRequest(content: Parameters<SessionCommandController['prompt']>[0]['content']) {
  return {
    requestId: 'req-1' as SessionRequestId,
    sessionId: SESSION,
    mode: 'queue' as const,
    content,
  }
}

describe('Session file uploads', () => {
  it('registers an HTTP route bound to the upload service', async () => {
    const { uploadRoute } = await uploadHarness()
    await expect(uploadRoute(new Request('http://host/upload')))
      .resolves.toMatchObject({ status: 405 })
  })

  it('stages a stored digest without re-receiving bytes and binds it like a full upload', async () => {
    const { ctx, uploads, agent, saveFile, ensureFileByDigest } = await uploadHarness()
    const digest = 'ab'.repeat(32)
    const stored: FileAttachmentRef = {
      attachmentId: AttachmentId(`sha256:${digest}`), name: 'report.pdf', bytes: 9,
    }
    ensureFileByDigest.mockResolvedValueOnce(stored)
    const receipt = await uploads.uploadDedupe(
      agent, { digest, name: 'report.pdf' }, new AbortController().signal,
    )
    expect(ensureFileByDigest).toHaveBeenCalledWith(digest, 'report.pdf')
    expect(saveFile).not.toHaveBeenCalled()
    expect(receipt.file).toBe(stored)
    expect(uploads.resolve(agent, receipt.receiptId)).toBe(stored)
    const commandHandler = vi.fn((_invocation: unknown) => ({ kind: 'success' as const }))
    ctx.commands.register({
      name: 'reuse', description: 'Use a deduplicated file', risk: 'low',
      input: { hint: '<task>', attachments: true }, handler: commandHandler,
    })
    await ctx.commands.execute(
      agent,
      '/reuse inspect',
      [{ type: 'file', receiptId: receipt.receiptId }],
      new AbortController().signal,
    )
    expect(commandHandler.mock.calls[0]?.[0]).toMatchObject({
      attachments: [{ type: 'file', attachment: stored }],
    })
  })

  it('refuses an unknown digest so the caller falls back to a full upload', async () => {
    const { uploads, agent, saveFile, ensureFileByDigest } = await uploadHarness()
    await expect(uploads.uploadDedupe(agent, { digest: 'ab'.repeat(32) }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'session/attachment-invalid', details: { reason: 'FILE_DIGEST_NOT_KNOWN' } })
    expect(ensureFileByDigest).toHaveBeenCalledWith('ab'.repeat(32), undefined)
    expect(saveFile).not.toHaveBeenCalled()
  })

  it('rejects a malformed digest before touching the store', async () => {
    const { uploads, agent, ensureFileByDigest } = await uploadHarness()
    await expect(uploads.uploadDedupe(
      agent, { digest: `ZZ${'a'.repeat(62)}` }, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'session/attachment-invalid', details: { reason: 'FILE_DIGEST_INVALID' } })
    expect(ensureFileByDigest).not.toHaveBeenCalled()
  })

  it('rejects subagent deduplicated uploads before any store lookup', async () => {
    const child = await uploadHarness('subagent')
    await expect(child.uploads.uploadDedupe(
      child.agent, { digest: 'ab'.repeat(32) }, new AbortController().signal,
    )).rejects.toMatchObject({
      code: 'subagent/attachment-invalid',
      details: { reason: 'SUBAGENT_FILE_UNSUPPORTED' },
    })
    expect(child.ensureFileByDigest).not.toHaveBeenCalled()
  })

  it('stages one verbatim upload and preserves its order with an admitted image', async () => {
    const { ctx, controller, uploads, agent, followup, saveFile, saveImages } = await uploadHarness()
    const receipt = await uploads.upload(agent, { data: 'AAAA', name: 'notes.pdf' }, new AbortController().signal)
    expect(saveFile).toHaveBeenCalledTimes(1)
    expect(receipt.file.name).toBe('notes.pdf')
    expect(receipt.file.bytes).toBe(3)
    expect(uploads.resolve(agent, receipt.receiptId)).toEqual(receipt.file)
    expect(uploads.resolve(agent, 'missing' as FileUploadReceiptId)).toBeUndefined()
    const commandHandler = vi.fn((_invocation: unknown) => ({ kind: 'success' as const }))
    ctx.commands.register({
      name: 'files', description: 'Use staged files', risk: 'low', input: { hint: '<task>', attachments: true },
      handler: commandHandler,
    })
    await ctx.commands.execute(
      agent,
      '/files inspect',
      [{ type: 'file', receiptId: receipt.receiptId }],
      new AbortController().signal,
    )
    expect(commandHandler.mock.calls[0]?.[0]).toMatchObject({
      attachments: [{ type: 'file', attachment: receipt.file }],
    })
    const image: ImageAttachmentRef = {
      attachmentId: AttachmentId(`sha256:${'ab'.repeat(32)}`),
      mediaType: 'image/png',
      bytes: 3,
      width: 1,
      height: 1,
    }
    saveImages.mockResolvedValueOnce([image])
    await controller.prompt(promptRequest([
      { type: 'file', receiptId: receipt.receiptId },
      { type: 'image', mediaType: 'image/png', data: 'AAAA' },
      { type: 'text', text: 'read it' },
    ]))
    expect(followup).toHaveBeenCalledTimes(1)
    const message = followup.mock.calls[0]?.[0] as UserMessage
    expect(message.content).toEqual([
      { type: 'file', attachment: receipt.file },
      { type: 'image', attachment: image },
      { type: 'text', text: 'read it' },
    ])
  })

  it('stages a bounded byte stream and forwards cancellation to storage', async () => {
    const { controller, uploads, followup, saveFileStream } = await uploadHarness()
    const abort = new AbortController()
    const receipt = await uploads.uploadStream({
      sessionId: SESSION,
      data: (async function* (): AsyncIterable<Uint8Array> {
        yield Uint8Array.of(1, 2)
        yield Uint8Array.of(3, 4, 5)
      })(),
      signal: abort.signal,
      name: 'huge.bin',
    })
    expect(saveFileStream).toHaveBeenCalledWith(expect.objectContaining({
      signal: abort.signal,
      name: 'huge.bin',
    }))
    expect(receipt.file).toMatchObject({ name: 'huge.bin', bytes: 5 })
    await controller.prompt(promptRequest([{ type: 'file', receiptId: receipt.receiptId }]))
    expect((followup.mock.calls[0]?.[0] as UserMessage).content).toEqual([
      { type: 'file', attachment: receipt.file },
    ])
  })

  it('keeps the stream name optional and maps storage failures through the same error vocabulary', async () => {
    const { uploads, saveFileStream } = await uploadHarness()
    const stream = (async function* (): AsyncIterable<Uint8Array> {})()
    await expect(uploads.uploadStream({ sessionId: SESSION, data: stream }))
      .resolves.toMatchObject({ file: { name: 'file', bytes: 0 } })
    expect(saveFileStream).toHaveBeenLastCalledWith({ data: stream })
    saveFileStream.mockRejectedValueOnce('disk offline')
    await expect(uploads.uploadStream({
      sessionId: SESSION,
      data: (async function* (): AsyncIterable<Uint8Array> { yield Uint8Array.of(1) })(),
    }))
      .rejects.toMatchObject({
        code: 'gateway/internal', message: 'failed to store file upload: disk offline',
      })
  })

  it('rejects a prompt citing a file that was never staged for the session', async () => {
    const { controller, followup, saveImages } = await uploadHarness()
    await expect(controller.prompt(promptRequest([
      { type: 'image', mediaType: 'image/png', data: 'AAAA' },
      { type: 'file', receiptId: 'missing-receipt' as FileUploadReceiptId },
    ]))).rejects.toMatchObject({ code: 'session/attachment-invalid', details: { reason: 'FILE_NOT_STAGED' } })
    expect(followup).not.toHaveBeenCalled()
    expect(saveImages).not.toHaveBeenCalled()
  })

  it('publishes no receipt when its exact Agent is disposed during storage', async () => {
    const { uploads, agent, saveFile, disposeAgent } = await uploadHarness()
    const saved = Promise.withResolvers<FileAttachmentRef>()
    saveFile.mockReturnValueOnce(saved.promise)
    const uploading = uploads.upload(agent, { data: 'AAAA', name: 'late.bin' }, new AbortController().signal)
    await vi.waitFor(() => { expect(saveFile).toHaveBeenCalledOnce() })
    disposeAgent()
    saved.resolve({
      attachmentId: AttachmentId(`sha256:${'ab'.repeat(32)}`), name: 'late.bin', bytes: 3,
    })
    await expect(uploading).rejects.toMatchObject({ code: 'session/not-found' })
  })

  it('resolves a cold ordinary Agent and releases the resolver registration', async () => {
    const { ctx, uploads, agent, disposeAgent } = await uploadHarness()
    disposeAgent()
    const resolveAgent = vi.fn(async () => {
      ctx.agents.register(agent)
      return agent
    })
    const disposeResolver = uploads.registerAgentResolver(resolveAgent)
    expect(() => { uploads.registerAgentResolver(resolveAgent) }).toThrow('already registered')
    await expect(uploads.uploadStream({
      sessionId: SESSION,
      data: (async function* (): AsyncIterable<Uint8Array> { yield Uint8Array.of(1) })(),
    })).resolves.toMatchObject({ file: { bytes: 1 } })
    expect(resolveAgent).toHaveBeenCalledWith(SESSION)
    disposeResolver()
    const replacement = vi.fn(async () => agent)
    const disposeReplacement = uploads.registerAgentResolver(replacement)
    disposeResolver()
    expect(() => { uploads.registerAgentResolver(replacement) }).toThrow('already registered')
    expect(disposeReplacement).toBeTypeOf('function')
    disposeReplacement()
  })

  it('rejects a cold upload when no Agent resolver is registered', async () => {
    const { uploads, disposeAgent } = await uploadHarness()
    disposeAgent()
    await expect(uploads.uploadStream({
      sessionId: SESSION,
      data: (async function* (): AsyncIterable<Uint8Array> {})(),
    })).rejects.toMatchObject({ code: 'session/not-found' })
  })

  it('rejects subagent uploads and access outside the receiving Agent scope', async () => {
    const child = await uploadHarness('subagent')
    await expect(child.uploads.upload(
      child.agent,
      { data: 'AAAA' },
      new AbortController().signal,
    )).rejects.toMatchObject({
      code: 'subagent/attachment-invalid',
      details: { reason: 'SUBAGENT_FILE_UNSUPPORTED' },
    })
    expect(child.saveFile).not.toHaveBeenCalled()

    const ordinary = await uploadHarness()
    const receipt = await ordinary.uploads.upload(
      ordinary.agent,
      { data: 'AAAA' },
      new AbortController().signal,
    )
    const foreignScope = { ...ordinary.agent, ctx: ordinary.ctx } as Agent
    expect(() => ordinary.uploads.resolve(foreignScope, receipt.receiptId))
      .toThrow('operation requires the Agent\'s own scope')
  })

  it('retires accepted receipts after their rpcId becomes observable', async () => {
    const { controller, uploads, agent } = await uploadHarness()
    uploads.retirePrompt(agent, 'not-staged')
    const receipt = await uploads.upload(agent, { data: 'AAAA' }, new AbortController().signal)
    await controller.prompt(promptRequest([{ type: 'file', receiptId: receipt.receiptId }]))
    expect(uploads.resolve(agent, receipt.receiptId)).toEqual(receipt.file)
    uploads.retirePrompt(agent, 'other-request')
    expect(uploads.resolve(agent, receipt.receiptId)).toEqual(receipt.file)
    uploads.retirePrompt(agent, 'req-1')
    expect(uploads.resolve(agent, receipt.receiptId)).toBeUndefined()
  })

  it('retires observed prompt receipts and drops staged state with the Session', async () => {
    const first = await uploadHarness()
    const observed = await first.uploads.upload(
      first.agent,
      { data: 'AAAA' },
      new AbortController().signal,
    )
    await first.controller.prompt(promptRequest([{ type: 'file', receiptId: observed.receiptId }]))
    first.ctx.emit('session/event', first.agent.session, {
      type: 'user/message',
      data: createUserMessage({
        content: [{ type: 'text', text: 'extension event' }],
        source: { kind: 'user', rpcId: 1 } as never,
      }),
    } as never)
    expect(first.uploads.resolve(first.agent, observed.receiptId)).toEqual(observed.file)
    first.agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'observed' }],
      source: { kind: 'user', rpcId: 'req-1' as SessionRequestId },
    }), { surfaceOp: 'append' })
    expect(first.uploads.resolve(first.agent, observed.receiptId)).toBeUndefined()

    const second = await uploadHarness()
    const abandoned = await second.uploads.upload(
      second.agent,
      { data: 'AAAA' },
      new AbortController().signal,
    )
    second.ctx.emit('session/disposed', second.agent.session)
    expect(second.uploads.resolve(second.agent, abandoned.receiptId)).toBeUndefined()
  })

  it('deduplicates a retried rpcId already present in the Agent inbox', async () => {
    const { controller, agent, followup } = await uploadHarness()
    const request = promptRequest([{ type: 'text', text: 'once' }])
    await controller.prompt(request)
    agent.inbox.append('next-turn', followup.mock.calls[0]?.[0] as UserMessage)
    await expect(controller.prompt(request)).resolves.toEqual({ accepted: true })
    expect(followup).toHaveBeenCalledOnce()
  })

  it.each(['queue', 'steer'] as const)('admits concurrent %s retries only once after attachment admission', async (mode) => {
    const { ctx, controller, agent, followup } = await uploadHarness()
    const admitted = Promise.withResolvers<{ readonly type: 'text'; readonly text: string }[]>()
    const admission = vi.spyOn(ctx.attachments, 'admitPromptContent').mockReturnValue(admitted.promise)
    const deliver = (message: UserMessage): void => {
      agent.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] })
      agent.inbox.append('next-turn', message)
    }
    followup.mockImplementation(deliver)
    const steer = vi.spyOn(agent, 'steer').mockImplementation(deliver)
    const request = { ...promptRequest([{ type: 'text', text: 'once' }]), mode }
    const first = controller.prompt(request)
    const retry = controller.prompt(request)
    await vi.waitFor(() => { expect(admission).toHaveBeenCalledTimes(2) })
    admitted.resolve([{ type: 'text', text: 'once' }])
    await expect(Promise.all([first, retry])).resolves.toEqual([{ accepted: true }, { accepted: true }])
    expect(mode === 'queue' ? followup : steer).toHaveBeenCalledOnce()
    expect(agent.inbox.nextTurn).toHaveLength(1)
  })

  it.each(['claimed', 'cancelled'] as const)('does not resurrect an accepted request after its inbox occurrence is %s', async (state) => {
    const { controller, agent, followup } = await uploadHarness()
    const request = promptRequest([{ type: 'text', text: 'once' }])
    const message = createUserMessage({ content: [{ type: 'text', text: 'once' }],
      source: { kind: 'user', rpcId: request.requestId } })
    agent.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] })
    agent.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [],
      ...(state === 'cancelled' ? { outcome: 'canceled' as const } : {}),
    })
    expect(agent.inbox.nextTurn).toHaveLength(0)
    await expect(controller.prompt(request)).resolves.toEqual({ accepted: true })
    expect(followup).not.toHaveBeenCalled()
  })

  it('allows the same request identity after an admission failed before insertion', async () => {
    const { controller, followup } = await uploadHarness()
    const request = promptRequest([{ type: 'text', text: 'retry rejected admission' }])
    followup.mockImplementationOnce(() => { throw new Error('not admitted') })
    await expect(controller.prompt(request)).rejects.toMatchObject({ code: 'session/agent-busy' })
    await expect(controller.prompt(request)).resolves.toEqual({ accepted: true })
    expect(followup).toHaveBeenCalledTimes(2)
  })

  it('deduplicates a retried rpcId already present in the durable log', async () => {
    const { controller, agent, followup } = await uploadHarness()
    const request = promptRequest([{ type: 'text', text: 'once' }])
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'unidentified' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'accepted' }],
      source: { kind: 'user', rpcId: request.requestId },
    }), { surfaceOp: 'append' })

    await expect(controller.prompt(request)).resolves.toEqual({ accepted: true })
    expect(followup).not.toHaveBeenCalled()
  })

  it('rejects when the Agent disappears during prompt admission', async () => {
    const { controller, saveImages, disposeAgent } = await uploadHarness()
    const admitted = Promise.withResolvers<readonly ImageAttachmentRef[]>()
    saveImages.mockReturnValueOnce(admitted.promise)
    const prompting = controller.prompt(promptRequest([
      { type: 'image', mediaType: 'image/png', data: 'AAAA' },
    ]))
    await vi.waitFor(() => { expect(saveImages).toHaveBeenCalledOnce() })
    disposeAgent()
    admitted.resolve([{
      attachmentId: AttachmentId('admitted-image'), mediaType: 'image/png', bytes: 3, width: 1, height: 1,
    }])
    await expect(prompting).rejects.toMatchObject({ code: 'session/not-found' })
  })

  it('rejects when a previously bound receipt retires during image admission', async () => {
    const { controller, uploads, agent, saveImages } = await uploadHarness()
    const receipt = await uploads.upload(agent, { data: 'AAAA' }, new AbortController().signal)
    await controller.prompt(promptRequest([{ type: 'file', receiptId: receipt.receiptId }]))
    const admitted = Promise.withResolvers<readonly ImageAttachmentRef[]>()
    saveImages.mockReturnValueOnce(admitted.promise)
    const prompting = controller.prompt({
      ...promptRequest([
        { type: 'file', receiptId: receipt.receiptId },
        { type: 'image', mediaType: 'image/png', data: 'AAAA' },
      ]),
      requestId: 'req-2' as SessionRequestId,
    })
    await vi.waitFor(() => { expect(saveImages).toHaveBeenCalledOnce() })
    uploads.retirePrompt(agent, 'req-1')
    admitted.resolve([{
      attachmentId: AttachmentId('admitted-image'), mediaType: 'image/png', bytes: 3, width: 1, height: 1,
    }])
    await expect(prompting).rejects.toMatchObject({
      code: 'session/attachment-invalid', details: { reason: 'FILE_NOT_STAGED' },
    })
  })

  it('keeps the prior receipt binding when a later prompt attempt fails', async () => {
    const { controller, uploads, agent, followup } = await uploadHarness()
    const receipt = await uploads.upload(agent, { data: 'AAAA' }, new AbortController().signal)
    await controller.prompt(promptRequest([{ type: 'file', receiptId: receipt.receiptId }]))
    followup.mockImplementationOnce(() => { throw new Error('busy') })
    await expect(controller.prompt({
      ...promptRequest([{ type: 'file', receiptId: receipt.receiptId }]),
      requestId: 'req-2' as SessionRequestId,
    })).rejects.toMatchObject({ code: 'session/agent-busy' })
    uploads.retirePrompt(agent, 'req-1')
    expect(uploads.resolve(agent, receipt.receiptId)).toBeUndefined()
  })

  it('restores an unbound receipt after prompt delivery fails', async () => {
    const { controller, uploads, agent, followup } = await uploadHarness()
    const receipt = await uploads.upload(agent, { data: 'AAAA' }, new AbortController().signal)
    followup.mockImplementationOnce(() => { throw new Error('busy') })
    await expect(controller.prompt(promptRequest([
      { type: 'file', receiptId: receipt.receiptId },
    ]))).rejects.toMatchObject({ code: 'session/agent-busy' })
    uploads.retirePrompt(agent, 'req-1')
    expect(uploads.resolve(agent, receipt.receiptId)).toEqual(receipt.file)
  })

  it('retires a prompt-bound receipt when its queued occurrence is removed', async () => {
    const { controller, uploads, agent, followup } = await uploadHarness()
    const receipt = await uploads.upload(agent, { data: 'AAAA' }, new AbortController().signal)
    await controller.prompt(promptRequest([{ type: 'file', receiptId: receipt.receiptId }]))
    const queued = followup.mock.calls[0]?.[0] as UserMessage
    agent.inbox.append('next-turn', queued)
    expect(controller.updateQueue({
      sessionId: SESSION,
      itemId: queued.id,
      action: { kind: 'remove' },
    })).toEqual({ accepted: true })
    expect(uploads.resolve(agent, receipt.receiptId)).toBeUndefined()
  })

  it('keeps separate names for identical bytes uploaded more than once', async () => {
    const { controller, uploads, agent, followup } = await uploadHarness()
    const first = await uploads.upload(agent, { data: 'AAAA', name: 'first.txt' }, new AbortController().signal)
    const second = await uploads.upload(agent, { data: 'AAAA', name: 'second.txt' }, new AbortController().signal)
    expect(first.file.attachmentId).toBe(second.file.attachmentId)
    expect(first.receiptId).not.toBe(second.receiptId)

    await controller.prompt(promptRequest([
      { type: 'file', receiptId: first.receiptId },
      { type: 'file', receiptId: second.receiptId },
    ]))

    const message = followup.mock.calls[0]?.[0] as UserMessage
    expect(message.content).toEqual([
      { type: 'file', attachment: first.file },
      { type: 'file', attachment: second.file },
    ])
  })

  it('maps a non-canonical payload to the wire attachment error', async () => {
    const { uploads, agent, saveFile } = await uploadHarness()
    await expect(uploads.upload(agent, { data: 'not base64!!' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'session/attachment-invalid', details: { reason: 'INVALID_FILE_BASE64' } })
    expect(saveFile).not.toHaveBeenCalled()
  })

  it('maps an unexpected storage failure to the internal wire error', async () => {
    const { uploads, agent, saveFile } = await uploadHarness()
    saveFile.mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(uploads.upload(agent, { data: 'AAAA' }, new AbortController().signal))
      .rejects.toMatchObject({
        code: 'gateway/internal',
        message: 'failed to store file upload: Error: disk unavailable',
      })
  })
})

const NORMALIZED_IMAGE: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'ab'.repeat(32)}`),
  mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 'photo.png',
}

async function stageImage(harness: Awaited<ReturnType<typeof uploadHarness>>, data = 'AAAA') {
  harness.saveImages.mockResolvedValueOnce([NORMALIZED_IMAGE])
  return harness.uploads.uploadImage(harness.agent, {
    data, mediaType: 'image/png', name: 'photo.png',
  }, new AbortController().signal)
}

describe('Session staged image uploads', () => {
  it('returns normalized metadata and keeps the original byte count only on the Host', async () => {
    const h = await uploadHarness()
    const receipt = await stageImage(h)
    expect(receipt).toEqual({ receiptId: expect.any(String) as string, image: NORMALIZED_IMAGE })
    expect(h.saveImages).toHaveBeenCalledWith([{
      data: Uint8Array.of(0, 0, 0), mediaType: 'image/png', name: 'photo.png',
    }])
    expect(h.uploads.resolveImage(h.agent, receipt.receiptId)).toEqual({
      type: 'staged-image', attachment: NORMALIZED_IMAGE, originalBytes: 3,
    })
  })

  it('rejects malformed bytes, provider failures, and a cancelled caller without publishing a receipt', async () => {
    const h = await uploadHarness()
    await expect(h.uploads.uploadImage(h.agent, {
      data: 'AAA', mediaType: 'image/png',
    }, new AbortController().signal)).rejects.toMatchObject({
      code: 'session/attachment-invalid', details: { reason: 'INVALID_IMAGE_BASE64' },
    })
    expect(h.saveImages).not.toHaveBeenCalled()
    const cancelled = new AbortController()
    const reason = new Error('cancel image upload')
    cancelled.abort(reason)
    await expect(h.uploads.uploadImage(h.agent, {
      data: 'AAAA', mediaType: 'image/png',
    }, cancelled.signal)).rejects.toBe(reason)
    expect(h.saveImages).not.toHaveBeenCalled()
    h.saveImages.mockRejectedValueOnce(new AttachmentError('invalid raster', 'INVALID_IMAGE'))
    await expect(h.uploads.uploadImage(h.agent, {
      data: 'AAAA', mediaType: 'image/png',
    }, new AbortController().signal)).rejects.toMatchObject({
      code: 'session/attachment-invalid', details: { reason: 'INVALID_IMAGE' },
    })
    h.saveImages.mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(h.uploads.uploadImage(h.agent, {
      data: 'AAAA', mediaType: 'image/png',
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'gateway/internal' })
  })

  it.each(['disposed', 'cancelled'] as const)('rejects an upload %s while its image is being stored', async (ending) => {
    const h = await uploadHarness()
    const saved = Promise.withResolvers<readonly ImageAttachmentRef[]>()
    h.saveImages.mockReturnValueOnce(saved.promise)
    const abort = new AbortController()
    const reason = new Error('image upload cancelled')
    const uploading = h.uploads.uploadImage(h.agent, { data: 'AAAA', mediaType: 'image/png' }, abort.signal)
    await vi.waitFor(() => { expect(h.saveImages).toHaveBeenCalledOnce() })
    if (ending === 'disposed') h.disposeAgent()
    else abort.abort(reason)
    saved.resolve([NORMALIZED_IMAGE])
    if (ending === 'disposed') await expect(uploading).rejects.toMatchObject({ code: 'session/not-found' })
    else await expect(uploading).rejects.toBe(reason)
  })

  it('rejects subagent image staging before storage', async () => {
    const h = await uploadHarness('subagent')
    await expect(h.uploads.uploadImage(h.agent, {
      data: 'AAAA', mediaType: 'image/png',
    }, new AbortController().signal)).rejects.toMatchObject({
      code: 'subagent/attachment-invalid', details: { reason: 'SUBAGENT_IMAGE_UNSUPPORTED' },
    })
    expect(h.saveImages).not.toHaveBeenCalled()
  })

  it('rejects unknown, foreign, attachment-id, and file receipts before storing inline images', async () => {
    const h = await uploadHarness()
    const foreign = await uploadHarness()
    const image = await stageImage(foreign)
    const file = await h.uploads.upload(h.agent, { data: 'AAAA' }, new AbortController().signal)
    for (const receiptId of ['missing', image.receiptId, image.image.attachmentId, file.receiptId]) {
      await expect(h.controller.prompt(promptRequest([
        { type: 'image', mediaType: 'image/png', data: 'AQ==' },
        { type: 'staged-image', receiptId: receiptId as ImageUploadReceiptId },
      ]))).rejects.toMatchObject({
        code: 'session/attachment-invalid', details: { reason: 'IMAGE_NOT_STAGED' },
      })
    }
    expect(h.saveImages).not.toHaveBeenCalled()
    expect(h.followup).not.toHaveBeenCalled()
    const own = await stageImage(h)
    await expect(h.controller.prompt(promptRequest([
      { type: 'file', receiptId: own.receiptId as unknown as FileUploadReceiptId },
    ]))).rejects.toMatchObject({
      code: 'session/attachment-invalid', details: { reason: 'FILE_NOT_STAGED' },
    })
  })

  it('preserves mixed order and admits the exact combined original-byte limit', async () => {
    const h = await uploadHarness()
    const image = await stageImage(h)
    const file = await h.uploads.upload(h.agent, { data: 'AAAA' }, new AbortController().signal)
    const inline = { ...NORMALIZED_IMAGE, name: 'inline.png' }
    h.saveImages.mockResolvedValueOnce([inline])
    await h.controller.prompt(promptRequest([
      { type: 'staged-image', receiptId: image.receiptId },
      { type: 'file', receiptId: file.receiptId },
      { type: 'text', text: 'compare' },
      { type: 'image', mediaType: 'image/png', data: 'AQ==' },
    ]))
    expect(h.serializeImageAdmission).toHaveBeenCalledOnce()
    expect((h.followup.mock.calls[0]?.[0] as UserMessage).content).toEqual([
      { type: 'image', attachment: image.image },
      { type: 'file', attachment: file.file },
      { type: 'text', text: 'compare' },
      { type: 'image', attachment: inline },
    ])
  })

  it('counts every receipt occurrence and combines staged original bytes with inline bytes', async () => {
    const h = await uploadHarness()
    const image = await stageImage(h)
    const part = { type: 'staged-image' as const, receiptId: image.receiptId }
    for (const [content, reason] of [
      [[part, part, part], 'TOO_MANY_IMAGES'],
      [[part, part], 'IMAGES_TOO_LARGE'],
      [[part, { type: 'image' as const, mediaType: 'image/png' as const, data: 'AQI=' }], 'IMAGES_TOO_LARGE'],
    ] as const) {
      await expect(h.controller.prompt(promptRequest(content))).rejects.toMatchObject({
        code: 'session/attachment-invalid', details: { reason },
      })
    }
    expect(h.saveImages).toHaveBeenCalledOnce()
    expect(h.followup).not.toHaveBeenCalled()
  })

  it('preserves repeated staged images within the combined limits and inserts concurrent retries once', async () => {
    const h = await uploadHarness()
    const image = await stageImage(h, 'AQ==')
    const file = await h.uploads.upload(h.agent, { data: 'AAAA' }, new AbortController().signal)
    h.followup.mockImplementation((message: UserMessage) => {
      h.agent.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] })
      h.agent.inbox.append('next-turn', message)
    })
    const request = promptRequest([
      { type: 'staged-image', receiptId: image.receiptId },
      { type: 'file', receiptId: file.receiptId },
      { type: 'staged-image', receiptId: image.receiptId },
    ])
    await expect(Promise.all([h.controller.prompt(request), h.controller.prompt(request)]))
      .resolves.toEqual([{ accepted: true }, { accepted: true }])
    expect(h.followup).toHaveBeenCalledOnce()
    expect(h.agent.inbox.nextTurn[0]?.content).toEqual([
      { type: 'image', attachment: image.image },
      { type: 'file', attachment: file.file },
      { type: 'image', attachment: image.image },
    ])
    expect(h.saveImages).toHaveBeenCalledOnce()
  })

  it('checks the current model for a prompt containing only staged images', async () => {
    const h = await uploadHarness()
    const image = await stageImage(h)
    vi.spyOn(h.ctx.llm, 'resolveModelInfo').mockResolvedValue({
      provider: 'fixture', id: 'fixture-model', name: 'Fixture', inputModalities: ['text'],
    })
    await expect(h.controller.prompt(promptRequest([
      { type: 'staged-image', receiptId: image.receiptId },
    ]))).rejects.toMatchObject({
      code: 'session/attachment-invalid', details: { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' },
    })
    expect(h.serializeImageAdmission).toHaveBeenCalledOnce()
    expect(h.followup).not.toHaveBeenCalled()
    expect(h.uploads.resolveImage(h.agent, image.receiptId)).toBeDefined()
  })

  it.each(['observed', 'removed'] as const)('deduplicates an accepted prompt after its image receipt is %s', async (retirement) => {
    const h = await uploadHarness()
    const image = await stageImage(h)
    h.followup.mockImplementation((message: UserMessage) => {
      h.agent.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] })
      h.agent.inbox.append('next-turn', message)
    })
    const request = promptRequest([{ type: 'staged-image', receiptId: image.receiptId }])
    await h.controller.prompt(request)
    const message = h.followup.mock.calls[0]?.[0] as UserMessage
    if (retirement === 'observed') {
      h.agent.session.append('user/message', message, { surfaceOp: 'append' })
      h.agent.inbox.remove(message.id)
    } else {
      h.controller.updateQueue({ sessionId: SESSION, itemId: message.id, action: { kind: 'remove' } })
    }
    expect(h.uploads.resolveImage(h.agent, image.receiptId)).toBeUndefined()
    await expect(h.controller.prompt(request)).resolves.toEqual({ accepted: true })
    await expect(h.controller.prompt({ ...request, requestId: 'different' as SessionRequestId })).rejects.toMatchObject({
      code: 'session/attachment-invalid', details: { reason: 'IMAGE_NOT_STAGED' },
    })
    expect(h.followup).toHaveBeenCalledOnce()
    expect(h.saveImages).toHaveBeenCalledOnce()
  })

  it.each([false, true])('restores the image receipt owner when delivery fails (previously bound: %s)', async (previouslyBound) => {
    const h = await uploadHarness()
    const image = await stageImage(h)
    const file = await h.uploads.upload(h.agent, { data: 'AAAA' }, new AbortController().signal)
    const content = [
      { type: 'staged-image' as const, receiptId: image.receiptId },
      { type: 'file' as const, receiptId: file.receiptId },
    ]
    if (previouslyBound) await h.controller.prompt(promptRequest(content))
    h.followup.mockImplementationOnce(() => { throw new Error('busy') })
    await expect(h.controller.prompt({
      ...promptRequest(content), requestId: 'req-2' as SessionRequestId,
    })).rejects.toMatchObject({ code: 'session/agent-busy' })
    h.uploads.retirePrompt(h.agent, 'req-2')
    expect(h.uploads.resolveImage(h.agent, image.receiptId)).toBeDefined()
    expect(h.uploads.resolve(h.agent, file.receiptId)).toBeDefined()
    h.uploads.retirePrompt(h.agent, 'req-1')
    expect(h.uploads.resolveImage(h.agent, image.receiptId) !== undefined).toBe(!previouslyBound)
    expect(h.uploads.resolve(h.agent, file.receiptId) !== undefined).toBe(!previouslyBound)
  })

  it('rejects a receipt retired while inline admission is pending', async () => {
    const h = await uploadHarness()
    const image = await stageImage(h)
    const part = { type: 'staged-image' as const, receiptId: image.receiptId }
    await h.controller.prompt(promptRequest([part]))
    const saved = Promise.withResolvers<readonly ImageAttachmentRef[]>()
    h.saveImages.mockReturnValueOnce(saved.promise)
    const prompting = h.controller.prompt({
      ...promptRequest([part, { type: 'image', mediaType: 'image/png', data: 'AQ==' }]),
      requestId: 'req-2' as SessionRequestId,
    })
    await vi.waitFor(() => { expect(h.saveImages).toHaveBeenCalledTimes(2) })
    h.uploads.retirePrompt(h.agent, 'req-1')
    saved.resolve([NORMALIZED_IMAGE])
    await expect(prompting).rejects.toMatchObject({
      code: 'session/attachment-invalid', details: { reason: 'IMAGE_NOT_STAGED' },
    })
    expect(h.followup).toHaveBeenCalledOnce()
  })

  it('expires unsubmitted image receipts when their exact Session is disposed', async () => {
    const h = await uploadHarness()
    const image = await stageImage(h)
    h.ctx.emit('session/disposed', h.agent.session)
    expect(h.uploads.resolveImage(h.agent, image.receiptId)).toBeUndefined()
  })
})
