/** Native actions over verified declarations in the viewed Session. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-workspace-files'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session-query'
import { classifyRemoteFailureCode, remoteErrorOf, Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionSeq } from '@deepseek-ai/dsh-session'
import { PRESENTED_FILE_REMOTE_CAPABILITIES } from './capabilities.ts'
import { isPresentedData, isPresentedFile } from './presented.ts'
import type { PresentedAction, PresentedFileRequest, PresentedFileActionValue, PresentedHost } from './presented.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Native actions over persisted delivery declarations. */
    presentedFiles: PresentedFiles
  }
}

/** Authenticated native actions for persisted file declarations; never activates an Agent. */
export class PresentedFiles extends TypertRemoteService {
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<PresentedFileActionValue>>()

  /** @param ctx - Session queries, filesystem verification and native desktop owner. */
  constructor(ctx: Context) {
    super(ctx, 'presentedFiles', { capabilities: PRESENTED_FILE_REMOTE_CAPABILITIES })
    ctx.effect(() => async () => {
      this.lifetime.abort()
      await Promise.allSettled(this.pending)
    })
  }

  /**
   * Describe the serving desktop without opening a file or activating an Agent.
   * @param signal - caller cancellation.
   * @returns serving desktop metadata; API support does not grant native execution permission.
   */
  @Remote('desktop')
  desktop(signal: AbortSignal): PresentedHost {
    signal.throwIfAborted()
    return this.ctx.sessionController.workspaceDesktop()
  }

  /**
   * Open the current source file in its default native application.
   * @param request - persisted declaration coordinates in the viewed Session.
   * @param signal - caller cancellation; disposal also cancels and awaits native work.
   * @returns confirmation after the native command accepts the verified path.
   */
  @Remote('open')
  open(request: PresentedFileRequest, signal: AbortSignal): Promise<PresentedFileActionValue> {
    return this.run(request, 'open', signal)
  }

  /**
   * Reveal the current source in the Host file manager.
   * @param request - persisted declaration coordinates in the viewed Session.
   * @param signal - caller cancellation; disposal also cancels and awaits native work.
   * @returns confirmation after the native command accepts the verified path.
   */
  @Remote('reveal')
  reveal(request: PresentedFileRequest, signal: AbortSignal): Promise<PresentedFileActionValue> {
    return this.run(request, 'reveal', signal)
  }

  private run(request: PresentedFileRequest, action: PresentedAction, signal: AbortSignal): Promise<PresentedFileActionValue> {
    const task = this.execute(request, action, AbortSignal.any([signal, this.lifetime.signal]))
    this.pending.add(task)
    void task.then(() => { this.pending.delete(task) }, () => { this.pending.delete(task) })
    return task
  }

  private async execute(request: PresentedFileRequest, action: PresentedAction, signal: AbortSignal): Promise<PresentedFileActionValue> {
    const { sessionId, seq, index } = request
    signal.throwIfAborted()
    if (sessionId.length === 0 || !Number.isSafeInteger(seq) || seq < 0 || !Number.isSafeInteger(index) || index < 0) {
      throw new RemoteError('gateway/bad-request', 'Invalid Presented file coordinates.', {})
    }
    try {
      if (!this.desktop(signal).available) throw new RemoteError('presented-file/native-unavailable', 'Host desktop unavailable.', {})
      const { target, session } = await this.ctx.sessionQuery.readEvent({
        sessionId, seq: seq as SessionSeq, before: 0, after: 0,
      }, signal)
      const file = target.type === 'deliverables/presented' && isPresentedData(target.data) ? target.data.files[index] : undefined
      if (!isPresentedFile(file)) throw new RemoteError('presented-file/not-found', 'Presented file not found in this Session result.', {})
      signal.throwIfAborted()
      const { fs, workspaceFiles } = this.ctx
      const { absolutePath: path } = await workspaceFiles.stat({
        sessionId, workspaceRoot: session.cwd ?? this.ctx.sandboxPolicy.workspaceRoot,
      }, file.path, signal)
      const mapped = fs.processPathFromHostPath(path)
      if (mapped === undefined || fs.processPath(await fs.resolve(mapped, { signal })) !== path) {
        throw new RemoteError('presented-file/path-unavailable', 'Presented file has no verified Host path.', {})
      }
      signal.throwIfAborted()
      await this.ctx.sessionController.openWorkspacePath({ path, ...(action === 'reveal' ? { action } : {}) }, signal)
      signal.throwIfAborted()
      return { completed: true }
    } catch (error: unknown) {
      signal.throwIfAborted()
      const remote = remoteErrorOf(error)
      if (remote?.code.startsWith('presented-file/')) throw error
      const missing = remote !== undefined && classifyRemoteFailureCode(remote.code) === 'unavailable' || error instanceof Error && 'code' in error
        && (error.code === 'SESSION_QUERY_SESSION_NOT_FOUND' || error.code === 'SESSION_QUERY_EVENT_NOT_FOUND'
          || error.code === 'ENOENT' || error.code === 'ENOTDIR')
      throw new RemoteError(missing ? 'presented-file/not-found' : 'presented-file/action-failed', 'Presented file unavailable.', {})
    }
  }
}
