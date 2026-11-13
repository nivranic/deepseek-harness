/** Discovery-owned admission and one-shot, cancellable view-location delivery. */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import type { HostDescriptor, HostId } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { decodeSessionViewLocation, encodeSessionViewLocation, HandoffFailure } from './view-location.ts'
import type { HandoffFailureKind, SessionViewLocation } from './view-location.ts'

/** URL fragment carrying one view-location payload. */
export const VIEW_HANDOFF_FRAGMENT = 'dsh-view'

/** Current discovery state; a ready identity expires with its connection generation. */
export type HandoffAdmission =
  | { readonly status: 'waiting' | 'failed' }
  | { readonly status: 'ready'; readonly hostId: HostId }

type LocationLike = { origin: string; pathname: string; hash: string }

/** Owns discovery, clipboard delivery, and the lifetime of one received link. */
export class ViewHandoffController {
  /** Host identity admitted for the current connection generation. */
  readonly admission = createSnapshotStore<HandoffAdmission>({ status: 'waiting' })
  /** Latest receive or capture failure, cleared by the notice owner. */
  readonly failure = createSnapshotStore<HandoffFailureKind | undefined>(undefined)
  private readonly lifetime = new AbortController()
  private generation = new AbortController()
  private readonly unsubscribe: () => void

  /**
   * @param generations - transport generations, without lane Host extensions.
   * @param describe - authenticated Host identity discovery.
   * @param open - retained Session navigation; cancellation prevents publishing selection.
   * @param clipboard - browser clipboard writer.
   * @param location - page address and one-shot fragment.
   */
  constructor(
    generations: ObservableSnapshot<ConnectionGeneration | undefined>,
    private readonly describe: () => Promise<RemoteResult<HostDescriptor>>,
    private readonly open: (location: SessionViewLocation, signal: AbortSignal) => Promise<void>,
    private readonly clipboard: (text: string) => Promise<void> = text => navigator.clipboard.writeText(text),
    private readonly location: LocationLike = globalThis.location,
  ) {
    const refresh = (): void => {
      this.generation.abort()
      this.admission.set({ status: 'waiting' })
      if (generations.getSnapshot() === undefined) return
      const generation = new AbortController()
      this.generation = generation
      void this.discover(generation)
    }
    this.unsubscribe = generations.subscribe(refresh)
    refresh()
  }

  private async discover(generation: AbortController): Promise<void> {
    let result: Awaited<ReturnType<typeof this.describe>>
    try {
      result = await this.describe()
    } catch (_discoveryFailure) {
      if (!generation.signal.aborted) this.admission.set({ status: 'failed' })
      return
    }
    if (generation.signal.aborted) return
    this.admission.set(result.ok
      ? { status: 'ready', hostId: result.value.hostId }
      : { status: 'failed' })
  }

  /**
   * Capture the currently admitted Host with a Session's durable turn anchor.
   * @param sessionId - displayed Session.
   * @param anchorSeq - durable turn/start sequence.
   * @returns the v1 payload, or undefined after reporting unavailable admission.
   */
  encode(sessionId: SessionId, anchorSeq: SessionSeq): string | undefined {
    const state = this.admission.getSnapshot()
    if (state.status !== 'ready' || this.generation.signal.aborted) {
      this.failure.set('unavailable')
      return undefined
    }
    return encodeSessionViewLocation({ hostId: state.hostId, sessionId, anchorSeq })
  }

  /**
   * Address a viewing position without copying authentication query parameters.
   * @param payload - v1 encoded location.
   * @returns page link carrying the payload in its fragment.
   */
  buildLink(payload: string): string {
    return `${this.location.origin}${this.location.pathname}#${VIEW_HANDOFF_FRAGMENT}=${payload}`
  }

  /**
   * Copy a viewing link through the browser clipboard permission.
   * @param text - link to copy.
   * @returns whether the clipboard accepted it.
   */
  async copy(text: string): Promise<boolean> {
    try {
      await this.clipboard(text)
      return true
    } catch (_clipboardDenied) {
      return false
    }
  }

  private waitForAdmission(): Promise<Extract<HandoffAdmission, { status: 'ready' }> & { signal: AbortSignal }> {
    return new Promise((resolve, reject) => {
      const signal = this.lifetime.signal
      let stop: () => void = () => {}
      const check = (): void => {
        const state = this.admission.getSnapshot()
        if (!signal.aborted && state.status === 'waiting') return
        stop()
        signal.removeEventListener('abort', check)
        if (signal.aborted) reject(new HandoffFailure('unavailable'))
        else if (state.status === 'ready') resolve({ ...state, signal: this.generation.signal })
        else reject(new HandoffFailure('unavailable'))
      }
      stop = this.admission.subscribe(check)
      signal.addEventListener('abort', check, { once: true })
      check()
    })
  }

  /** Consume a link once; invalid and wrong-Host payloads never reach Session navigation. */
  async receive(): Promise<void> {
    const prefix = `#${VIEW_HANDOFF_FRAGMENT}=`
    if (!this.location.hash.startsWith(prefix)) return
    const payload = this.location.hash.slice(prefix.length)
    this.location.hash = ''
    let signal: AbortSignal | undefined
    try {
      const location = decodeSessionViewLocation(payload)
      const admission = await this.waitForAdmission()
      signal = admission.signal
      signal.throwIfAborted()
      if (location.hostId !== admission.hostId) throw new HandoffFailure('wrongHost')
      await this.open(location, signal)
    } catch (error) {
      if (this.lifetime.signal.aborted) return
      this.failure.set(signal?.aborted === true ? 'unavailable' : error instanceof HandoffFailure ? error.kind : 'openFailed')
    }
  }

  /** Cancel discovery, a pending admission waiter, and in-flight navigation on plugin unload. */
  dispose(): void {
    this.unsubscribe()
    this.generation.abort()
    this.lifetime.abort()
    this.admission.set({ status: 'waiting' })
  }
}
