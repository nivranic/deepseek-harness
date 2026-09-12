/**
 * Capture coordinator for the telemetry capability. Live capture subscribes to
 * the session firehose plus the one live-bus relay (`agent/error`). Both
 * capture paths apply the fixed chunk projection, build privacy-safe records,
 * and run each through the `session-telemetry/record` waterfall for optional
 * further reduction, then hand the result to the backend. Live capture
 * follows the session firehose; on-demand capture replays the canonical log
 * only when requested. Every synchronous handler is self-contained so a
 * failing backend can never starve other subscribers (cordis `emit` is
 * stop-on-throw) or touch the agent loop. Composed by a backend in its
 * constructor.
 *
 * @module @deepseek-ai/dsh-session-telemetry/coordinator
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { getOrCreateAnonymousIdentity, type AnonymousIdentity } from '@deepseek-ai/dsh-anonymous-user-id'
import type { SessionTelemetrySink, SessionTelemetryRecord, SessionTelemetrySeverity } from './index.ts'

/** Whether capture follows live events or reads the canonical log only when requested. */
export type SessionTelemetryCapture = 'live' | 'on-demand'

/** One projected record ready for backend handoff. */
interface ProjectedRecord {
  readonly record: SessionTelemetryRecord
  /** Ledger cursor advanced only after the backend accepts this record. */
  readonly seq?: number
}

/**
 * The handoff cursor: per session, the highest `seq` handed to a backend.
 * Deliberately MODULE-scope ambient state — a narrow, documented exception
 * to the registrations-are-effects discipline: cordis has no HMR
 * state-handover API, and keying by the `Session` object (which belongs to
 * the session store and outlives any telemetry fiber) is the only in-process
 * lifetime that lets a re-adopting fiber resume instead of re-handing
 * history. Entries die with their sessions; a missing entry safely means
 * "re-hand everything". Advanced only at emit time — the cursor marks
 * handed-off, not delivered.
 */
const handoffCursor = new WeakMap<Session, number>()

/**
 * Install the telemetry capture side onto a context for one backend.
 *
 * Live capture registers the persistence-coordinator listener set plus the
 * `agent/error` relay, all through `ctx.effect()`/`ctx.on()` on the composing
 * fiber, and sweeps already-live sessions (a hot reload does not replay
 * `session/created`). A `session/disposed` captures the session's `shutdown`
 * operational record at its own termination edge and retires it from the
 * adopted set. On-demand capture registers none of those continuous listeners;
 * {@link captureSession} reads the canonical log explicitly and never creates
 * operational records. Disposal captures shutdown markers for live-adopted
 * sessions, then awaits the backend's `shutdown()`; a failure there warns
 * instead of throwing — best-effort reporting must not fail application
 * teardown.
 */
export class SessionTelemetryCoordinator {
  /**
   * Sessions adopted by THIS fiber and still live, for double-adoption
   * protection and the teardown sweep of unmarked sessions;
   * `session/disposed` marks and retires entries.
   */
  private readonly adopted = new Set<Session>()
  /** Per session, the `turn:step` keys whose first chunk already shipped; rebuilt from the log on re-adoption. */
  private readonly chunkSeen = new WeakMap<Session, Set<string>>()
  /** Home-scoped, in-memory pseudonymizer resolved once before hot-path capture. */
  private readonly identity: AnonymousIdentity
  /**
   * @param ctx - the composing backend's context; listeners bind to its fiber.
   * @param backend - the backend receiving records; owned elsewhere, never disposed here beyond `shutdown()` forwarding.
   * @param capture - follow live events, or wait for explicit canonical-log capture.
   */
  constructor(
    private readonly ctx: Context,
    private readonly backend: SessionTelemetrySink,
    capture: SessionTelemetryCapture = 'live',
  ) {
    this.identity = getOrCreateAnonymousIdentity()
    if (capture === 'live') {
      ctx.on('session/created', (session) => {
        this.adopt(session)
      })
      // Capture the shutdown marker at the session's own termination edge,
      // then retire the only strong reference owned by this coordinator.
      ctx.on('session/disposed', (session) => {
        this.contain(() => {
          if (!this.adopted.delete(session)) return
          this.deliver(session, { record: this.redact(shutdownRecord(session, this.identity)) })
        })
      })
      ctx.on('session/event', (session, event) => {
        this.contain(() => {
          this.captureEvent(session, event)
        })
      })
      // Parallel listeners are awaited by the loop at turn end; returning void
      // (not the SDK's flush promise) is the turn-latency contract.
      ctx.on('session/flush', (session) => {
        this.contain(() => {
          this.hintFlush(session)
        })
      })
      ctx.on('agent/error', ({ agent, turn, step, error }) => {
        this.contain(() => {
          this.relayAgentError(agent, turn, step, error)
        })
      })
      for (const session of ctx.sessions.list()) {
        this.adopt(session)
      }
    }
    ctx.effect(() => async () => {
      // Sessions still adopted here are alive through whole-application
      // teardown, so capture the marker before the backend quiesces.
      for (const session of this.adopted) {
        this.contain(() => {
          this.deliver(session, { record: this.redact(shutdownRecord(session, this.identity)) })
        })
      }
      try {
        await this.backend.shutdown()
      } catch (error) {
        this.ctx.logger.warn(`telemetry: backend shutdown failed: ${String(error)}`)
      }
    }, 'telemetry capture')
  }

  /**
   * Project and hand over the canonical session-log suffix after the handoff
   * cursor, optionally stopping at an inclusive sequence boundary. Redaction
   * runs during this call, so an on-demand caller retains no copied records
   * before requesting capture and uses the policy mounted at that time.
   * Backend and policy failures remain contained per event and do not starve
   * later events in the same replay.
   * @param session - session whose current canonical-log prefix may be handed over.
   * @param throughSeq - optional last sequence included in this capture.
   */
  captureSession(session: Session, throughSeq?: number): void {
    const cursor = handoffCursor.get(session) ?? session.firstLiveSeq - 1
    // Containment is PER EVENT: one rejected record is withheld fail-closed
    // while the rest of the historical replay proceeds.
    for (const event of session.events) {
      if (throughSeq !== undefined && event.seq > throughSeq) break
      this.contain(() => {
        if (event.seq <= cursor) this.track(session, event)
        else this.captureEvent(session, event)
      })
    }
  }

  /**
   * Adopt a session: replay its log THROUGH the projection from the handoff
   * cursor, then rely on the firehose for everything after. When no cursor
   * survived, replay starts at the session's construction boundary
   * (`firstLiveSeq`), not seq 0: constructor seeds never publish on the
   * firehose, and their content already left the process under another
   * identity — the same id in a previous process (resume) or the parent's
   * stream (fork, stitched by receivers via `session.seed_length`). Events
   * at or below the start still feed the projection state (first-chunk
   * tracking) without being re-handed, so a resumed fiber drops mid-step
   * chunk continuations exactly like the fiber that saw the step begin. The
   * cost, accepted with the capture contract's at-most-once stance: a resume
   * does not backfill records a previous process failed to deliver.
   * @param session - the live session to adopt; a second adoption is a no-op.
   */
  private adopt(session: Session): void {
    if (this.adopted.has(session)) return
    this.adopted.add(session)
    this.captureSession(session)
  }

  /** Feed the chunk projection without handing off — the ≤cursor half of re-adoption. */
  private track(session: Session, event: SessionEvent): void {
    if (event.type === 'assistant/chunk') {
      this.seen(session).add(`${event.data.turn}:${event.data.step}`)
    }
  }

  /** Project, redact, and hand one event to the backend. */
  private captureEvent(session: Session, event: SessionEvent): void {
    if (event.type === 'assistant/chunk') {
      const key = `${event.data.turn}:${event.data.step}`
      const seen = this.seen(session)
      // Fixed chunk projection: only the first chunk of each (turn, step)
      // ships — the stream-started signal; content is byte-complete in the
      // step's assembled assistant/message. Dropped chunks do not advance
      // the cursor, so re-adoption re-drops them deterministically.
      if (seen.has(key)) return
      seen.add(key)
    }
    this.deliver(session, {
      record: this.redact({
        channel: 'ledger',
        time: event.time,
        severity: severityOf(event),
        attributes: {
          ...identityOf(session, event, this.identity),
          ...diagnosticsOf(event),
        },
      }),
      seq: event.seq,
    })
  }

  /**
   * Run the `session-telemetry/record` waterfall at capture time over a frozen
   * mandatory projection, then intersect its attributes with the original
   * key/value set. Listeners can remove fields and choose a valid severity but
   * cannot add, rewrite, or recover discarded Session content. Callers run inside
   * {@link contain}, so a throwing rule withholds the record instead of
   * reaching the loop (fail-closed). On-demand capture invokes this waterfall
   * while reading the canonical session log, not when the event was appended.
   */
  private redact(record: SessionTelemetryRecord): SessionTelemetryRecord {
    const original: SessionTelemetryRecord = Object.freeze({
      ...record,
      attributes: Object.freeze({ ...record.attributes }),
    })
    const candidate = this.ctx.waterfall('session-telemetry/record', original, () => original)
    const attributes: Record<string, string | number | boolean> = {}
    for (const [key, value] of Object.entries(original.attributes)) {
      if (Object.hasOwn(candidate.attributes, key) && candidate.attributes[key] === value) {
        attributes[key] = value
      }
    }
    const candidateSeverity = candidate.severity
    return Object.freeze({
      channel: original.channel,
      time: original.time,
      severity: isSeverity(candidateSeverity) ? candidateSeverity : original.severity,
      attributes: Object.freeze(attributes),
    })
  }

  /** Hand one redacted record to the backend, then advance its ledger cursor. */
  private deliver(session: Session, pending: ProjectedRecord): void {
    this.backend.emit(pending.record)
    if (pending.seq !== undefined) handoffCursor.set(session, pending.seq)
  }

  /** Forward the turn-end boundary to the backend's optional flush hint. */
  private hintFlush(session: Session): void {
    if (this.adopted.has(session)) this.backend.flush?.()
  }

  /** Relay one `agent/error` bus emission as an `agent-error` operational record. */
  private relayAgentError(agent: Agent, turn: number, step: number, error: unknown): void {
    const errorClass = errorClassOfThrown(error)
    this.deliver(agent.session, {
      record: this.redact({
        channel: 'ops',
        time: Date.now(),
        severity: 'error',
        attributes: {
          'telemetry.op': 'agent-error',
          'session.id': this.identity.pseudonymizeSessionId(String(agent.session.id)),
          'error.class': errorClass,
          ...turnStepAttributes(turn, step),
        },
      }),
    })
  }

  /** Lazily create the per-session first-chunk tracking set. */
  private seen(session: Session): Set<string> {
    let set = this.chunkSeen.get(session)
    if (!set) this.chunkSeen.set(session, set = new Set())
    return set
  }

  /**
   * Run one capture-side step with its exception contained: cordis `emit`
   * is stop-on-throw, so a throwing listener would starve every subscriber
   * registered after this plugin — nothing from the backend may escape.
   */
  private contain(step: () => void): void {
    try {
      step()
    } catch (error) {
      this.ctx.logger.warn(`telemetry: capture step failed: ${String(error)}`)
    }
  }
}

/**
 * Build the per-session clean-exit marker: emitted at the session's own
 * disposal edge, or at coordinator dispose for sessions still alive then.
 */
function shutdownRecord(session: Session, identity: AnonymousIdentity): SessionTelemetryRecord {
  return {
    channel: 'ops',
    time: Date.now(),
    severity: 'info',
    attributes: {
      'telemetry.op': 'shutdown',
      'session.id': identity.pseudonymizeSessionId(String(session.id)),
    },
  }
}

/** Map an event's own outcome flag to the pre-baked alerting severity. */
function severityOf(event: SessionEvent): SessionTelemetrySeverity {
  switch (event.type) {
    case 'tool/result':
      return event.data.message.content[0].isError === true ? 'error' : 'info'
    case 'turn/end':
      return event.data.reason.kind === 'error' ? 'error' : 'info'
    default:
      // Merge-extensible fall-through (no assertNever): event types this coordinator
      // does not depend on — including plugin-merged ones it never heard of —
      // pass through as info; their owners' outcome semantics stay theirs.
      return 'info'
  }
}

/** Normalize the live bus's arbitrary thrown value into a safe error class. */
function errorClassOfThrown(error: unknown): TelemetryErrorClass {
  const normalized = error instanceof Error ? error : new Error(String(error))
  return errorClassOf(normalized.name)
}

/** Build pseudonymous Session, event, and fork correlation attributes; never workspace paths. */
function identityOf(
  session: Session,
  event: SessionEvent,
  identity: AnonymousIdentity,
): Record<string, string | number> {
  const attributes: Record<string, string | number> = {
    'session.id': identity.pseudonymizeSessionId(String(session.id)),
    'event.type': event.type,
    'event.seq': event.seq,
  }
  const { parentSession, seedLength } = session.header
  if (parentSession !== undefined) {
    attributes['session.parent_id'] = identity.pseudonymizeSessionId(String(parentSession))
  }
  // The durable fork boundary: a forked stream starts here, and its prefix
  // lives in the parent's stream — receivers stitch on (parent_id, seed_length).
  if (seedLength !== undefined) attributes['session.seed_length'] = seedLength
  return attributes
}

/**
 * Project the closed core vocabulary onto bounded diagnostic fields; unknown
 * plugin events add nothing beyond Session, type, and sequence correlation.
 */
function diagnosticsOf(event: SessionEvent): Record<string, string | number | boolean> {
  switch (event.type) {
    case 'turn/start':
      return turnStepAttributes(event.data.turn)
    case 'turn/end':
      return {
        ...turnStepAttributes(event.data.turn),
        'turn.outcome': safeEnum(event.data.reason.kind, TURN_OUTCOMES),
      }
    case 'step/start':
    case 'step/end':
      return turnStepAttributes(event.data.turn, event.data.step)
    case 'user/message':
      return { 'message.source': safeEnum(event.data.source.kind, MESSAGE_SOURCES) }
    case 'assistant/chunk':
      return {
        ...turnStepAttributes(event.data.turn, event.data.step),
        'assistant.chunk_type': safeEnum(event.data.chunk.type, CHUNK_TYPES),
      }
    case 'assistant/message':
      return {
        ...turnStepAttributes(event.data.turn, event.data.step),
        'assistant.interrupted': event.data.interrupted === true,
      }
    case 'tool/call':
      return turnStepAttributes(event.data.turn, event.data.step)
    case 'tool/result':
      return {
        ...turnStepAttributes(event.data.turn, event.data.step),
        'tool.is_error': event.data.message.content[0].isError === true,
        ...(event.data.error === undefined
          ? {}
          : { 'error.class': errorClassOf(event.data.error.name) }),
      }
    case 'request/header':
      return {
        'request.reason': safeEnum(event.data.reason, REQUEST_REASONS),
        'request.starts_series': event.data.startsSeries === true,
      }
    case 'request/context':
    case 'session/end-seed':
      return {}
    default:
      // Merge-extensible event types are privacy-opaque until their owner adds
      // an explicit safe projection here; their type, seq, and time remain.
      return {}
  }
}

/** Keep persisted or live turn/step fields within the fixed numeric diagnostic domain. */
function turnStepAttributes(turn: number, step?: number): Record<string, number> {
  const attributes: Record<string, number> = {}
  if (Number.isSafeInteger(turn) && turn >= 0) attributes['turn'] = turn
  if (step !== undefined && Number.isSafeInteger(step) && step >= 0) attributes['step'] = step
  return attributes
}

/** Accept only the three fixed severity values returned by a reduction listener. */
function isSeverity(value: unknown): value is SessionTelemetrySeverity {
  return value === 'info' || value === 'warn' || value === 'error'
}

const TURN_OUTCOMES = new Set(['completed', 'aborted', 'blocked', 'error', 'max-tokens', 'interrupted'])
const MESSAGE_SOURCES = new Set(['user', 'plugin', 'model', 'tool'])
const CHUNK_TYPES = new Set(['block-start', 'text-delta', 'reasoning-delta', 'tool-call-delta', 'block-end', 'usage', 'finish'])
const REQUEST_REASONS = new Set(['initial', 'resume', 'change', 'series'])

type TelemetryErrorClass =
  | 'Error'
  | 'TypeError'
  | 'RangeError'
  | 'ReferenceError'
  | 'SyntaxError'
  | 'URIError'
  | 'EvalError'
  | 'AggregateError'
  | 'AbortError'
  | 'CustomError'

/** Map a possibly extended enum value onto a fixed diagnostic vocabulary. */
function safeEnum(value: string, allowed: ReadonlySet<string>): string {
  return allowed.has(value) ? value : 'extension'
}

/** Map writable or plugin-defined error names onto fixed built-in classes. */
function errorClassOf(name: string): TelemetryErrorClass {
  switch (name) {
    case 'Error':
    case 'TypeError':
    case 'RangeError':
    case 'ReferenceError':
    case 'SyntaxError':
    case 'URIError':
    case 'EvalError':
    case 'AggregateError':
    case 'AbortError':
      return name
    default:
      return 'CustomError'
  }
}
