/** Native action status and metadata admitted for one Host generation. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PRESENTED_FILE_REMOTE_CAPABILITIES } from '../capabilities.ts'
import { presentedFileKey, type PresentedAction, type PresentedHost } from '../presented.ts'

/** State of the latest explicit native gesture for one saved file. */
export type PresentedOpenPhase = 'opening' | 'opened' | 'revealing' | 'revealed' | 'error' | 'revealError' | 'nativeUnavailable'

/** Desktop metadata paired with the currently advertised action entries. */
export interface PresentedHostView extends PresentedHost {
  readonly actions: readonly PresentedAction[]
}

/** One plugin's native requests; replacement cancels work without replaying gestures. */
export class PresentedOpenController {
  /** Declaration coordinates key transient gesture status across rendered cards. */
  readonly state = createSnapshotStore<Record<string, PresentedOpenPhase | undefined>>({})
  /** Current metadata, an unavailable API, or a retryable metadata failure. */
  readonly host = createSnapshotStore<PresentedHostView | 'unsupported' | 'error' | null>(null)
  private loading: Promise<void> | undefined
  private generation = new AbortController()
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<void>>()
  private metadataHost: ClientRemote['$host'] | undefined

  /** @param remote - current Host facts and generated native file namespace. */
  constructor(private readonly remote: Pick<ClientRemote, '$host' | 'presentedFiles'>) {
    if (!this.supports('presented-file.desktop.v1')) this.host.set('unsupported')
  }

  /**
   * Execute one admitted gesture while coalescing concurrent actions for its coordinates.
   * @param sessionId - viewed Session, including a fork's own identity.
   * @param seq - durable delivery event sequence.
   * @param index - original file index within that event.
   * @param action - default application open or file-manager reveal.
   * @returns after acknowledgement or a retryable error; unavailable operations send nothing.
   */
  async open(sessionId: SessionId, seq: number, index: number, action: PresentedAction = 'open'): Promise<void> {
    const host = this.host.getSnapshot()
    if (this.lifetime.signal.aborted || this.metadataHost !== this.remote.$host
      || host === null || typeof host === 'string' || !host.available
      || !this.supports('presented-file.desktop.v1')
      || !this.supports(action === 'open' ? 'presented-file.open.v1' : 'presented-file.reveal.v1')) return
    const key = presentedFileKey(sessionId, seq, index)
    const phase = this.state.getSnapshot()[key]
    if (phase === 'opening' || phase === 'revealing') return
    this.state.update((state) => { state[key] = action === 'open' ? 'opening' : 'revealing' })
    const task = this.request(key, { sessionId, seq, index }, action)
    this.pending.add(task)
    try { await task }
    finally { this.pending.delete(task) }
  }

  /**
   * Read advertised desktop metadata, coalescing reads; later calls retry errors.
   * @returns after current metadata or a retryable failure is published.
   */
  async loadHost(): Promise<void> {
    if (this.lifetime.signal.aborted || !this.supports('presented-file.desktop.v1')) return
    if (this.loading !== undefined) return this.loading
    this.host.set(null)
    const task = this.readHost(AbortSignal.any([this.lifetime.signal, this.generation.signal]))
    this.loading = task
    this.pending.add(task)
    try { await task }
    finally {
      if (this.loading === task) this.loading = undefined
      this.pending.delete(task)
    }
  }

  /** Cancel generation-owned work and withdraw metadata and gesture status without replay. */
  resetHost(): void {
    const wasLoading = this.loading !== undefined
    this.generation.abort()
    this.generation = new AbortController()
    this.loading = undefined
    this.metadataHost = undefined
    this.state.set({})
    this.host.set(this.supports('presented-file.desktop.v1') ? null : 'unsupported')
    if (wasLoading) void this.loadHost()
  }

  private supports(capability: typeof PRESENTED_FILE_REMOTE_CAPABILITIES[number]['id']): boolean {
    return this.remote.$host.capabilities?.includes(capability) === true
  }

  private async readHost(signal: AbortSignal): Promise<void> {
    const owner = this.remote.$host
    let host: PresentedHostView | 'error' = 'error'
    try {
      const result = await this.remote.presentedFiles.desktop(signal)
      if (result.ok) {
        const actions: PresentedAction[] = []
        if (this.supports('presented-file.open.v1')) actions.push('open')
        if (this.supports('presented-file.reveal.v1')) actions.push('reveal')
        host = { ...result.value, actions }
      }
    } catch {
      // Generated Remote failures and transport rejection share the retry action.
      host = 'error'
    }
    if (!signal.aborted && this.remote.$host === owner) {
      this.metadataHost = host === 'error' ? undefined : owner
      this.host.set(host)
    }
  }

  /** Cancel outstanding requests and await their final publication checks. */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    await Promise.all(this.pending)
  }

  private async request(
    key: string, request: { sessionId: SessionId; seq: number; index: number }, action: PresentedAction,
  ): Promise<void> {
    const owner = this.remote.$host
    const signal = AbortSignal.any([this.lifetime.signal, this.generation.signal])
    const failure = action === 'open' ? 'error' : 'revealError'
    let phase: PresentedOpenPhase = action === 'open' ? 'opened' : 'revealed'
    try {
      const result = await this.remote.presentedFiles[action](request, signal)
      if (!result.ok) phase = result.error.code === 'presented-file/path-unavailable' ? 'nativeUnavailable' : failure
    } catch {
      // Transport failures share the retryable card state with Host action failures.
      phase = failure
    }
    if (!signal.aborted && this.remote.$host === owner) this.state.update((state) => { state[key] = phase })
  }
}
