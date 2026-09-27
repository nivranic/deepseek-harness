/** Host file and image intake with Agent-scoped staged receipts. */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { admitEncodedImages } from '@deepseek-ai/dsh-attachment'
import type { AttachmentAdmissionPart, FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { CommandFileReceiptResolver } from '@deepseek-ai/dsh-commands'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { FILE_UPLOAD_REMOTE_CAPABILITIES } from './capabilities.ts'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { handleFileUploadHttp } from './http-route.ts'
import { FILE_UPLOAD_PATH } from './protocol.ts'
import type {
  EncodedFileUploadRequest, EncodedImageUploadRequest, FileUploadReceiptId, FileUploadValue,
  ImageUploadReceiptId, ImageUploadValue,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host storage and staged-receipt service for file and image uploads. */
    fileUploads: FileUploads
  }
}

type StagedUploadValue =
  | { readonly kind: 'file'; readonly file: FileAttachmentRef }
  | { readonly kind: 'image'; readonly image: ImageAttachmentRef; readonly originalBytes: number }

type StagedUpload = StagedUploadValue & {
  /** Prompt that accepted this receipt; absent until successful admission. */
  requestId?: string
}

/** Resolve or resume the ordinary Agent that owns one Session identity. */
export type AgentResolver = (sessionId: SessionId) => Promise<Agent>

/** Prompt receipt binding that restores its previous owners unless delivery commits it. */
export interface PromptFileBinding extends Disposable {
  /** Keep the receipt bindings until queue or history observation retires them. */
  commit(): void
}

class PromptFileBindingGuard implements PromptFileBinding {
  private settled = false

  constructor(private readonly rollback: () => void) {}

  commit(): void {
    this.settled = true
  }

  [Symbol.dispose](): void {
    if (this.settled) return
    this.settled = true
    this.rollback()
  }
}

/** Host service owning upload storage and Agent-scoped staged receipts. */
export class FileUploads extends TypertRemoteService {
  static inject = ['agents', 'attachments', 'commands', 'connection']

  private readonly stagedUploads = new WeakMap<Session, Map<FileUploadReceiptId | ImageUploadReceiptId, StagedUpload>>()
  private agentResolver: AgentResolver | undefined

  /** @param ctx - Host context carrying Agent, attachment, command, and Connection services. */
  constructor(ctx: Context) {
    super(ctx, 'fileUploads', { capabilities: FILE_UPLOAD_REMOTE_CAPABILITIES })
    const resolve: CommandFileReceiptResolver = (agent, receiptId) =>
      this.resolve(agent, receiptId as FileUploadReceiptId)
    ctx.effect(
      () => ctx.commands.registerFileReceiptResolver(resolve),
      'file-upload: command file receipt resolver',
    )
    ctx.effect(
      () => ctx.connection.fetch.register({
        path: FILE_UPLOAD_PATH,
        methods: ['POST'],
        requestBody: 'streaming',
        fetch: request => handleFileUploadHttp(this, request),
      }),
      'file-upload: streaming route',
    )
    ctx.on('session/event', (session, event) => { this.observeSessionEvent(session, event) })
    ctx.on('session/disposed', (session) => { this.stagedUploads.delete(session) })
  }

  /**
   * Register the ordinary-Session resolver used when a raw upload addresses a cold Session.
   * @param resolve - resolver that returns the exact live Agent or throws a Remote error.
   * @returns disposer removing this resolver.
   */
  registerAgentResolver(resolve: AgentResolver): () => void {
    if (this.agentResolver !== undefined) throw new Error('file-upload: Agent resolver is already registered')
    this.agentResolver = resolve
    return () => {
      if (this.agentResolver === resolve) this.agentResolver = undefined
    }
  }

  /**
   * Persist one encoded upload and stage it under the Agent receiver selected by Typert.
   * @param agent - receiving Agent resolved from the Remote Agent scope.
   * @param request - canonical base64 bytes and optional display name.
   * @param signal - caller cancellation before storage begins.
   * @returns the staged receipt and durable file reference.
   */
  @Remote('upload')
  async upload(agent: Agent, request: EncodedFileUploadRequest, signal: AbortSignal): Promise<FileUploadValue> {
    signal.throwIfAborted()
    const staged = await this.commit(agent, 'file', async () => ({
      kind: 'file' as const,
      file: await this.ctx.attachments.admitEncodedFile({
        data: request.data,
        ...(request.name === undefined ? {} : { name: request.name }),
      }),
    }))
    return { receiptId: staged.receiptId as FileUploadReceiptId, file: staged.upload.file }
  }

  /**
   * Validate and normalize one image, then stage its reference for a prompt in this Session.
   * Cancellation before publication returns no receipt; immutable stored bytes may remain.
   * @param agent - receiving ordinary Agent resolved from the Remote scope.
   * @param request - canonical base64, declared media type, and optional display name.
   * @param signal - caller cancellation; an ongoing image write is not interrupted.
   * @returns the Session-scoped receipt and normalized image reference.
   */
  @Remote('uploadImage')
  async uploadImage(agent: Agent, request: EncodedImageUploadRequest, signal: AbortSignal): Promise<ImageUploadValue> {
    signal.throwIfAborted()
    const { data, mediaType, name } = request
    const staged = await this.commit(agent, 'image', async () => {
      const refs = await admitEncodedImages(this.ctx.attachments, [{
        data, mediaType, ...(name === undefined ? {} : { name }),
      }])
      return {
        kind: 'image' as const,
        image: refs[0] as ImageAttachmentRef,
        originalBytes: Buffer.byteLength(data, 'base64'),
      }
    }, signal)
    return { receiptId: staged.receiptId as ImageUploadReceiptId, image: staged.upload.image }
  }

  /**
   * Persist raw chunks for one Session without aggregating the upload.
   * @param request - Session identity, ordered bytes, cancellation, and optional display name.
   * @returns the staged receipt and durable file reference.
   */
  async uploadStream(request: {
    readonly sessionId: SessionId
    readonly data: AsyncIterable<Uint8Array>
    readonly signal?: AbortSignal
    readonly name?: string
  }): Promise<FileUploadValue> {
    const agent = await this.resolveAgent(request.sessionId)
    const staged = await this.commit(agent, 'file', async () => ({
      kind: 'file' as const,
      file: await this.ctx.attachments.saveFileStream({
        data: request.data,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        ...(request.name === undefined ? {} : { name: request.name }),
      }),
    }))
    return { receiptId: staged.receiptId as FileUploadReceiptId, file: staged.upload.file }
  }

  /**
   * Resolve one staged receipt inside its receiving Agent scope.
   * @param agent - receiving Agent.
   * @param receiptId - opaque receipt minted for one completed upload.
   * @returns durable file reference, or `undefined` for an unknown or foreign receipt.
   */
  resolve(agent: Agent, receiptId: FileUploadReceiptId): FileAttachmentRef | undefined {
    this.assertAgentScope(agent)
    const upload = this.stagedUploads.get(agent.session)?.get(receiptId)
    return upload?.kind === 'file' ? upload.file : undefined
  }

  /**
   * Resolve an image receipt with its trusted pre-normalization byte count.
   * @param agent - receiving Agent.
   * @param receiptId - authority minted by a completed image upload.
   * @returns Host admission data, or undefined for an unknown, foreign, or file receipt.
   */
  resolveImage(
    agent: Agent,
    receiptId: ImageUploadReceiptId,
  ): Extract<AttachmentAdmissionPart, { readonly type: 'staged-image' }> | undefined {
    this.assertAgentScope(agent)
    const upload = this.stagedUploads.get(agent.session)?.get(receiptId)
    return upload?.kind === 'image'
      ? { type: 'staged-image', attachment: upload.image, originalBytes: upload.originalBytes }
      : undefined
  }

  /**
   * Bind receipts while one prompt enters an Agent inbox.
   * Disposal restores every prior binding unless the caller commits successful delivery.
   * @param agent - receiving Agent.
   * @param receipts - distinct file and image receipts referenced by the prompt.
   * @param requestId - prompt identity later observed in queue or history.
   * @returns binding kept after commit until queue or history observation retires its receipts.
   */
  bindPrompt(
    agent: Agent,
    receipts: {
      readonly files: readonly FileUploadReceiptId[]
      readonly images: readonly ImageUploadReceiptId[]
    },
    requestId: string,
  ): PromptFileBinding {
    this.assertAgentScope(agent)
    const staged = this.stagedUploads.get(agent.session)
    const binding = (receiptId: FileUploadReceiptId | ImageUploadReceiptId, kind: 'file' | 'image') => {
      const upload = staged?.get(receiptId)
      if (upload?.kind !== kind) throw uploadNotStaged(kind)
      return { upload, previous: upload.requestId }
    }
    const bound = [
      ...receipts.files.map(receiptId => binding(receiptId, 'file')),
      ...receipts.images.map(receiptId => binding(receiptId, 'image')),
    ]
    for (const { upload } of bound) upload.requestId = requestId
    return new PromptFileBindingGuard(() => {
      for (const { upload, previous } of bound) {
        if (previous === undefined) delete upload.requestId
        else upload.requestId = previous
      }
    })
  }

  /**
   * Retire every receipt accepted by one removed queue occurrence.
   * @param agent - receiving Agent.
   * @param requestId - prompt identity carried by the queue occurrence.
   */
  retirePrompt(agent: Agent, requestId: string): void {
    this.assertAgentScope(agent)
    this.retire(agent.session, requestId)
  }

  private async commit<Upload extends StagedUploadValue>(
    agent: Agent,
    kind: 'file' | 'image',
    save: () => Promise<Upload>,
    signal?: AbortSignal,
  ): Promise<{ readonly receiptId: FileUploadReceiptId | ImageUploadReceiptId; readonly upload: Upload }> {
    this.assertOrdinaryAgent(agent, kind)
    let upload: Upload
    try {
      upload = await save()
    } catch (error) {
      if (this.ctx.attachments.isAttachmentError(error)) {
        throw new RemoteError('session/attachment-invalid' as never, error.message, { reason: error.code } as never)
      }
      throw new RemoteError(
        'gateway/internal',
        `failed to store ${kind} upload: ${String(error)}`,
        {},
        { cause: error },
      )
    }
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new RemoteError(
        'session/not-found',
        `session "${agent.id}" was disposed before its ${kind} upload completed`,
        { sessionId: agent.id },
      )
    }
    signal?.throwIfAborted()
    let staged = this.stagedUploads.get(agent.session)
    if (staged === undefined) {
      staged = new Map()
      this.stagedUploads.set(agent.session, staged)
    }
    const receiptId = randomUUID() as FileUploadReceiptId | ImageUploadReceiptId
    staged.set(receiptId, upload)
    return { receiptId, upload }
  }

  private async resolveAgent(sessionId: SessionId): Promise<Agent> {
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) return live
    const resolver = this.agentResolver
    if (resolver === undefined) {
      throw new RemoteError('session/not-found', `session "${sessionId}" is not attached`, { sessionId })
    }
    return resolver(sessionId)
  }

  private assertAgentScope(agent: Agent): void {
    if (scopeOf(agent.ctx) !== agent) throw new Error('file-upload: operation requires the Agent\'s own scope')
  }

  private assertOrdinaryAgent(agent: Agent, kind: 'file' | 'image'): void {
    this.assertAgentScope(agent)
    if (agent.session.header.origin === 'subagent') {
      throw new RemoteError(
        'subagent/attachment-invalid' as never,
        `subagent conversations do not accept ${kind} uploads`,
        { reason: kind === 'file' ? 'SUBAGENT_FILE_UNSUPPORTED' : 'SUBAGENT_IMAGE_UNSUPPORTED' } as never,
      )
    }
  }

  private observeSessionEvent(session: Session, event: SessionEvent): void {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user'
      || !('rpcId' in event.data.source)) return
    if (typeof event.data.source.rpcId === 'string') this.retire(session, event.data.source.rpcId)
  }

  private retire(session: Session, requestId: string): void {
    const staged = this.stagedUploads.get(session)
    if (staged === undefined) return
    for (const [receiptId, upload] of staged) {
      if (upload.requestId === requestId) staged.delete(receiptId)
    }
    if (staged.size === 0) this.stagedUploads.delete(session)
  }
}

function uploadNotStaged(kind: 'file' | 'image'): RemoteError {
  return new RemoteError(
    'session/attachment-invalid' as never,
    `${kind === 'file' ? 'File' : 'Image'} was not uploaded for this session.`,
    { reason: kind === 'file' ? 'FILE_NOT_STAGED' : 'IMAGE_NOT_STAGED' } as never,
  )
}

export default FileUploads
