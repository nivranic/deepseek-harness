/** Application discovery before a Remote connection generation admits business calls. */

import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ConnectionHandle, ConnectionHostInfo, ConnectionGenerationProgress } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '../remote-error-codes.ts'
import type { RemoteProtocolVersion } from '../protocol.ts'

declare module '@deepseek-ai/dsh-client-connection/client' {
  interface ConnectionHostInfo {
    /** Request codec selected for this generation; standalone compositions use protocol 1. */
    readonly apiProtocolVersion?: RemoteProtocolVersion
    /** Advertised operation sets resolved by application preparation for this generation. */
    readonly capabilities?: readonly string[]
  }
}

interface Admission {
  readonly signal: AbortSignal
  readonly version: RemoteProtocolVersion
}

/** Application-provided stable authority for retrying a completed interaction answer. */
export type RemoteInteractionReplyScope = Branded<'RemoteInteractionReplyScope'>

/** Application-owned facts attached to the existing Connection generation. */
export type RemotePreparationFacts = Omit<ConnectionHostInfo, 'home' | 'apiProtocolVersion' | 'platform'> & {
  /** Selected codec for all requests in this connection generation. */
  readonly apiProtocolVersion: RemoteProtocolVersion
  /** Same authenticated Host authority across reconnects; absent scope forbids retained-answer replay. */
  readonly interactionReplyScope?: RemoteInteractionReplyScope
}

/**
 * Discover and validate the connected Host through the existing unary carrier.
 * @param rpc - bootstrap carrier; generated business calls remain suspended.
 * @param signal - cancellation owned by this Connection attempt.
 * @param progress - optional report of this attempt's handshake operation.
 * @returns facts published with the generation only after incremental delivery is ready.
 */
export type RemotePreparation = (
  rpc: ConnectionHandle['rpc'],
  signal: AbortSignal,
  progress?: ConnectionGenerationProgress,
) => Promise<RemotePreparationFacts>

/**
 * Check one endpoint against the facts of its admitted Connection attempt.
 * @param endpoint - canonical Remote namespace/method.
 * @param facts - resolved facts from this attempt, never a later connection.
 * @throws when the application does not admit this operation.
 */
export type RemoteAdmission = (endpoint: string, facts: RemotePreparationFacts) => void

interface Attempt {
  readonly signal: AbortSignal
  readonly initial: boolean
  outcome: { kind: 'pending' } | { kind: 'ready'; facts: RemotePreparationFacts } | { kind: 'failed'; error: unknown }
}

/** Uses Connection's attempt signal and readiness; owns no retry loop or cancellation controller. */
export class ClientRemotePreparation {
  private prepare: RemotePreparation | undefined
  private admission: RemoteAdmission | undefined
  private required = false
  private current: Attempt | undefined
  private readonly listeners = new Set<() => void>()

  /** @param connection - existing carrier and authoritative generation state. */
  constructor(private readonly connection: ConnectionHandle) {}

  /**
   * Install one application preparation owner before mounting its business namespaces.
   * Withdrawal fails closed until a replacement owner is registered.
   * @param prepare - application discovery and validation callback.
   * @param admission - optional application endpoint check after generation readiness.
   * @returns disposer for this exact registration.
   */
  register(prepare: RemotePreparation, admission?: RemoteAdmission): () => void {
    if (this.prepare !== undefined) throw new Error('client api: a preparation owner is already registered')
    this.required = true
    this.prepare = prepare
    this.admission = admission
    this.current = undefined
    this.connection.reconnect()
    this.changed()
    return () => {
      if (this.prepare !== prepare) return
      this.prepare = undefined
      this.admission = undefined
      this.current = undefined
      this.connection.reconnect()
      this.changed()
    }
  }

  /**
   * Run discovery for one Connection attempt before opening the event stream.
   * @param signal - attempt cancellation; late completion cannot admit a generation.
   * @param progress - Connection-owned handshake progress reporter.
   * @returns application facts for the eventual ready frame.
   */
  async run(signal: AbortSignal, progress?: ConnectionGenerationProgress): Promise<RemotePreparationFacts> {
    if (!this.required) return { apiProtocolVersion: 1 }
    const prepare = this.prepare
    if (prepare === undefined) throw unavailable()
    const attempt: Attempt = {
      signal, initial: this.connection.state.getSnapshot() === 'connecting', outcome: { kind: 'pending' },
    }
    this.current = attempt
    this.changed()
    try {
      const facts = await prepare(this.connection.rpc, signal, progress)
      signal.throwIfAborted()
      if (this.prepare !== prepare) throw unavailable()
      attempt.outcome = { kind: 'ready', facts }
      this.changed()
      return facts
    } catch (error) {
      attempt.outcome = { kind: 'failed', error }
      this.changed()
      throw error
    }
  }

  /**
   * Wait for application discovery and the existing event-generation readiness.
   * @param signal - caller and mounted-method cancellation.
   * @param endpoint - business operation to check against this attempt.
   * @returns selected codec and cancellation joining the caller with the admitted Connection attempt.
   */
  async admit(signal: AbortSignal, endpoint: string): Promise<Admission> {
    signal.throwIfAborted()
    if (!this.required) return { signal, version: 1 }
    return new Promise<Admission>((resolve, reject) => {
      let settled = false
      const finish = (outcome: Admission | { error: unknown }): void => {
        if (settled) return
        settled = true
        this.listeners.delete(check)
        unsubscribe()
        unsubscribeState()
        signal.removeEventListener('abort', check)
        if ('error' in outcome) {
          reject(remoteErrorOf(outcome.error) ?? (outcome.error instanceof Error
            ? outcome.error : new Error('Host connection preparation failed', { cause: outcome.error })))
        } else resolve(outcome)
      }
      const check = (): void => {
        if (signal.aborted) { finish({ error: signal.reason }); return }
        if (this.prepare === undefined) { finish({ error: unavailable() }); return }
        const state = this.connection.state.getSnapshot()
        const attempt = this.current
        const initialHandshake = (state === 'connecting' || state === 'authenticating') && attempt?.initial !== false
        if (state !== undefined && state !== 'ready' && !initialHandshake) {
          finish({ error: new RemoteError('gateway/connection-unavailable', 'Host connection is not ready', { endpoint: 'remote/prepare' }) })
          return
        }
        if (attempt?.outcome.kind === 'failed') { finish({ error: attempt.outcome.error }); return }
        if (attempt?.outcome.kind === 'ready' && !attempt.signal.aborted
          && this.connection.generation.getSnapshot() !== undefined) {
          try {
            this.admission?.(endpoint, attempt.outcome.facts)
          } catch (error) {
            finish({ error }); return
          }
          finish({ signal: AbortSignal.any([signal, attempt.signal]), version: attempt.outcome.facts.apiProtocolVersion })
        }
      }
      this.listeners.add(check)
      const unsubscribe = this.connection.generation.subscribe(check)
      const unsubscribeState = this.connection.state.subscribe(check)
      signal.addEventListener('abort', check, { once: true })
      check()
    })
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

function unavailable(): RemoteError<'gateway/preparation-unavailable'> {
  return new RemoteError('gateway/preparation-unavailable', 'Host discovery owner is unavailable', { endpoint: 'remote/prepare' })
}
