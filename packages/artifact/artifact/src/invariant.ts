/** Package-owned durable artifact-event invariants. @module @deepseek-ai/dsh-artifact/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-artifact'
const STATUSES = new Set(['pending', 'ready', 'failed'])
const FORMATS = new Set(['text', 'bytes'])

/** Cordis companion plugin name. */
export const name = 'artifact-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate one artifact reference event before it reaches the durable log.
 *
 * Deliberately silent on `artifact/status` for a reference that never
 * arrived: an orphan status is a legal no-op in every fold (the remote pane
 * and the Lite fold skip it), so a durable rule against it would reject
 * history that replays correctly.
 */
function validateEvent(event: SessionEvent, trace: { open: boolean }, fail: InvariantFailure): void {
  if (event.type === 'artifact/created') {
    const { id, kind, title, format } = event.data
    if (typeof id !== 'string' || id.length === 0) fail('artifact/created id must be a non-empty string')
    if (typeof kind !== 'string' || kind.length === 0 || kind.trim() !== kind) {
      fail('artifact/created kind must be non-empty and already trimmed')
    }
    if (typeof title !== 'string' || title.length === 0 || title.trim() !== title) {
      fail('artifact/created title must be non-empty and already trimmed')
    }
    if (typeof format !== 'string' || !FORMATS.has(format)) {
      fail(`artifact/created carries unknown format ${JSON.stringify(format)}`)
    }
    if (!trace.open) fail('artifact/created appended outside any open turn')
  }
  if (event.type === 'artifact/status') {
    const { id, status } = event.data
    if (typeof id !== 'string' || id.length === 0) fail('artifact/status id must be a non-empty string')
    if (typeof status !== 'string' || !STATUSES.has(status)) {
      fail(`artifact/status carries unknown status ${JSON.stringify(status)}`)
    }
    if (!trace.open) fail('artifact/status appended outside any open turn')
  }
}

/** Incremental turn state for one committed session log. */
interface TurnTrace {
  open: boolean
}

/** Advance the trace after one event has committed. */
function advanceTrace(trace: TurnTrace, event: SessionEvent): void {
  if (event.type === 'turn/start') trace.open = true
  if (event.type === 'turn/end') trace.open = false
}

/** Validate one existing log in a single pass and return its tail trace. */
function seedTrace(session: Session, fail: InvariantFailure): TurnTrace {
  const trace: TurnTrace = { open: false }
  for (const event of session.events) {
    validateEvent(event, trace, fail)
    advanceTrace(trace, event)
  }
  return trace
}

/** Install validation for loaded and newly appended artifact events. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const traces = new WeakMap<Session, TurnTrace>()
  const seed = (session: Session): void => {
    traces.set(session, seedTrace(session, fail))
  }
  const traceFor = (session: Session): TurnTrace => {
    let trace = traces.get(session)
    if (trace === undefined) {
      trace = seedTrace(session, fail)
      traces.set(session, trace)
    }
    return trace
  }
  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateEvent(event, traceFor(session), fail)
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    advanceTrace(traceFor(session), event)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the artifact invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
