/** Readiness, retry ownership and payload-free observations for the browser Connection loop. */
import type { ConnectionDiagnosticSnapshot } from '../types.ts'

/** Stable Host facts delivered by one established Remote event generation. */
export interface ConnectionHostInfo {
  /** Host account home used only to abbreviate displayed filesystem paths. */
  readonly home: string
}

/** One successfully established Host generation. */
export interface ConnectionGeneration {
  /** Monotone generation number within this Client runtime. */
  readonly id: number
  /** Host facts carried by this generation's opening frame. */
  readonly host: ConnectionHostInfo
}

/** Reconnect/backoff tunables (deployment-varying — no hardcoded tunables; these become the
 *  future `ctx.connection` plugin's Config). All fields optional; defaults below. */
export interface ConnectionConfig {
  /** First-retry backoff cap in ms (jittered: actual delay is cap/2..cap). */
  backoffBaseMs?: number
  /** Exponential growth factor per consecutive failed attempt. */
  backoffFactor?: number
  /** Upper bound for the backoff cap in ms. */
  backoffMaxMs?: number
  /** Maximum wait for the registered generation source's ready signal. */
  generationReadyTimeoutMs?: number
}

const CONNECTION_DEFAULTS: Required<ConnectionConfig> = {
  backoffBaseMs: 500,
  backoffFactor: 2,
  backoffMaxMs: 10_000,
  generationReadyTimeoutMs: 3_000,
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done(): void {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

/** Coarse connection state for the UI: 'connected' after each generation's handshake,
 *  'reconnecting' the moment the generation fails (covers the whole backoff+retry span). */
export type ConnectionState = 'connected' | 'reconnecting'

/** Connection-generation callbacks owned by API Gateway. */
export interface ConnectionSinks {
  /** After the generation source reports ready, first connect included. */
  onConnected?: (host: ConnectionHostInfo) => void
  /** Coarse state transitions (deduplicated: fires only on change). The initial pre-connect
   *  span reports nothing — the UI treats "no state yet" as connecting, not as an outage. */
  onStateChange?: (state: ConnectionState) => void
}

/**
 * One long-lived source defining a Connection generation. The source must
 * attach its incremental listeners before calling `ready`, then remain pending
 * until the generation is lost or `signal` aborts.
 * @param signal - cancellation for the current generation.
 * @param ready - one-shot report that incremental delivery is attached.
 * @returns a promise settling only when this generation ends or fails.
 */
export type ConnectionGenerationSource = (
  signal: AbortSignal,
  ready: (host: ConnectionHostInfo) => void,
) => Promise<void>

/**
 * Opens the registered generation source, reconnecting with exponential backoff on loss.
 * State (generation/attempt) is instance-private, never in the store.
 * Sink exceptions do not kill the generation loop.
 */
export class ConnectionController {
  private generation = 0
  private attempt = 0
  private owner: { controller: AbortController } | null = null
  private pendingLoops = 0
  private interruptions = 0
  private lastState: ConnectionState | null = null
  private readonly config: Required<ConnectionConfig>

  constructor(
    private readonly source: ConnectionGenerationSource,
    private readonly sinks: ConnectionSinks = {},
    config: ConnectionConfig = {},
  ) {
    this.config = { ...CONNECTION_DEFAULTS, ...config }
  }

  /** Idempotent: begin the connect/pump/reconnect loop. */
  start(): void {
    if (this.owner !== null) return
    const owner = { controller: new AbortController() }
    this.owner = owner
    this.lastState = null
    this.attempt = 0
    this.pendingLoops++
    void this.loop(owner).finally(() => { this.pendingLoops-- })
  }

  /** Stop the loop and abort the current generation source. */
  stop(): void {
    const owner = this.owner
    this.owner = null
    owner?.controller.abort()
  }

  /**
   * Capture fixed generation facts without Host home, request ids, payloads or exception text.
   * @returns a value copy; stopping persists until all retired source work has settled.
   */
  diagnosticSnapshot(): ConnectionDiagnosticSnapshot {
    const owner = this.owner
    const state = this.generation === 0 ? 'idle'
      : owner === null ? (this.pendingLoops === 0 ? 'stopped' : 'stopping')
        : owner.controller.signal.aborted ? 'reconnecting' : this.lastState ?? 'opening'
    return {
      state,
      attempts: Math.min(this.generation, 0xffff_ffff),
      interruptions: this.interruptions,
      countsSaturated: this.generation >= 0xffff_ffff,
    }
  }

  private backoffDelay(attempt: number): number {
    const { backoffBaseMs, backoffFactor, backoffMaxMs } = this.config
    const cap = Math.min(backoffMaxMs, backoffBaseMs * backoffFactor ** Math.max(0, attempt - 1))
    return cap / 2 + Math.random() * (cap / 2)
  }

  /** A retired loop cannot resume when a replacement starts before its source settles. */
  private isRunning(owner: object): boolean {
    return this.owner === owner
  }

  /** Re-read both mutable liveness guards after a potentially reentrant sink. */
  private isGenerationActive(controller: AbortController, owner: object): boolean {
    return this.isRunning(owner) && !controller.signal.aborted
  }

  private async loop(owner: { controller: AbortController }): Promise<void> {
    while (this.isRunning(owner)) {
      const gen = ++this.generation
      const ac = owner.controller

      let sourceReady = false
      let resolveReady!: (host: ConnectionHostInfo) => void
      let rejectReady!: (error: Error) => void
      let rejectSourceLost!: (error: Error) => void
      const ready = new Promise<ConnectionHostInfo>((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject
      })
      const sourceLost = new Promise<never>((_resolve, reject) => {
        rejectSourceLost = reject
      })
      const reportReady = (host: ConnectionHostInfo): void => {
        if (sourceReady) return
        sourceReady = true
        resolveReady(host)
      }

      const failed = new Promise<void>((resolve) => {
        const settle = (): void => {
          if (gen === this.generation && !ac.signal.aborted) ac.abort()
          resolve()
        }
        void Promise.resolve()
          .then(() => this.isRunning(owner) ? this.source(ac.signal, reportReady) : undefined)
          .then(
            () => {
              const error = new Error('connection generation ended')
              if (!sourceReady) rejectReady(error)
              rejectSourceLost(error)
              settle()
            },
            (error: unknown) => {
              const failure = error instanceof Error
                ? error
                : new Error('connection generation failed', { cause: error })
              if (!sourceReady) rejectReady(failure)
              rejectSourceLost(failure)
              settle()
            },
          )
      })

      try {
        const host = await Promise.race([
          waitForReady(ready, this.config.generationReadyTimeoutMs, ac.signal),
          sourceLost,
        ])
        if (ac.signal.aborted) throw new Error('generation aborted during readiness handshake')
        this.attempt = 0
        this.emitState('connected')
        // A state sink may synchronously stop this controller.
        if (this.isGenerationActive(ac, owner)) {
          this.callSink(() => { this.sinks.onConnected?.(host) })
        }
      } catch {
        // Transport failure: treat as generation failure, fall through to the shared backoff.
        if (!ac.signal.aborted) ac.abort()
      }

      await failed
      if (!this.isRunning(owner)) return
      this.interruptions = Math.min(this.interruptions + 1, 0xffff_ffff)
      this.emitState('reconnecting')
      if (!this.isRunning(owner)) return
      this.attempt += 1
      console.warn(`[connection] connection lost, retry #${this.attempt}`)
      const idle = new AbortController()
      owner.controller = idle
      await sleep(this.backoffDelay(this.attempt), idle.signal)
      owner.controller = new AbortController()
    }
  }

  /** Deduplicated state emission (sink isolation applies). */
  private emitState(state: ConnectionState): void {
    if (this.lastState === state) return
    this.lastState = state
    this.callSink(() => this.sinks.onStateChange?.(state))
  }

  /** Sink exception isolation: a business-layer throw is logged only, never affecting pump or reconnect semantics. */
  private callSink(fn: () => void): void {
    try {
      fn()
    } catch (error) {
      console.error('[connection] connection sink threw:', error)
    }
  }
}

/** Await source readiness without letting a stalled carrier wedge startup forever. */
function waitForReady<T>(ready: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      finish({ error: new Error(`connection generation was not ready within ${String(timeoutMs)}ms`) })
    }, timeoutMs)
    const aborted = (): void => {
      finish({ error: new Error('connection generation aborted', { cause: signal.reason }) })
    }
    const finish = (outcome: { readonly value: T } | { readonly error: Error }): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', aborted)
      if ('error' in outcome) reject(outcome.error)
      else resolve(outcome.value)
    }
    signal.addEventListener('abort', aborted, { once: true })
    void ready.then(
      (value) => { finish({ value }) },
      (error: unknown) => {
        finish({ error: error as Error })
      },
    )
  })
}
