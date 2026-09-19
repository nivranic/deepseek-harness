/** Client owner for forwarded Remote Event subscriptions and deliveries. */

import type { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ConnectionGenerationSource,
  ConnectionGenerationProgress,
  ConnectionHostInfo,
  ConnectionHandle,
} from '@deepseek-ai/dsh-client-connection/client'
import type {
  TypertClientEventListener,
  TypertRemoteEvent,
} from '@deepseek-ai/dsh-typert-protocol'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { encodeRemotePayload, type RemoteProtocolVersion } from '../protocol.ts'
import type { RemotePreparationFacts, RemoteInteractionReplyScope } from './preparation.ts'
import {
  REMOTE_EVENT_RESULT_ENDPOINT,
  REMOTE_EVENT_STREAM_ENDPOINT,
  isRemoteEventAgentId,
  isRemoteEventClientId,
  isRemoteEventId,
  parseRemoteInteractionRecord,
  isRemoteJsonValue,
  projectRemoteEventRejection,
  type RemoteEventClientId,
  type RemoteEventId,
  type RemoteEventDownlinkFrame,
  type RemoteEventEmitFrame,
  type RemoteEventInvocationFrame,
  type RemoteEventResult,
} from '../stream-protocol.ts'

interface RetainedRemoteAnswer {
  readonly scope: RemoteInteractionReplyScope
  readonly revision: number
  readonly outcome: RemoteEventResult['outcome']
}

/** Open the Gateway-internal forwarded-event stream on the selected carrier. */
export type RemoteEventStreamOpener = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => AsyncIterable<unknown>

/** One subscribed listener after its event-specific signature is erased. */
type RemoteEventListener = (this: Context, ...args: unknown[]) => unknown

/** Untyped access used only for instance-private Cordis event keys. */
interface PrivateEventContext {
  on(name: string, listener: RemoteEventListener): () => boolean
  parallel(name: string, ...args: unknown[]): Promise<void>
  waterfall(
    thisArg: Context,
    name: string,
    request: Readonly<Record<string, unknown>>,
    next: () => Promise<symbol>,
  ): unknown
}

/** Transport outcome after one Client listener chain either claims or delegates. */
type RemoteEventReplyOutcome =
  | { readonly kind: 'result'; readonly value: unknown }
  | { readonly kind: 'next' }
  | { readonly kind: 'rejected'; readonly error: ReturnType<typeof projectRemoteEventRejection> }

/** Private end-of-chain marker that cannot collide with a JSON listener result. */
const REMOTE_EVENT_NEXT = Symbol('api-gateway.remote-event.next')

/** Own Cordis registrations, generation pumping, waterfall dispatch, and HTTP replies. */
export class ClientRemoteEvents {
  private readonly eventPrefix = `internal/api-gateway/remote-event/${randomUUID()}/`
  private readonly unregisterGeneration: () => void
  private activeGeneration: Promise<void> | undefined
  private readonly unanswered = new Map<RemoteEventId, RetainedRemoteAnswer>()

  /**
   * @param ownerCtx - Client Gateway root used for Agent Context resolution.
   * @param connection - Connection carrier used for HTTP result calls.
   * @param openStream - selected in-process or WebSocket stream opener.
   * @param prepare - application discovery before attaching the event stream.
   */
  constructor(
    private readonly ownerCtx: Context,
    private readonly connection: ConnectionHandle,
    private readonly openStream: RemoteEventStreamOpener,
    private readonly prepare: (signal: AbortSignal, progress?: ConnectionGenerationProgress) => Promise<RemotePreparationFacts>,
  ) {
    this.unregisterGeneration = connection.registerGenerationSource(this.runGeneration)
  }

  /**
   * Register one typed Remote Event listener in its calling fiber.
   * @param callerCtx - fiber Context owning the registration.
   * @param event - selected forwarded event.
   * @param listener - listener derived from that event's declaration.
   * @returns disposer for this exact registration.
   */
  subscribe<Event extends TypertRemoteEvent>(
    callerCtx: Context,
    event: Event,
    listener: TypertClientEventListener<Event>,
  ): () => void {
    const dispose = privateEvents(callerCtx).on(
      this.eventKey(event),
      listener as unknown as RemoteEventListener,
    )
    return () => { dispose() }
  }

  /** Withdraw the generation source and wait for active listener work to quiesce. */
  async dispose(): Promise<void> {
    this.unregisterGeneration()
    await Promise.allSettled([this.activeGeneration])
    this.unanswered.clear()
  }

  /** Track the current generation so plugin disposal waits for listener work to stop. */
  private readonly runGeneration: ConnectionGenerationSource = (signal, ready, progress) => {
    const tracked = this.pumpEvents(signal, ready, progress).finally(() => {
      if (this.activeGeneration === tracked) this.activeGeneration = undefined
    })
    this.activeGeneration = tracked
    return tracked
  }

  /** Deliver one notification through Cordis while containing listener failures. */
  private deliver(frame: RemoteEventEmitFrame): void {
    void privateEvents(this.ownerCtx)
      .parallel(this.eventKey(frame.event), ...frame.args)
      .catch((error: unknown) => { this.reportError(frame.event, error) })
  }

  /** Run one Connection generation over the forwarded-event logical stream. */
  private async pumpEvents(
    signal: AbortSignal,
    ready: (host: ConnectionHostInfo) => void,
    progress: ConnectionGenerationProgress,
  ): Promise<void> {
    const facts = await this.prepare(signal, progress)
    const version = facts.apiProtocolVersion
    signal.throwIfAborted()
    let clientId: RemoteEventClientId | undefined
    let replyScope: RemoteInteractionReplyScope | undefined
    const failed = new AbortController()
    const generationSignal = AbortSignal.any([signal, failed.signal])
    const active = new Map<string, AbortController>()
    const tasks = new Set<Promise<void>>()
    const source = this.openStream(
      REMOTE_EVENT_STREAM_ENDPOINT,
      encodeRemotePayload({}, version),
      generationSignal,
    )
    let streamFailed = false
    let streamError: unknown
    try {
      for await (const value of source) {
        generationSignal.throwIfAborted()
        if (clientId === undefined) {
          let opening: ReturnType<typeof parseRemoteEventReady>
          try {
            opening = parseRemoteEventReady(value, version)
          } catch (error) {
            throw new RemoteError('gateway/stream-invalid', toError(error, 'client api: invalid Remote event readiness').message,
              { stream: REMOTE_EVENT_STREAM_ENDPOINT }, { cause: error })
          }
          clientId = opening.clientId
          replyScope = opening.pendingInteractionIds === undefined ? undefined : facts.interactionReplyScope
          const pendingIds = new Set(opening.pendingInteractionIds)
          for (const [id, answer] of this.unanswered) {
            if (replyScope === undefined || answer.scope !== replyScope || !pendingIds.has(id)) this.unanswered.delete(id)
          }
          const { interactionReplyScope: _scope, ...hostFacts } = facts
          ready({ ...hostFacts, home: opening.host.home })
          continue
        }
        let frame: ReturnType<typeof parseRemoteEventFrame>
        try {
          frame = parseRemoteEventFrame(value, version)
        } catch (error) {
          throw new RemoteError('gateway/stream-invalid', toError(error, 'client api: invalid Remote event frame').message,
            { stream: REMOTE_EVENT_STREAM_ENDPOINT }, { cause: error })
        }
        if (frame.type === 'cancel') {
          this.unanswered.delete(frame.eventId)
          active.get(frame.eventId)?.abort(new Error('client api: Remote event was cancelled by the Host'))
          continue
        }
        if (frame.type === 'emit') {
          this.deliver(frame)
          continue
        }
        const controller = new AbortController()
        active.set(frame.eventId, controller)
        const deliverySignal = AbortSignal.any([generationSignal, controller.signal])
        const task = this.answer(frame, clientId, deliverySignal, version, replyScope)
          .catch((error: unknown) => {
            if (!deliverySignal.aborted) failed.abort(error)
          })
          .finally(() => {
            active.delete(frame.eventId)
            tasks.delete(task)
          })
        tasks.add(task)
      }
    } catch (error) {
      streamFailed = true
      streamError = error
    } finally {
      for (const controller of active.values()) {
        controller.abort(new Error('client api: Remote event generation ended'))
      }
      await Promise.allSettled(tasks)
    }
    if (failed.signal.aborted) {
      throw toError(failed.signal.reason, 'client api: Remote event result delivery failed')
    }
    if (signal.aborted) return
    if (streamFailed) throw streamError
    throw new Error('client api: forwarded Remote event stream ended unexpectedly')
  }

  private async answer(
    frame: RemoteEventInvocationFrame,
    clientId: RemoteEventClientId,
    signal: AbortSignal,
    version: RemoteProtocolVersion,
    scope: RemoteInteractionReplyScope | undefined,
  ): Promise<void> {
    const saved = this.unanswered.get(frame.eventId)
    if (saved !== undefined && saved.scope === scope && saved.revision === frame.interaction?.revision) {
      await this.sendAnswer(frame, clientId, saved.outcome, signal, version, saved)
      return
    }
    this.unanswered.delete(frame.eventId)
    const adapter = this.ownerCtx.typert.contexts.getClient('agent')
    let target: Context | undefined
    try {
      target = adapter?.resolve(frame.agentId)
    } catch (error) {
      this.reportError(frame.event, error)
    }
    let outcome: RemoteEventReplyOutcome = { kind: 'next' }
    if (target !== undefined) {
      try {
        outcome = await this.dispatchWaterfall(target, frame, signal)
      } catch (error) {
        if (signal.aborted) return
        outcome = { kind: 'rejected', error: projectRemoteEventRejection(error) }
      }
    }
    if (signal.aborted) return
    const wireOutcome: RemoteEventResult['outcome'] = outcome.kind === 'result' && outcome.value === undefined
      ? { kind: 'result' } : outcome
    // Retain an immutable wire value; listeners may mutate their returned object after completion.
    const reply = structuredClone(wireOutcome)
    let retained: RetainedRemoteAnswer | undefined
    if (scope !== undefined && frame.interaction !== undefined && reply.kind !== 'next') {
      retained = { scope, revision: frame.interaction.revision, outcome: reply }
      this.unanswered.set(frame.eventId, retained)
    }
    await this.sendAnswer(frame, clientId, reply, signal, version, retained)
  }

  private async sendAnswer(
    frame: RemoteEventInvocationFrame,
    clientId: RemoteEventClientId,
    outcome: RemoteEventResult['outcome'],
    signal: AbortSignal,
    version: RemoteProtocolVersion,
    retained: RetainedRemoteAnswer | undefined,
  ): Promise<void> {
    const result: RemoteEventResult = {
      clientId,
      eventId: frame.eventId,
      ...(frame.interaction === undefined ? {} : { interactionRevision: frame.interaction.revision }),
      outcome,
    }
    const response = await this.connection.rpc.call(
      '/api',
      REMOTE_EVENT_RESULT_ENDPOINT,
      encodeRemotePayload({ ...result }, version),
      signal,
    )
    if (retained !== undefined && this.unanswered.get(frame.eventId) === retained) {
      this.unanswered.delete(frame.eventId)
    }
    if (!response.ok && response.error.code !== 'interaction-closed') {
      throw new RemoteError(response.error.code as never, response.error.message, response.error.details as never)
    }
  }

  private async dispatchWaterfall(
    target: Context,
    frame: RemoteEventInvocationFrame,
    signal: AbortSignal,
  ): Promise<RemoteEventReplyOutcome> {
    const request = {
      ...frame.request,
      agent: target,
      signal,
    }
    const value = await abortable(
      Promise.resolve(privateEvents(target).waterfall(
        target,
        this.eventKey(frame.event),
        request,
        () => Promise.resolve(REMOTE_EVENT_NEXT),
      )),
      signal,
    )
    if (value !== REMOTE_EVENT_NEXT && value !== undefined && !isRemoteJsonValue(value)) {
      throw new TypeError('Remote event listener result is not lossless JSON data')
    }
    return value === REMOTE_EVENT_NEXT
      ? { kind: 'next' }
      : { kind: 'result', value }
  }

  private eventKey(event: string): string {
    return `${this.eventPrefix}${event}`
  }

  private reportError(event: string, error: unknown): void {
    console.error(`client api: Remote event ${JSON.stringify(event)} listener threw:`, error)
  }
}

/** Validate and return one generation's Client identity and Host facts. */
function parseRemoteEventReady(value: unknown, version: RemoteProtocolVersion): {
  readonly clientId: RemoteEventClientId
  readonly host: ConnectionHostInfo
  readonly pendingInteractionIds?: readonly RemoteEventId[]
} {
  if (!isRemoteEventRecord(value)
    || !hasExactRemoteEventKeys(value, ['type', 'clientId', 'host',
      ...(version === 2 && Object.hasOwn(value, 'pendingInteractionIds') ? ['pendingInteractionIds'] : []),
    ])
    || value.type !== 'ready'
    || !isRemoteEventClientId(value.clientId)
    || !isRemoteEventRecord(value.host)
    || !hasExactRemoteEventKeys(value.host, ['home'])
    || typeof value.host.home !== 'string') {
    throw new TypeError('client api: forwarded Remote event stream did not begin with ready')
  }
  const ids = value.pendingInteractionIds
  if (Object.hasOwn(value, 'pendingInteractionIds')
    && (!Array.isArray(ids) || !ids.every(isRemoteEventId) || new Set(ids).size !== ids.length)) {
    throw new TypeError('client api: invalid pending interaction snapshot')
  }
  return { clientId: value.clientId, host: { home: value.host.home },
    ...(Array.isArray(ids) ? { pendingInteractionIds: ids as RemoteEventId[] } : {}),
  }
}

/** Validate one untrusted value from the Gateway-internal forwarded-event stream. */
function parseRemoteEventFrame(value: unknown, version: RemoteProtocolVersion): Exclude<RemoteEventDownlinkFrame, { type: 'ready' }> {
  if (!isRemoteEventRecord(value)) invalidRemoteEventFrame()
  if (value.type === 'cancel'
    && hasExactRemoteEventKeys(value, ['type', 'eventId', ...(version === 2 && Object.hasOwn(value, 'interaction') ? ['interaction'] : [])])
    && isRemoteEventId(value.eventId)) {
    return { type: 'cancel', eventId: value.eventId,
      ...(Object.hasOwn(value, 'interaction') ? { interaction: parseRemoteInteractionRecord(value.interaction, value.eventId, false) } : {}),
    }
  }
  if (value.type === 'emit'
    && hasExactRemoteEventKeys(value, ['type', 'event', 'args'])
    && validRemoteEventName(value.event)
    && Array.isArray(value.args)
    && isRemoteJsonValue(value.args)) {
    return { type: 'emit', event: value.event, args: value.args }
  }
  if (value.type === 'waterfall'
    && hasExactRemoteEventKeys(value, ['type', 'event', 'eventId', 'agentId', 'request',
      ...(version === 2 && Object.hasOwn(value, 'interaction') ? ['interaction'] : []),
    ])
    && validRemoteEventName(value.event)
    && isRemoteEventId(value.eventId)
    && isRemoteEventAgentId(value.agentId)
    && isRemoteEventRecord(value.request)
    && !Object.hasOwn(value.request, 'agent')
    && !Object.hasOwn(value.request, 'signal')
    && isRemoteJsonValue(value.request)) {
    return {
      type: 'waterfall',
      event: value.event,
      eventId: value.eventId,
      agentId: value.agentId,
      request: value.request,
      ...(Object.hasOwn(value, 'interaction') ? { interaction: parseRemoteInteractionRecord(value.interaction, value.eventId, true) } : {}),
    }
  }
  invalidRemoteEventFrame()
}

function isRemoteEventRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactRemoteEventKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value)
  return ownKeys.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function validRemoteEventName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function invalidRemoteEventFrame(): never {
  throw new TypeError('client api: invalid forwarded Remote event frame')
}

/** Race listener completion against its delivery lifetime. */
async function abortable<T>(value: T | PromiseLike<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let rejectAbort: ((reason: unknown) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const onAbort = (): void => { rejectAbort?.(signal.reason) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([Promise.resolve(value), aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

function privateEvents(ctx: Context): PrivateEventContext {
  return ctx
}

function toError(reason: unknown, message: string): Error {
  return reason instanceof Error ? reason : new Error(message, { cause: reason })
}
