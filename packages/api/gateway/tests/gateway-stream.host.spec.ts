import { generateKeyPairSync, randomUUID, sign as edSign } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { type RawData } from 'ws'
import { Context, Service, symbols } from '@deepseek-ai/cordis'
import { apply as applyConnection, inject as connectionInject } from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import {
  apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import DeviceTrustService from '@deepseek-ai/dsh-api-device-trust'
import type { DeviceId } from '@deepseek-ai/dsh-api-device-trust/types'
import {
  bindTypertRemote,
  Remote,
  type InvocationDescriptor,
  type TypertContextMap,
  type TypertContextWire,
  RemoteError,
} from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'fixture/rejected': { readonly retryable: boolean }
    'fixture/broken': { readonly count: bigint }
  }
}
import { provideBrowserCredentials } from './browser-credentials.ts'
import TypertGatewayService, {
  TypertGatewayError,
  type Config as GatewayConfig,
  type TypertRemoteEventDispatch,
  type TypertRemoteEventInvocation,
  type TypertRemoteEventOutcome,
} from '@deepseek-ai/dsh-api-gateway'
import { z } from 'zod'
import type {
  RemoteEventClientId,
  RemoteEventInvocationFrame,
  RemoteInteractionOrigin,
  RemoteInteractionSessionId,
} from '../src/stream-protocol.ts'

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) }
})

const randomUuid = vi.mocked(randomUUID)
const browserCookies = new WeakMap<Context, string>()
const REMOTE_HOST = { home: '/home/fixture' } as const
type AgentWireId = TypertContextWire<TypertContextMap['agent']>
const agentId = (value: string): AgentWireId => value as AgentWireId

/** Exchange this test Host's process token for its WebSocket/HTTP Cookie header. */
function browserCookie(ctx: Context): string {
  const existing = browserCookies.get(ctx)
  if (existing !== undefined) return existing
  const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const target = new URL(ctx.connection.authenticatedUrl(origin))
  let setCookie: string | undefined
  ctx.connection.authorizeIndex({
    method: 'GET',
    url: `${target.pathname}${target.search}`,
    headers: { host: target.host },
  }, {
    writeHead(_status, headers) { setCookie = headers?.['set-cookie'] },
    end() {},
  })
  if (setCookie === undefined) throw new Error('gateway stream fixture did not receive a browser cookie')
  const cookie = setCookie.split(';', 1)[0]!
  browserCookies.set(ctx, cookie)
  return cookie
}

class FeedService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'feed')
  readonly signals: AbortSignal[] = []
  returns = 0

  constructor(ctx: Context) {
    super(ctx, 'feed')
  }

  @Remote({ mode: 'stream' })
  async *follow(label: string, signal: AbortSignal): AsyncIterable<string> {
    this.signals.push(signal)
    try {
      yield `${label}:ready`
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    } finally {
      this.returns += 1
    }
  }

  @Remote({ mode: 'stream' })
  *sync(label: string): Iterable<string> {
    yield `${label}:one`
    yield `${label}:two`
  }

  @Remote({ mode: 'stream' })
  *invalid(): Iterable<string> {
    yield 42 as unknown as string
  }

  @Remote({ mode: 'stream' })
  *nonJson(): Iterable<unknown> {
    yield 1n
  }

  @Remote({ mode: 'stream' })
  missing(): Iterable<string> {
    return null as unknown as Iterable<string>
  }

  @Remote({ mode: 'stream' })
  *src(label: string): Iterable<string> {
    yield `${label}:src`
  }

  @Remote({ mode: 'stream' })
  abortBeforeOpen(signal: AbortSignal): Iterable<string> {
    if (signal.aborted) throw new Error('fixture observed pre-open cancellation')
    return []
  }

  @Remote({ mode: 'stream' })
  reject(): Iterable<string> {
    throw new RemoteError('fixture/rejected', 'fixture rejected the stream', { retryable: false })
  }

  @Remote({ mode: 'stream' })
  rejectWithNonJsonDetails(): Iterable<string> {
    throw new RemoteError('fixture/broken', 'fixture emitted invalid details', { count: 1n })
  }

  unary(label: string): string {
    return label
  }
}

const roots: Context[] = []

class RemoteEventSourceProbe {
  readonly source = (signal: AbortSignal): AsyncIterable<TypertRemoteEventDispatch> => {
    this.signal = signal
    return this.iterate(signal)
  }

  signal: AbortSignal | undefined
  private readonly dispatches: TypertRemoteEventDispatch[] = []
  private wake: (() => void) | undefined

  push(dispatch: TypertRemoteEventDispatch): void {
    this.dispatches.push(dispatch)
    this.wake?.()
    this.wake = undefined
  }

  private async *iterate(signal: AbortSignal): AsyncGenerator<TypertRemoteEventDispatch> {
    const aborted = (): void => {
      this.wake?.()
      this.wake = undefined
    }
    signal.addEventListener('abort', aborted, { once: true })
    try {
      while (!signal.aborted) {
        while (this.dispatches.length > 0) {
          yield this.dispatches.shift() as TypertRemoteEventDispatch
        }
        if (signal.aborted) return
        await new Promise<void>((resolve) => { this.wake = resolve })
        this.wake = undefined
      }
    } finally {
      signal.removeEventListener('abort', aborted)
    }
  }
}

interface PendingInvocationProbe {
  readonly dispatch: TypertRemoteEventInvocation
  readonly outcome: Promise<TypertRemoteEventOutcome>
  readonly resolve: (outcome: TypertRemoteEventOutcome) => void
  readonly reject: (reason: unknown) => void
}

function pendingInvocation(
  context: Context,
  signal?: AbortSignal,
  prompt = 'ship',
  identity: unknown = agentId('agent-1'),
  interaction?: RemoteInteractionOrigin,
): PendingInvocationProbe {
  const subject = { ctx: context }
  const settled = Promise.withResolvers<TypertRemoteEventOutcome>()
  const resolve = vi.fn((outcome: TypertRemoteEventOutcome) => {
    settled.resolve(outcome)
  })
  const reject = vi.fn((reason: unknown) => {
    settled.reject(reason)
  })
  return {
    dispatch: {
      event: 'fixture/approval',
      ...(interaction === undefined ? {} : { interaction }),
      request: { prompt, agent: subject, ...(signal === undefined ? {} : { signal }) },
      context: { value: context, subject, agentId: identity as string },
      resolve,
      reject,
    },
    outcome: settled.promise,
    resolve,
    reject,
  }
}

afterEach(async () => {
  randomUuid.mockClear()
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('Typert Remote streams', () => {
  it('validates optional per-kind interaction timeouts without a default deadline', () => {
    expect(TypertGatewayService.Config({})).toEqual({ websocketHeartbeatIntervalMs: 2_000, interactionTimeoutMs: {},
      interactionReplyPermissions: { approval: true, question: true } })
    expect(TypertGatewayService.Config({ interactionTimeoutMs: { approval: 1, question: MAX_TIMER_DELAY_MS } }))
      .toMatchObject({ interactionTimeoutMs: { approval: 1, question: MAX_TIMER_DELAY_MS } })
    for (const value of [0, -1, 1.5, Infinity, MAX_TIMER_DELAY_MS + 1]) {
      for (const kind of ['approval', 'question']) {
        expect(() => TypertGatewayService.Config({ interactionTimeoutMs: { [kind]: value } })).toThrow()
      }
    }
  })

  it.each([1, 2] as const)('expires across disconnect and a backward clock change without resetting the protocol-%s deadline', async (version) => {
    const { ctx } = await setup(false, { interactionTimeoutMs: { approval: 100 } })
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    vi.useFakeTimers({ now: 1_000, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const open = async () => {
      const stream = await ctx.typertGateway.wireStream.open('$events', {
        ...(version === 2 ? { apiProtocolVersion: 2 } : {}), args: {},
      }, new AbortController().signal)
      const iterator = stream[Symbol.asyncIterator]()
      await iterator.next()
      return iterator
    }
    let iterator: AsyncIterator<unknown> | undefined
    try {
      iterator = await open()
      const pending = pendingInvocation(ctx.extend(), undefined, 'ship', agentId('agent-1'), {
        sessionId: 'session-1' as RemoteInteractionSessionId, type: 'approval', requiredPermission: 'approval.respond',
      })
      const outcome = expect(pending.outcome).rejects.toMatchObject({ code: 'interaction-expired' })
      source.push(pending.dispatch)
      const first = (await iterator.next()).value as RemoteEventInvocationFrame
      if (version === 2) expect(first.interaction).toMatchObject({ createdAt: 1_000, expiresAt: 1_100 })
      else expect(first).not.toHaveProperty('interaction')
      await vi.advanceTimersByTimeAsync(40)
      await iterator.return?.()
      await vi.advanceTimersByTimeAsync(20)
      iterator = await open()
      expect((await iterator.next()).value).toEqual(first)
      vi.setSystemTime(900)
      await vi.advanceTimersByTimeAsync(40)
      await outcome
      const terminal: unknown = (await iterator.next()).value
      expect(terminal).toEqual({ type: 'cancel', eventId: first.eventId,
        ...(version === 2 ? { interaction: { ...first.interaction, status: 'expired', revision: 2 } } : {}),
      })
      expect(pending.reject).toHaveBeenCalledTimes(1)
      expect(pending.resolve).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      await unregister()
      await iterator?.return?.()
      vi.useRealTimers()
    }
  })

  it.each(['caller', 'source'] as const)('releases a configured interaction timer when %s closes first', async (closer) => {
    const { ctx } = await setup(false, { interactionTimeoutMs: { question: 100 } })
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    vi.useFakeTimers({ now: 1_000, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const stream = await ctx.typertGateway.wireStream.open('$events', { apiProtocolVersion: 2, args: {} }, new AbortController().signal)
    const iterator = stream[Symbol.asyncIterator]()
    try {
      await iterator.next()
      const caller = new AbortController()
      const pending = pendingInvocation(ctx.extend(), caller.signal, 'ship', agentId('agent-1'), {
        sessionId: 'session-1' as RemoteInteractionSessionId, type: 'question', requiredPermission: 'question.respond',
      })
      const outcome = expect(pending.outcome).rejects.toBeInstanceOf(Error)
      source.push(pending.dispatch)
      await iterator.next()
      expect(vi.getTimerCount()).toBe(1)
      if (closer === 'caller') caller.abort(new Error('caller stopped'))
      else await unregister()
      await outcome
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(200)
      expect(pending.reject).toHaveBeenCalledTimes(1)
    } finally {
      await unregister()
      await iterator.return?.()
      vi.useRealTimers()
    }
  })

  it('expires an overdue interaction before replaying it to a replacement Client', async () => {
    const { ctx } = await setup(true, { interactionTimeoutMs: { approval: 10_000 } })
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const original = await openEventClient(ctx, 'expiry-before-replay', 2)
    const pending = pendingInvocation(ctx.extend(), undefined, 'ship', agentId('agent-1'), {
      sessionId: 'session-1' as RemoteInteractionSessionId, type: 'approval', requiredPermission: 'approval.respond',
    })
    const outcome = expect(pending.outcome).rejects.toMatchObject({ code: 'interaction-expired' })
    source.push(pending.dispatch)
    await vi.waitFor(() => { expect(deliveredInvocation(original)).toBeDefined() })
    const frame = deliveredInvocation(original)!
    const closed = once(original.socket, 'close')
    original.socket.close()
    await closed
    const clock = vi.spyOn(Date, 'now').mockReturnValue(frame.interaction!.expiresAt!)
    let replacement: RemoteEventTestClient | undefined
    try {
      replacement = await openEventClient(ctx, 'expiry-new-client', 2)
      await outcome
      expect(deliveredInvocation(replacement)).toBeUndefined()
      expect(pending.resolve).not.toHaveBeenCalled()
      expect(pending.reject).toHaveBeenCalledTimes(1)
    } finally {
      clock.mockRestore()
      replacement?.socket.close()
      await unregister()
    }
  })

  it('rejects an overdue answer before a delayed timer callback can run', async () => {
    const { ctx } = await setup(true, { interactionTimeoutMs: { approval: 10_000 } })
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const client = await openEventClient(ctx, 'expired-answer', 2)
    const pending = pendingInvocation(ctx.extend(), undefined, 'ship', agentId('agent-1'), {
      sessionId: 'session-1' as RemoteInteractionSessionId, type: 'approval', requiredPermission: 'approval.respond',
    })
    const outcome = expect(pending.outcome).rejects.toMatchObject({ code: 'interaction-expired' })
    source.push(pending.dispatch)
    await vi.waitFor(() => { expect(deliveredInvocation(client)).toBeDefined() })
    const frame = deliveredInvocation(client)!
    const clock = vi.spyOn(Date, 'now').mockReturnValue(frame.interaction!.expiresAt!)
    try {
      await expect(sendEventResult(client, frame, { kind: 'result', value: 'late grant' }, 2))
        .rejects.toMatchObject({ code: 'interaction-closed' })
      await outcome
      expect(pending.resolve).not.toHaveBeenCalled()
      expect(pending.reject).toHaveBeenCalledTimes(1)
    } finally {
      clock.mockRestore()
      client.socket.close()
      await unregister()
    }
  })

  it.each([true, false])('does not time out a waterfall whose kind has no configured deadline: recorded=%s', async (recorded) => {
    const { ctx } = await setup(false, { interactionTimeoutMs: { approval: 100 } })
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const stream = await ctx.typertGateway.wireStream.open('$events', { apiProtocolVersion: 2, args: {} }, new AbortController().signal)
    const iterator = stream[Symbol.asyncIterator]()
    try {
      await iterator.next()
      const caller = new AbortController()
      const pending = pendingInvocation(ctx.extend(), caller.signal, 'ship', agentId('agent-1'), recorded ? {
        sessionId: 'session-1' as RemoteInteractionSessionId, type: 'question', requiredPermission: 'question.respond',
      } : undefined)
      const outcome = expect(pending.outcome).rejects.toThrow('caller stopped')
      source.push(pending.dispatch)
      const frame = (await iterator.next()).value as RemoteEventInvocationFrame
      expect(frame.interaction?.expiresAt).toBeUndefined()
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(200)
      expect(pending.resolve).not.toHaveBeenCalled()
      expect(pending.reject).not.toHaveBeenCalled()
      caller.abort(new Error('caller stopped'))
      await outcome
    } finally {
      await unregister()
      await iterator.return?.()
      vi.useRealTimers()
    }
  })

  it('expires even when no Client is connected', async () => {
    const { ctx } = await setup(false, { interactionTimeoutMs: { approval: 100 } })
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const pending = pendingInvocation(ctx.extend(), undefined, 'ship', agentId('agent-1'), {
        sessionId: 'session-1' as RemoteInteractionSessionId, type: 'approval', requiredPermission: 'approval.respond',
      })
      const outcome = expect(pending.outcome).rejects.toMatchObject({ code: 'interaction-expired' })
      source.push(pending.dispatch)
      await vi.advanceTimersByTimeAsync(100)
      await outcome
      expect(pending.reject).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      await unregister()
      vi.useRealTimers()
    }
  })

  it('validates the WebSocket heartbeat timer range', () => {
    expect(TypertGatewayService.Config({})).toEqual({ websocketHeartbeatIntervalMs: 2_000, interactionTimeoutMs: {},
      interactionReplyPermissions: { approval: true, question: true } })
    expect(TypertGatewayService.Config({ websocketHeartbeatIntervalMs: MAX_TIMER_DELAY_MS }))
      .toEqual({ websocketHeartbeatIntervalMs: MAX_TIMER_DELAY_MS, interactionTimeoutMs: {},
        interactionReplyPermissions: { approval: true, question: true } })
    for (const websocketHeartbeatIntervalMs of [0, 1.5, MAX_TIMER_DELAY_MS + 1]) {
      expect(() => TypertGatewayService.Config({ websocketHeartbeatIntervalMs })).toThrow()
    }
  })

  it.each([1, 2] as const)('opens protocol %s carrier payloads through the in-process wire adapter', async (version) => {
    const { ctx } = await setup(false)
    const source = await ctx.typertGateway.wireStream.open(
      'feed/sync',
      { ...(version === 1 ? {} : { apiProtocolVersion: version }), args: { label: 'wire' } },
      new AbortController().signal,
    )

    await expect(collect(source)).resolves.toEqual(['wire:one', 'wire:two'])
  })

  it('rejects unsupported protocols before business streams and event-client registration', async () => {
    const { ctx, service } = await setup(false)
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const allocateClientId = randomUuid.mock.calls.length
    try {
      for (const endpoint of ['feed/follow', '$events']) {
        for (const version of [0, 3, -1, 1.5, '2', null, {}, []]) {
          await expect(ctx.typertGateway.wireStream.open(endpoint,
            { apiProtocolVersion: version, args: {} }, new AbortController().signal))
            .rejects.toMatchObject({ code: 'gateway/protocol-unsupported' })
        }
        await expect(ctx.typertGateway.wireStream.open(endpoint,
          { apiProtocolVersion: 0, args: {} }, new AbortController().signal))
          .rejects.toMatchObject({ code: 'gateway/protocol-unsupported', message: 'Remote request API protocol is limited to diagnostics on this Host; update the application before reconnecting' })
        await expect(ctx.typertGateway.wireStream.open(endpoint,
          { apiProtocolVersion: 3, args: {} }, new AbortController().signal))
          .rejects.toMatchObject({ code: 'gateway/protocol-unsupported', message: 'Remote request API protocol is unsupported; update the application' })
      }
      expect(service.signals).toEqual([])
      expect(randomUuid).toHaveBeenCalledTimes(allocateClientId)
      const events = await ctx.typertGateway.wireStream.open('$events',
        { apiProtocolVersion: 2, args: {} }, new AbortController().signal)
      const iterator = events[Symbol.asyncIterator]()
      await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { type: 'ready' } })
      await iterator.return?.()
    } finally {
      await unregister()
    }
  })

  it('passes Iterable and AsyncIterable items through and returns the iterator on cancellation', async () => {
    const { ctx, service } = await setup(false)
    const abort = new AbortController()
    const source = await ctx.typertGateway.stream({
      namespace: 'feed',
      method: 'follow',
      args: { label: 'a' },
      signal: abort.signal,
    })
    const iterator = source[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 'a:ready' })
    const pending = iterator.next()
    abort.abort(new Error('fixture cancellation'))
    await expect(pending).rejects.toThrow('Remote invocation "feed/follow" was aborted')
    expect(service.signals).toEqual([abort.signal])
    expect(service.returns).toBe(1)

    await expect(collect(await ctx.typertGateway.stream({
      namespace: 'feed', method: 'sync', args: { label: 'b' },
    }))).resolves.toEqual(['b:one', 'b:two'])
    await expect(collect(await ctx.typertGateway.stream({
      namespace: 'feed', method: 'invalid', args: {},
    }))).resolves.toEqual([42])
    await expect(collect(await ctx.typertGateway.stream({
      namespace: 'feed', method: 'nonJson', args: {},
    }))).resolves.toEqual([1n])
    await expect(ctx.typertGateway.stream({
      namespace: 'feed', method: 'missing', args: {},
    })).rejects.toMatchObject({ code: 'gateway/result-invalid' })

    await expect(collect(await ctx.typertGateway.stream({
      namespace: 'feed', method: 'src', args: { label: 'c' },
    }))).resolves.toEqual(['c:src'])

    const abortedBeforeOpen = new AbortController()
    abortedBeforeOpen.abort(new Error('cancelled before open'))
    await expect(ctx.typertGateway.stream({
      namespace: 'feed', method: 'abortBeforeOpen', args: {}, signal: abortedBeforeOpen.signal,
    })).rejects.toThrow('Remote invocation "feed/abortBeforeOpen" was aborted')

    const abortedBeforeIteration = new AbortController()
    abortedBeforeIteration.abort(new Error('cancelled before iteration'))
    const preCancelled = await ctx.typertGateway.stream({
      namespace: 'feed', method: 'sync', args: { label: 'ignored' }, signal: abortedBeforeIteration.signal,
    })
    await expect(collect(preCancelled)).rejects.toThrow('Remote invocation "feed/sync" was aborted')
  })

  it('keeps unary and stream invocation modes distinct', async () => {
    const { ctx } = await setup(false)
    await expect(ctx.typertGateway.invoke({
      namespace: 'feed', method: 'sync', args: { label: 'a' },
    })).rejects.toMatchObject({ code: 'gateway/signature-invalid' } satisfies Partial<TypertGatewayError>)
    await expect(ctx.typertGateway.stream({
      namespace: 'feed', method: 'unary', args: { label: 'a' },
    })).rejects.toMatchObject({ code: 'gateway/signature-invalid' } satisfies Partial<TypertGatewayError>)
  })

  it('uses the configured WebSocket heartbeat interval', { timeout: 1_000 }, async () => {
    const { ctx } = await setup(true, { websocketHeartbeatIntervalMs: 20 })
    const socket = new WebSocket(`ws://127.0.0.1:${String(ctx.webServer.port)}/api/remote.mux`, {
      headers: { cookie: browserCookie(ctx) },
    })
    const ping = once(socket, 'ping')
    await once(socket, 'open')
    expect((await ping)[0]).toEqual(Buffer.alloc(0))

    socket.close()
    await once(socket, 'close')
  })

  it('multiplexes independent streams over one WebSocket and propagates cancellation', async () => {
    const { ctx, service } = await setup(true)
    const socket = new WebSocket(`ws://127.0.0.1:${String(ctx.webServer.port)}/api/remote.mux`, {
      headers: { cookie: browserCookie(ctx) },
    })
    await once(socket, 'open')
    const frames: Record<string, unknown>[] = []
    socket.on('message', (data) => { frames.push(JSON.parse(rawText(data)) as Record<string, unknown>) })

    sendOpen(socket, 'a', 'feed/follow', { label: 'a' })
    sendOpen(socket, 'b', 'feed/follow', { label: 'b' })
    await vi.waitFor(() => {
      expect(frames).toEqual(expect.arrayContaining([
        { type: 'item', streamId: 'a', value: 'a:ready' },
        { type: 'item', streamId: 'b', value: 'b:ready' },
      ]))
    })
    expect(service.signals.map(signal => signal.aborted)).toEqual([false, false])
    expect(service.returns).toBe(0)

    socket.send(JSON.stringify({ type: 'cancel', streamId: 'a' }))
    await vi.waitFor(() => { expect(service.returns).toBe(1) })
    expect(service.signals[0]?.aborted).toBe(true)
    expect(service.signals[1]?.aborted).toBe(false)

    sendOpen(socket, 'sync', 'feed/sync', { label: 's' })
    sendOpen(socket, 'invalid', 'feed/invalid', {})
    sendOpen(socket, 'non-json', 'feed/nonJson', {})
    sendOpen(socket, 'rejected', 'feed/reject', {})
    await vi.waitFor(() => {
      expect(frames.filter(frame => frame.streamId === 'sync')).toEqual([
        { type: 'item', streamId: 'sync', value: 's:one' },
        { type: 'item', streamId: 'sync', value: 's:two' },
        { type: 'end', streamId: 'sync' },
      ])
      expect(frames.filter(frame => frame.streamId === 'invalid')).toEqual([
        { type: 'item', streamId: 'invalid', value: 42 },
        { type: 'end', streamId: 'invalid' },
      ])
      expect(frames.find(frame => frame.streamId === 'non-json')).toMatchObject({
        type: 'error', error: { code: 'gateway/internal' },
      })
      expect(frames.find(frame => frame.streamId === 'rejected')).toEqual({
        type: 'error',
        streamId: 'rejected',
        error: {
          code: 'fixture/rejected',
          message: 'fixture rejected the stream',
          details: { retryable: false },
        },
      })
    })

    const closed = once(socket, 'close')
    sendOpen(socket, 'broken-error', 'feed/rejectWithNonJsonDetails', {})
    const closeEvent = await closed
    expect(closeEvent[0]).toBe(1011)
    expect(String(closeEvent[1])).toBe('Remote stream failure could not be delivered')
    await vi.waitFor(() => { expect(service.returns).toBe(2) })
    expect(service.signals[1]?.aborted).toBe(true)
  })

  it('carries the registered Remote event source and withdraws its active stream', async () => {
    const { ctx } = await setup(true)
    let sourceSignal: AbortSignal | undefined
    const sourceClosed = vi.fn()
    const publish = Promise.withResolvers<undefined>()
    const source = (signal: AbortSignal): AsyncIterable<{ event: string; args: readonly unknown[] }> => {
      sourceSignal = signal
      return (async function *() {
        try {
          await publish.promise
          yield { event: 'fixture/changed', args: ['settings'] }
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
        } finally {
          sourceClosed()
        }
      })()
    }
    const unregister = ctx.typertGateway.registerRemoteEvents(source, REMOTE_HOST)
    expect(() => { ctx.typertGateway.registerRemoteEvents(source, REMOTE_HOST) })
      .toThrow('forwarded Remote event source is already registered')

    const socket = new WebSocket(`ws://127.0.0.1:${String(ctx.webServer.port)}/api/remote.mux`, {
      headers: { cookie: browserCookie(ctx) },
    })
    await once(socket, 'open')
    const frames: Record<string, unknown>[] = []
    socket.on('message', (data) => { frames.push(JSON.parse(rawText(data)) as Record<string, unknown>) })
    sendOpen(socket, 'events', '$events', {})

    await vi.waitFor(() => {
      const eventFrames = frames.filter(frame => frame.streamId === 'events')
      expect(eventFrames).toHaveLength(1)
      expect(eventFrames[0]).toMatchObject({
        type: 'item', streamId: 'events', value: { type: 'ready', host: REMOTE_HOST },
      })
      expect(typeof Reflect.get(eventFrames[0]!.value as object, 'clientId')).toBe('string')
    })
    publish.resolve(undefined)
    await vi.waitFor(() => {
      const eventFrames = frames.filter(frame => frame.streamId === 'events').slice(0, 2)
      expect(eventFrames).toHaveLength(2)
      expect(eventFrames[0]).toMatchObject({
        type: 'item', streamId: 'events', value: { type: 'ready', host: REMOTE_HOST },
      })
      expect(typeof Reflect.get(eventFrames[0]!.value as object, 'clientId')).toBe('string')
      expect(eventFrames[1]).toEqual({
        type: 'item', streamId: 'events', value: {
          type: 'emit', event: 'fixture/changed', args: ['settings'],
        },
      })
    })
    expect(sourceSignal?.aborted).toBe(false)

    await unregister()
    expect(sourceClosed).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect(sourceSignal?.aborted).toBe(true)
      expect(frames).toContainEqual({ type: 'end', streamId: 'events' })
    })

    const unregisterReplacement = ctx.typertGateway.registerRemoteEvents(source, REMOTE_HOST)
    await unregister()
    expect(() => { ctx.typertGateway.registerRemoteEvents(source, REMOTE_HOST) })
      .toThrow('forwarded Remote event source is already registered')
    await unregisterReplacement()
    socket.close()
  })

  it('rejects a scoped dispatch yielded after its Remote event source is withdrawn', async () => {
    const { ctx } = await setup(false)
    const publish = Promise.withResolvers<undefined>()
    const agent = ctx.extend()
    const pending = pendingInvocation(agent)
    const source = (): AsyncIterable<TypertRemoteEventDispatch> => (async function* () {
      await publish.promise
      yield pending.dispatch
    })()
    const unregister = ctx.typertGateway.registerRemoteEvents(source, REMOTE_HOST)
    const rejected = expect(pending.outcome).rejects.toThrow(
      'forwarded Remote event source was removed',
    )

    publish.resolve(undefined)
    await unregister()

    await rejected
    expect(pending.reject).toHaveBeenCalledTimes(1)
    expect(pending.resolve).not.toHaveBeenCalled()
  })

  it('cancels a pending waterfall when its source rejects during removal', async () => {
    const { ctx } = await setup(true)
    const agent = ctx.extend()
    const pending = pendingInvocation(agent, undefined, 'ship', agentId('agent-removal'))
    const rejected = expect(pending.outcome).rejects.toThrow(
      'forwarded Remote event source was removed',
    )
    const unregister = ctx.typertGateway.registerRemoteEvents(signal => (async function* () {
      yield pending.dispatch
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
      throw new Error('fixture source rejected during removal')
    })(), REMOTE_HOST)
    const client = await openEventClient(ctx, 'events-removal')
    await vi.waitFor(() => { expect(deliveredInvocation(client)).toBeDefined() })

    await unregister()
    await rejected
    expect(pending.reject).toHaveBeenCalledTimes(1)
    expect(pending.resolve).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(client.frames).toContainEqual({ type: 'end', streamId: client.streamId })
    })
    client.socket.close()
  })

  it('rejects malformed scoped invocations and delegates a released Context', async () => {
    const { ctx } = await setup(false)
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)

    for (const event of [42, ''] as const) {
      const invalidName = pendingInvocation(ctx)
      const rejected = expect(invalidName.outcome).rejects.toThrow(
        'Remote event name must be a nonempty string',
      )
      source.push({
        ...invalidName.dispatch,
        event: event as unknown as string,
      })
      await rejected
    }

    let selected = ctx.extend()
    const nonJsonIdentity = pendingInvocation(selected, undefined, 'ship', 1n)
    const nonJsonRejected = expect(nonJsonIdentity.outcome).rejects.toThrow(
      'require a non-empty Agent identity',
    )
    source.push(nonJsonIdentity.dispatch)
    await nonJsonRejected

    const invalidRequest = pendingInvocation(selected, undefined, 'ship', agentId('agent-invalid-request'))
    const invalidRequestRejected = expect(invalidRequest.outcome).rejects.toThrow(
      'must carry its scoped Agent directly',
    )
    source.push({
      ...invalidRequest.dispatch,
      request: {},
    })
    await invalidRequestRejected

    const staleFiber = ctx.plugin(() => {})
    await staleFiber
    selected = staleFiber.ctx
    await staleFiber.dispose()
    const stale = pendingInvocation(selected, undefined, 'ship', agentId('agent-stale'))
    source.push(stale.dispatch)
    await expect(stale.outcome).resolves.toEqual({ kind: 'next' })
    expect(stale.reject).not.toHaveBeenCalled()

    selected = ctx.extend()
    const abort = new AbortController()
    abort.abort('fixture non-error cancellation')
    const cancelled = pendingInvocation(selected, abort.signal, 'ship', agentId('agent-cancelled'))
    const cancelledOutcome = expect(cancelled.outcome).rejects.toMatchObject({
      message: 'typert gateway: Remote event was cancelled',
      cause: 'fixture non-error cancellation',
    })
    source.push(cancelled.dispatch)
    await cancelledOutcome

    await unregister()
  })

  it('rejects notification arguments that are not lossless JSON arrays', async () => {
    const { ctx } = await setup(false)
    const frames = [
      { event: 'fixture/changed', args: {} },
      { event: 'fixture/changed', args: [1n] },
    ]
    for (const frame of frames) {
      let sourceSignal: AbortSignal | undefined
      const unregister = ctx.typertGateway.registerRemoteEvents((signal) => {
        sourceSignal = signal
        return (async function* () {
          yield frame as unknown as TypertRemoteEventDispatch
        })()
      }, REMOTE_HOST)
      await vi.waitFor(() => { expect(sourceSignal?.aborted).toBe(true) })
      const reason: unknown = sourceSignal?.reason
      if (!(reason instanceof Error)) throw new Error('Remote event source did not fail with an Error')
      expect(reason.message).toContain('arguments are not lossless JSON data')
      await unregister()
    }
  })

  it('retries a colliding Remote event id before publishing the second waterfall', async () => {
    const { ctx } = await setup(false)
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const agent = ctx.extend()
    const firstId = '00000000-0000-4000-8000-000000000001' as ReturnType<typeof randomUUID>
    const secondId = '00000000-0000-4000-8000-000000000002' as ReturnType<typeof randomUUID>
    randomUuid.mockReturnValueOnce(firstId).mockReturnValueOnce(firstId).mockReturnValueOnce(secondId)
    const firstAbort = new AbortController()
    const secondAbort = new AbortController()
    const first = pendingInvocation(agent, firstAbort.signal, 'first', agentId('agent-collision'))
    const second = pendingInvocation(agent, secondAbort.signal, 'second', agentId('agent-collision'))

    source.push(first.dispatch)
    await vi.waitFor(() => { expect(randomUuid).toHaveBeenCalledTimes(1) })
    source.push(second.dispatch)
    await vi.waitFor(() => { expect(randomUuid).toHaveBeenCalledTimes(3) })

    const firstReason = new Error('cancel first collision fixture')
    const secondReason = new Error('cancel second collision fixture')
    const firstRejected = expect(first.outcome).rejects.toBe(firstReason)
    const secondRejected = expect(second.outcome).rejects.toBe(secondReason)
    firstAbort.abort(firstReason)
    secondAbort.abort(secondReason)
    await firstRejected
    await secondRejected
    await unregister()
  })

  it('retries a colliding Remote event Client id before opening the second generation', async () => {
    const { ctx } = await setup(true)
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const firstId = '00000000-0000-4000-8000-000000000011' as ReturnType<typeof randomUUID>
    const secondId = '00000000-0000-4000-8000-000000000012' as ReturnType<typeof randomUUID>
    randomUuid.mockReturnValueOnce(firstId).mockReturnValueOnce(firstId).mockReturnValueOnce(secondId)

    const first = await openEventClient(ctx, 'events-client-id-a')
    const second = await openEventClient(ctx, 'events-client-id-b')

    expect(first.clientId).toBe(firstId)
    expect(second.clientId).toBe(secondId)
    expect(randomUuid).toHaveBeenCalledTimes(3)
    first.socket.close()
    second.socket.close()
    await unregister()
  })

  it.each([1, 2] as const)('rejects a reply without the required permission and keeps the interaction unsettled (protocol %s)', async (version) => {
    const { ctx } = await setup(true, { interactionReplyPermissions: { approval: false, question: true } })
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const agent = ctx.extend()
    const client = await openEventClient(ctx, 'events-a', version)
    const approval = pendingInvocation(agent, undefined, 'ship', agentId('agent-1'), {
      sessionId: 'session-1' as RemoteInteractionSessionId, type: 'approval', requiredPermission: 'approval.respond',
    })
    const question = pendingInvocation(agent, undefined, 'deliver', agentId('agent-1'), {
      sessionId: 'session-1' as RemoteInteractionSessionId, type: 'question', requiredPermission: 'question.respond',
    })
    source.push(approval.dispatch)
    source.push(question.dispatch)
    await vi.waitFor(() => {
      expect(deliveredInvocation(client)).toBeDefined()
    })
    const frames = client.frames
      .filter(frame => frame.type === 'item' && frame.streamId === client.streamId)
      .map(frame => frame.value as RemoteEventInvocationFrame)
      .filter(value => Object.hasOwn(value, 'eventId'))
    const byPrompt = (prompt: string) => frames.find(frame => (frame.request as { prompt?: unknown } | undefined)?.prompt === prompt)!
    const approvalFrame = byPrompt('ship')
    const questionFrame = byPrompt('deliver')
    expect(approvalFrame).toBeDefined()
    expect(questionFrame).toBeDefined()

    const unsettled = expect(approval.outcome).rejects.toThrow('forwarded Remote event source was removed')
    await expect(sendEventResult(client, approvalFrame, {
      kind: 'result', value: 'allowed',
    }, version)).rejects.toMatchObject({ code: 'gateway/permission-denied' })
    expect(approval.resolve).not.toHaveBeenCalled()
    expect(approval.reject).not.toHaveBeenCalled()

    await sendEventResult(client, questionFrame, {
      kind: 'result', value: 'answered',
    }, version)
    await expect(question.outcome).resolves.toEqual({ kind: 'result', value: 'answered' })
    expect(approval.resolve).not.toHaveBeenCalled()
    client.socket.close()
    await unregister()
    await unsettled
  })

  it.each([1, 2] as const)('accepts one answer and reports interaction-closed to the loser over protocol %s', async (version) => {
    const { ctx } = await setup(true)
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const agent = ctx.extend()
    const first = await openEventClient(ctx, 'events-a', version)
    const second = await openEventClient(ctx, 'events-b', version)
    const pending = pendingInvocation(agent)
    source.push(pending.dispatch)

    await vi.waitFor(() => {
      expect(deliveredInvocation(first)).toBeDefined()
      expect(deliveredInvocation(second)).toBeDefined()
    })
    const firstFrame = deliveredInvocation(first)!
    const secondFrame = deliveredInvocation(second)!
    expect(firstFrame.eventId).toBe(secondFrame.eventId)
    expect(firstFrame).toMatchObject({
      type: 'waterfall',
      event: 'fixture/approval',
      agentId: 'agent-1',
      request: { prompt: 'ship' },
    })
    expect(firstFrame).not.toHaveProperty('deliveryId')
    expect(secondFrame).not.toHaveProperty('deliveryId')

    await sendEventResult(second, secondFrame, {
      kind: 'result', value: 'allowed',
    }, version)
    await expect(pending.outcome).resolves.toEqual({ kind: 'result', value: 'allowed' })
    await vi.waitFor(() => {
      expect(first.frames).toContainEqual({
        type: 'item',
        streamId: first.streamId,
        value: { type: 'cancel', eventId: firstFrame.eventId },
      })
    })

    await expect(sendEventResult(first, firstFrame, {
      kind: 'result', value: 'rejected',
    }, version)).rejects.toMatchObject({ code: 'interaction-closed' })
    expect(pending.resolve).toHaveBeenCalledTimes(1)
    expect(pending.reject).not.toHaveBeenCalled()
    first.socket.close()
    second.socket.close()
    await unregister()
  })

  it.each(['resolved', 'cancelled'] as const)('replays protocol-2 interaction identity and closes it as %s beside a protocol-1 Client', async (status) => {
    const { ctx } = await setup(true)
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const oldClient = await openEventClient(ctx, 'events-legacy', 1)
    const original = await openEventClient(ctx, 'events-record-original', 2)
    const abort = new AbortController()
    const pending = pendingInvocation(ctx.extend(), abort.signal, 'ship', agentId('agent-1'), {
      sessionId: 'session-1' as RemoteInteractionSessionId, type: 'approval', requiredPermission: 'approval.respond',
    })
    source.push(pending.dispatch)
    await vi.waitFor(() => { expect(deliveredInvocation(original)).toBeDefined() })
    const frame = deliveredInvocation(original)!
    expect(frame.interaction).toEqual({
      requestId: frame.eventId, sessionId: 'session-1', type: 'approval', requiredPermission: 'approval.respond',
      createdAt: expect.any(Number) as unknown, status: 'pending', revision: 1,
    })
    const legacyFrame = { type: 'waterfall', event: 'fixture/approval', eventId: frame.eventId,
      agentId: 'agent-1', request: { prompt: 'ship' } }
    await vi.waitFor(() => { expect(deliveredInvocation(oldClient)).toEqual(legacyFrame) })
    const closed = once(original.socket, 'close')
    original.socket.close()
    await closed
    const replacement = await openEventClient(ctx, 'events-record-replay', 2)
    expect(replacement.frames).toContainEqual({ type: 'item', streamId: replacement.streamId,
      value: { type: 'ready', clientId: replacement.clientId, host: REMOTE_HOST, pendingInteractionIds: [frame.eventId] } })
    expect(original.frames).toContainEqual({ type: 'item', streamId: original.streamId,
      value: { type: 'ready', clientId: original.clientId, host: REMOTE_HOST, pendingInteractionIds: [] } })
    expect(oldClient.frames).toContainEqual({ type: 'item', streamId: oldClient.streamId,
      value: { type: 'ready', clientId: oldClient.clientId, host: REMOTE_HOST } })
    await vi.waitFor(() => { expect(deliveredInvocation(replacement)).toEqual(frame) })
    expect(pending.resolve).not.toHaveBeenCalled()
    if (status === 'resolved') {
      await sendEventResult(oldClient, deliveredInvocation(oldClient)!, { kind: 'result', value: 'allowed' })
      await expect(pending.outcome).resolves.toEqual({ kind: 'result', value: 'allowed' })
    } else {
      const rejected = expect(pending.outcome).rejects.toThrow('Host cancelled the interaction')
      abort.abort(new Error('Host cancelled the interaction'))
      await rejected
      await vi.waitFor(() => {
        expect(oldClient.frames).toContainEqual({ type: 'item', streamId: oldClient.streamId,
          value: { type: 'cancel', eventId: frame.eventId } })
      })
    }
    await vi.waitFor(() => {
      expect(replacement.frames).toContainEqual({ type: 'item', streamId: replacement.streamId,
        value: { type: 'cancel', eventId: frame.eventId, interaction: { ...frame.interaction, status, revision: 2 } } })
    })
    await expect(sendEventResult(replacement, frame, { kind: 'result', value: 'late' }, 2))
      .rejects.toMatchObject({ code: 'interaction-closed' })
    const after = await openEventClient(ctx, 'events-record-after', 2)
    expect(after.frames).toContainEqual({ type: 'item', streamId: after.streamId,
      value: { type: 'ready', clientId: after.clientId, host: REMOTE_HOST, pendingInteractionIds: [] } })
    after.socket.close()
    oldClient.socket.close()
    replacement.socket.close()
    await unregister()
  })

  it.each([
    { kind: 'next' }, { kind: 'result', value: 'allowed' },
    { kind: 'rejected', error: { name: 'Error', message: 'Client declined' } },
  ] as const)('retains protocol-2 interaction delivery after invalid revisions for $kind', async (outcome) => {
    const { ctx } = await setup(true)
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const client = await openEventClient(ctx, 'revision-client', 2)
    const pending = pendingInvocation(ctx.extend(), undefined, 'ship', agentId('agent-1'), {
      sessionId: 'session-1' as RemoteInteractionSessionId, type: 'approval', requiredPermission: 'approval.respond',
    })
    source.push(pending.dispatch)
    await vi.waitFor(() => { expect(deliveredInvocation(client)).toBeDefined() })
    const frame = deliveredInvocation(client)!
    await expect(sendEventResult(client, frame, outcome, 2, null)).rejects.toMatchObject({ code: 'gateway/input-invalid' })
    await expect(sendEventResult(client, frame, outcome, 2, 2)).rejects.toMatchObject({ code: 'revision-conflict' })
    await expect(sendEventResult(client, frame, outcome, 1, null)).rejects.toMatchObject({ code: 'gateway/input-invalid' })
    expect(pending.resolve).not.toHaveBeenCalled()
    expect(pending.reject).not.toHaveBeenCalled()
    await sendEventResult(client, frame, { kind: 'result', value: 'corrected' }, 2)
    await expect(pending.outcome).resolves.toEqual({ kind: 'result', value: 'corrected' })
    expect(pending.resolve).toHaveBeenCalledTimes(1)
    await expect(sendEventResult(client, frame, outcome, 2, 2)).rejects.toMatchObject({ code: 'interaction-closed' })
    client.socket.close()
    await unregister()
  })

  it.each([1, 2] as const)('rejects revision fields on unrecorded protocol-%s waterfalls', async (version) => {
    const { ctx } = await setup(true)
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const client = await openEventClient(ctx, 'plain-client', version)
    const pending = pendingInvocation(ctx.extend())
    source.push(pending.dispatch)
    await vi.waitFor(() => { expect(deliveredInvocation(client)).toBeDefined() })
    const frame = deliveredInvocation(client)!
    await expect(sendEventResult(client, frame, { kind: 'next' }, version, 1))
      .rejects.toMatchObject({ code: 'gateway/input-invalid' })
    await expect(sendEventResult(client, frame, { kind: 'next' }, version === 1 ? 2 : 1))
      .rejects.toMatchObject({ code: 'gateway/input-invalid' })
    expect(pending.resolve).not.toHaveBeenCalled()
    await sendEventResult(client, frame, { kind: 'next' }, version)
    await expect(pending.outcome).resolves.toEqual({ kind: 'next' })
    client.socket.close()
    await unregister()
  })

  it('rejects the Host waterfall with the first Client listener rejection', async () => {
    const { ctx } = await setup(true)
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const agent = ctx.extend()
    const client = await openEventClient(ctx, 'events-rejected')
    const pending = pendingInvocation(agent, undefined, 'ship', agentId('agent-rejected'))
    source.push(pending.dispatch)
    await vi.waitFor(() => { expect(deliveredInvocation(client)).toBeDefined() })
    const frame = deliveredInvocation(client)!
    const rejected = expect(pending.outcome).rejects.toMatchObject({
      name: 'UserQuestionError',
      message: 'the user cancelled ask_user_question',
      code: 'ASK_CANCELLED',
      details: { questionId: 'question-1' },
    })

    await sendEventResult(client, frame, {
      kind: 'rejected',
      error: {
        name: 'UserQuestionError',
        message: 'the user cancelled ask_user_question',
        code: 'ASK_CANCELLED',
        details: { questionId: 'question-1' },
      },
    })
    await rejected
    expect(pending.reject).toHaveBeenCalledTimes(1)
    expect(pending.resolve).not.toHaveBeenCalled()

    client.socket.close()
    await unregister()
  })

  it('delegates to the Host only after every active Client returns next', async () => {
    const { ctx } = await setup(true)
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const agent = ctx.extend()
    const first = await openEventClient(ctx, 'events-next-a')
    const second = await openEventClient(ctx, 'events-next-b')
    const pending = pendingInvocation(agent)
    source.push(pending.dispatch)
    await vi.waitFor(() => {
      expect(deliveredInvocation(first)).toBeDefined()
      expect(deliveredInvocation(second)).toBeDefined()
    })
    const firstFrame = deliveredInvocation(first)!
    const secondFrame = deliveredInvocation(second)!

    await sendEventResult(first, firstFrame, { kind: 'next' })
    expect(pending.resolve).not.toHaveBeenCalled()
    await expect(sendEventResult(first, firstFrame, { kind: 'result', value: 'after delegation' })).rejects.toMatchObject({ code: 'interaction-closed' })
    expect(pending.resolve).not.toHaveBeenCalled()
    await sendEventResult(second, secondFrame, { kind: 'next' })
    await expect(pending.outcome).resolves.toEqual({ kind: 'next' })
    expect(pending.resolve).toHaveBeenCalledTimes(1)
    expect(pending.reject).not.toHaveBeenCalled()
    first.socket.close()
    second.socket.close()
    await unregister()
  })

  it('delivers a pending waterfall to the first Client that connects', async () => {
    const { ctx } = await setup(true)
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const agent = ctx.extend()
    const pending = pendingInvocation(agent, undefined, 'before-connect', agentId('agent-late-client'))

    source.push(pending.dispatch)
    await vi.waitFor(() => { expect(randomUuid).toHaveBeenCalledTimes(1) })

    const client = await openEventClient(ctx, 'events-first-client')
    await vi.waitFor(() => { expect(deliveredInvocation(client)).toBeDefined() })
    const frame = deliveredInvocation(client)!
    expect(frame).toMatchObject({
      type: 'waterfall',
      event: 'fixture/approval',
      agentId: 'agent-late-client',
      request: { prompt: 'before-connect' },
    })

    await sendEventResult(client, frame, { kind: 'result', value: 'allowed' })
    await expect(pending.outcome).resolves.toEqual({ kind: 'result', value: 'allowed' })

    client.socket.close()
    await unregister()
  })

  it('replays a pending event id to a replacement Client generation', async () => {
    const { ctx } = await setup(true)
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const agent = ctx.extend()
    const original = await openEventClient(ctx, 'events-original')
    const pending = pendingInvocation(agent)
    source.push(pending.dispatch)
    await vi.waitFor(() => { expect(deliveredInvocation(original)).toBeDefined() })
    const originalFrame = deliveredInvocation(original)!
    const closed = once(original.socket, 'close')
    original.socket.close()
    await closed

    await expect(sendEventResult(original, originalFrame, { kind: 'result', value: 'stale' })).rejects.toMatchObject({ code: 'interaction-closed' })
    expect(pending.resolve).not.toHaveBeenCalled()
    const replacement = await openEventClient(ctx, 'events-replacement')
    await vi.waitFor(() => { expect(deliveredInvocation(replacement)).toBeDefined() })
    const replayed = deliveredInvocation(replacement)!
    expect(replayed.eventId).toBe(originalFrame.eventId)
    expect(replayed).not.toHaveProperty('deliveryId')
    await sendEventResult(replacement, replayed, {
      kind: 'result', value: 'allowed',
    })
    await expect(pending.outcome).resolves.toEqual({ kind: 'result', value: 'allowed' })

    replacement.socket.close()
    await unregister()
  })

  it('cancels pending deliveries when the Host signal or Context ends', async () => {
    const { ctx } = await setup(true)
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const signalAgent = ctx.extend()
    const contextFiber = ctx.plugin(() => {})
    await contextFiber
    const contextAgent = contextFiber.ctx
    const client = await openEventClient(ctx, 'events-cancel')

    const abort = new AbortController()
    const signalPending = pendingInvocation(signalAgent, abort.signal, 'signal', agentId('agent-signal'))
    source.push(signalPending.dispatch)
    await vi.waitFor(() => { expect(deliveredInvocation(client)).toBeDefined() })
    const signalFrame = deliveredInvocation(client)!
    expect(signalFrame).toMatchObject({
      type: 'waterfall',
      agentId: 'agent-signal',
      request: { prompt: 'signal' },
    })
    const signalReason = new Error('Host caller cancelled')
    const signalOutcome = expect(signalPending.outcome).rejects.toBe(signalReason)
    abort.abort(signalReason)
    await signalOutcome
    await expect(sendEventResult(client, signalFrame, { kind: 'result', value: 'late' })).rejects.toMatchObject({ code: 'interaction-closed' })
    await vi.waitFor(() => {
      expect(client.frames).toContainEqual({
        type: 'item',
        streamId: client.streamId,
        value: { type: 'cancel', eventId: signalFrame.eventId },
      })
    })

    const contextPending = pendingInvocation(contextAgent, undefined, 'context', agentId('agent-context'))
    source.push(contextPending.dispatch)
    let contextFrame: RemoteEventInvocationFrame | undefined
    await vi.waitFor(() => {
      contextFrame = client.frames
        .filter(frame => frame.type === 'item' && frame.streamId === client.streamId)
        .map(frame => frame.value)
        .find(value => typeof value === 'object'
          && value !== null
          && Reflect.get(value, 'event') === 'fixture/approval'
          && Reflect.get(value, 'eventId') !== signalFrame.eventId) as RemoteEventInvocationFrame | undefined
      expect(contextFrame).toBeDefined()
    })
    const contextOutcome = expect(contextPending.outcome).rejects.toThrow('Agent Context was released')
    await contextFiber.dispose()
    await contextOutcome
    await vi.waitFor(() => {
      expect(client.frames).toContainEqual({
        type: 'item',
        streamId: client.streamId,
        value: { type: 'cancel', eventId: contextFrame!.eventId },
      })
    })

    client.socket.close()
    await unregister()
  })

  it('validates the internal Remote event request and reports an absent source', async () => {
    const { ctx } = await setup(true)
    const socket = new WebSocket(`ws://127.0.0.1:${String(ctx.webServer.port)}/api/remote.mux`, {
      headers: { cookie: browserCookie(ctx) },
    })
    await once(socket, 'open')
    const frames: Record<string, unknown>[] = []
    socket.on('message', (data) => { frames.push(JSON.parse(rawText(data)) as Record<string, unknown>) })

    sendOpen(socket, 'missing', '$events', {})
    await vi.waitFor(() => {
      expect(frames.find(frame => frame.streamId === 'missing')?.type).toBe('error')
      expect(streamErrorMessage(frames, 'missing')).toContain('source is unavailable')
    })

    let sourceCalls = 0
    const unregister = ctx.typertGateway.registerRemoteEvents(() => {
      sourceCalls += 1
      return (async function *(): AsyncIterable<never> {})()
    }, REMOTE_HOST)
    const invalidPayloads: readonly unknown[] = [
      null,
      [],
      {},
      { other: {} },
      { args: null },
      { args: [] },
      { args: { extra: true } },
    ]
    invalidPayloads.forEach((payload, index) => {
      socket.send(JSON.stringify({
        type: 'open', streamId: `invalid-${String(index)}`, endpoint: '$events', payload,
      }))
    })
    await vi.waitFor(() => {
      expect(frames.filter(frame => String(frame.streamId).startsWith('invalid-'))).toHaveLength(invalidPayloads.length)
    })
    for (const [index] of invalidPayloads.entries()) {
      const streamId = `invalid-${String(index)}`
      expect(frames.find(frame => frame.streamId === streamId)?.type).toBe('error')
      expect(streamErrorMessage(frames, streamId)).toContain('requires an empty args object')
    }
    expect(sourceCalls).toBe(1)

    await unregister()
    socket.close()
  })

  it('applies Connection trusted-host policy before accepting the Gateway socket', async () => {
    const { ctx } = await setup(true)
    const socket = new WebSocket(
      `ws://127.0.0.1:${String(ctx.webServer.port)}/api/remote.mux`,
      { headers: { host: 'untrusted.example' } },
    )
    socket.on('error', () => {})
    const responseEvent: unknown[] = await once(socket, 'unexpected-response')
    const request = responseEvent[0]
    const response = responseEvent[1]
    const rejected = response as { statusCode?: number; resume(): void }
    expect(rejected.statusCode).toBe(403)
    rejected.resume()
    ;(request as { abort(): void }).abort()
  })

  it('answers an unauthenticated trusted Host with 401 before opening a stream', async () => {
    const { ctx } = await setup(true)
    const socket = new WebSocket(`ws://127.0.0.1:${String(ctx.webServer.port)}/api/remote.mux`)
    socket.on('error', () => {})
    const responseEvent: unknown[] = await once(socket, 'unexpected-response')
    const request = responseEvent[0]
    const response = responseEvent[1]
    const rejected = response as { statusCode?: number; resume(): void }
    expect(rejected.statusCode).toBe(401)
    rejected.resume()
    ;(request as { abort(): void }).abort()
  })
})

describe('Typert Gateway device admission', () => {
  const storageRoots: string[] = []

  afterEach(async () => {
    await Promise.all(storageRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })

  /** Boot the transport stack with the durable device-trust service present. */
  async function setupDevices(gatewayConfig: GatewayConfig = {}): Promise<Context> {
    const ctx = new Context()
    roots.push(ctx)
    const storageRoot = await mkdtemp(join(tmpdir(), 'gateway-devices-'))
    storageRoots.push(storageRoot)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    provideBrowserCredentials(ctx)
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(Storage)
    const jsonBackend = { name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }
    await ctx.plugin(jsonBackend, { root: storageRoot })
    await ctx.plugin(
      { name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig },
      { backend: 'json' },
    )
    await ctx.plugin(DeviceTrustService)
    await ctx.plugin(TypertGatewayService, gatewayConfig)
    await ctx.plugin({ inject: [...connectionInject], apply: applyConnection })
    return ctx
  }

  /** One freshly generated Ed25519 pair with the wire form of its public key. */
  function ed25519(): { publicKeyB64: string; sign: (message: string) => string } {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    return {
      publicKeyB64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      sign: message => edSign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64'),
    }
  }

  /** Pair one real key under the named section 21 role. */
  async function pairDevice(
    ctx: Context,
    role: 'viewer' | 'collaborator' | 'controller' | 'owner',
  ): Promise<{ deviceId: DeviceId; key: ReturnType<typeof ed25519> }> {
    const key = ed25519()
    const issuance = ctx.deviceTrust.issuePairing(role)
    const grant = await ctx.deviceTrust.redeemPairing({ code: issuance.code, deviceName: 'phone', devicePublicKey: key.publicKeyB64 })
    return { deviceId: grant.deviceId, key }
  }

  /** Fresh nonce per admission; a replayed open payload must be refused. */
  let admissionCounter = 0

  /** The signed open-payload device field for one paired device. */
  function admissionOf(device: { deviceId: DeviceId; key: ReturnType<typeof ed25519> }):
  { deviceId: string; timestamp: number; nonce: string; signature: string } {
    const timestamp = Date.now()
    const nonce = `open-${++admissionCounter}`
    return { deviceId: device.deviceId, timestamp, nonce, signature: device.key.sign(`${device.deviceId}\n${String(timestamp)}\n${nonce}`) }
  }

  it('derives reply permissions from the admitted role matrix', { timeout: 30_000 }, async () => {
    const ctx = await setupDevices({ interactionReplyPermissions: { approval: true, question: true } })
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const agent = ctx.extend()
    const matrix = [
      ['viewer', false, false],
      ['collaborator', false, true],
      ['controller', true, true],
      ['owner', true, true],
    ] as const
    // Denied interactions settle only when the Remote event source is removed
    // below, so their rejection assertions are awaited after the loop.
    const unsettledOutcomes: Promise<unknown>[] = []
    for (const [role, mayApprove, mayAnswer] of matrix) {
      const device = await pairDevice(ctx, role)
      const client = await openEventClient(ctx, `events-${role}`, 2, admissionOf(device))
      const approval = pendingInvocation(agent, undefined, `approve-${role}`, agentId('agent-1'), {
        sessionId: 'session-1' as RemoteInteractionSessionId, type: 'approval', requiredPermission: 'approval.respond',
      })
      const question = pendingInvocation(agent, undefined, `answer-${role}`, agentId('agent-1'), {
        sessionId: 'session-1' as RemoteInteractionSessionId, type: 'question', requiredPermission: 'question.respond',
      })
      source.push(approval.dispatch)
      source.push(question.dispatch)
      const frames = client.frames
      const byPrompt = (prompt: string) => frames
        .filter(frame => frame.type === 'item' && frame.streamId === client.streamId)
        .map(frame => frame.value as RemoteEventInvocationFrame)
        .filter(value => Object.hasOwn(value, 'eventId'))
        .find(frame => (frame.request as { prompt?: unknown } | undefined)?.prompt === prompt)!
      await vi.waitFor(() => {
        expect(byPrompt(`approve-${role}`)).toBeDefined()
        expect(byPrompt(`answer-${role}`)).toBeDefined()
      })
      const approvalFrame = byPrompt(`approve-${role}`)
      const questionFrame = byPrompt(`answer-${role}`)

      if (mayApprove) {
        await sendEventResult(client, approvalFrame, { kind: 'result', value: 'allowed' }, 2)
        await expect(approval.outcome).resolves.toEqual({ kind: 'result', value: 'allowed' })
      } else {
        unsettledOutcomes.push(expect(approval.outcome).rejects.toThrow('forwarded Remote event source was removed'))
        await expect(sendEventResult(client, approvalFrame, { kind: 'result', value: 'allowed' }, 2))
          .rejects.toMatchObject({ code: 'gateway/permission-denied' })
      }
      if (mayAnswer) {
        await sendEventResult(client, questionFrame, { kind: 'result', value: 'answered' }, 2)
        await expect(question.outcome).resolves.toEqual({ kind: 'result', value: 'answered' })
      } else {
        unsettledOutcomes.push(expect(question.outcome).rejects.toThrow('forwarded Remote event source was removed'))
        await expect(sendEventResult(client, questionFrame, { kind: 'result', value: 'answered' }, 2))
          .rejects.toMatchObject({ code: 'gateway/permission-denied' })
      }
      client.socket.close()
    }
    await unregister()
    await Promise.all(unsettledOutcomes)
  })

  it('rejects an admission signed by a different key with the device code', async () => {
    const ctx = await setupDevices()
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const device = await pairDevice(ctx, 'controller')
    const other = ed25519()
    const timestamp = Date.now()
    const failure = await openEventFailure(ctx, 'events-wrong-key', {
      deviceId: device.deviceId, timestamp, nonce: 'nonce-wrong-key', signature: other.sign(`${device.deviceId}\n${String(timestamp)}\nnonce-wrong-key`),
    })
    expect(failure.code).toBe('device/key-invalid')
    await unregister()
  })

  it('refuses a replayed stream-open admission', async () => {
    const ctx = await setupDevices()
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const device = await pairDevice(ctx, 'collaborator')
    const replayed = admissionOf(device)
    const first = await openEventClient(ctx, 'events-first-open', 2, replayed)
    expect(first.streamId).toBeTruthy()
    const failure = await openEventFailure(ctx, 'events-replayed-open', replayed)
    expect(failure.code).toBe('device/replay-detected')
    await unregister()
  })

  it('rejects the admission of a revoked device', async () => {
    const ctx = await setupDevices()
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const device = await pairDevice(ctx, 'collaborator')
    await ctx.deviceTrust.revokeDevice({ deviceId: device.deviceId })
    const failure = await openEventFailure(ctx, 'events-revoked', admissionOf(device))
    expect(failure.code).toBe('device/already-revoked')
    await unregister()
  })

  it('rejects a malformed device field at the wire boundary', async () => {
    const ctx = await setupDevices()
    const source = new RemoteEventSourceProbe()
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    const failure = await openEventFailure(ctx, 'events-malformed', { deviceId: 'device-1' })
    expect(failure.code).toBe('gateway/arguments-invalid')
    await unregister()
  })

  it('rejects a device identity when the device-trust service is absent', async () => {
    const { ctx } = await setup(true)
    const failure = await openEventFailure(ctx, 'events-no-trust', {
      deviceId: 'device-1', timestamp: Date.now(), nonce: 'nonce-absent', signature: 'c2lnbmF0dXJl',
    })
    expect(failure.code).toBe('gateway/service-unavailable')
  })
})

async function setup(
  transport: boolean,
  gatewayConfig: GatewayConfig = {},
): Promise<{ readonly ctx: Context; readonly service: FeedService }> {
  const ctx = new Context()
  roots.push(ctx)
  if (transport) {
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    provideBrowserCredentials(ctx)
  }
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGatewayService, gatewayConfig)
  if (transport) {
    await ctx.plugin({ inject: [...connectionInject], apply: applyConnection })
  }
  await ctx.plugin(FeedService)
  ctx.typert.register({
    package: '@fixture/feed',
    face: 'host',
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: descriptors(),
  })
  const receiver = ctx.get('feed') as unknown as FeedService & { [symbols.original]?: FeedService }
  return { ctx, service: receiver[symbols.original] ?? receiver }
}

function descriptors(): InvocationDescriptor[] {
  const label = {
    name: 'label',
    wire: 'label',
    source: 'json' as const,
    codec: { mode: 'strict' as const, typeSymbol: '@fixture/feed#Label', schema: z.string() },
  }
  const stream = (method: string, parameters: InvocationDescriptor['parameters'], schema: z.ZodType): InvocationDescriptor => ({
    id: `@fixture/feed#feed/${method}`,
    service: 'feed',
    namespace: 'feed',
    method,
    mode: 'stream',
    invocation: { kind: 'direct' },
    parameters,
    result: { mode: 'strict', typeSymbol: '@fixture/feed#Item', schema },
  })
  return [
    { ...stream('follow', [label], z.string()), cancellation: { parameter: 'signal' } },
    stream('sync', [label], z.string()),
    stream('invalid', [], z.string()),
    stream('nonJson', [], z.unknown()),
    stream('missing', [], z.string()),
    { ...stream('abortBeforeOpen', [], z.string()), cancellation: { parameter: 'signal' } },
    stream('reject', [], z.string()),
    stream('rejectWithNonJsonDetails', [], z.string()),
    {
      id: '@fixture/feed#feed/unary',
      service: 'feed',
      namespace: 'feed',
      method: 'unary',
      invocation: { kind: 'direct' },
      parameters: [label],
      result: { mode: 'strict', typeSymbol: '@fixture/feed#Item', schema: z.string() },
    },
  ]
}

interface RemoteEventTestClient {
  readonly socket: WebSocket
  readonly frames: Record<string, unknown>[]
  readonly streamId: string
  readonly clientId: RemoteEventClientId
  readonly origin: string
  readonly cookie: string
}

async function openEventClient(
  ctx: Context,
  streamId: string,
  version: 1 | 2 = 1,
  device?: { readonly deviceId: string; readonly timestamp: number; readonly nonce: string; readonly signature: string },
): Promise<RemoteEventTestClient> {
  const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const cookie = browserCookie(ctx)
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/api/remote.mux`, {
    headers: { cookie },
  })
  await once(socket, 'open')
  const frames: Record<string, unknown>[] = []
  socket.on('message', (data) => { frames.push(JSON.parse(rawText(data)) as Record<string, unknown>) })
  socket.send(JSON.stringify({ type: 'open', streamId, endpoint: '$events',
    payload: {
      ...(version === 2 ? { apiProtocolVersion: 2 } : {}),
      args: { ...(device === undefined ? {} : { device }) },
    },
  }))
  let clientId: RemoteEventClientId | undefined
  await vi.waitFor(() => {
    const failed = frames.find(frame => frame.type === 'error' && frame.streamId === streamId)
    if (failed !== undefined) throw new Error(`stream open failed: ${JSON.stringify(failed)}`)
    const ready = frames.find(frame => frame.type === 'item'
      && frame.streamId === streamId
      && typeof frame.value === 'object'
      && frame.value !== null
      && Reflect.get(frame.value, 'type') === 'ready')
    const candidate: unknown = ready === undefined ? undefined : Reflect.get(ready.value as object, 'clientId')
    expect(typeof candidate).toBe('string')
    if (typeof candidate === 'string') clientId = candidate as RemoteEventClientId
  })
  if (clientId === undefined) throw new Error('Remote event stream omitted its Client id')
  return { socket, frames, streamId, clientId, origin, cookie }
}

/** Open a Remote event stream whose open must fail; returns the error frame's error. */
async function openEventFailure(ctx: Context, streamId: string, device: unknown): Promise<{ code: string; message: string }> {
  const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const cookie = browserCookie(ctx)
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/api/remote.mux`, {
    headers: { cookie },
  })
  await once(socket, 'open')
  const frames: Record<string, unknown>[] = []
  socket.on('message', (data) => { frames.push(JSON.parse(rawText(data)) as Record<string, unknown>) })
  socket.send(JSON.stringify({ type: 'open', streamId, endpoint: '$events', payload: { args: { device } } }))
  let failure: { code: string; message: string } | undefined
  await vi.waitFor(() => {
    const frame = frames.find(entry => entry.type === 'error' && entry.streamId === streamId)
    expect(frame).toBeDefined()
    const error = (frame as { error?: { code?: unknown; message?: unknown } }).error
    expect(typeof error?.code).toBe('string')
    expect(typeof error?.message).toBe('string')
    failure = { code: error!.code as string, message: error!.message as string }
  })
  socket.close()
  return failure!
}

function deliveredInvocation(client: RemoteEventTestClient): RemoteEventInvocationFrame | undefined {
  for (const frame of client.frames) {
    if (frame.type !== 'item' || frame.streamId !== client.streamId) continue
    const value = frame.value
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, 'eventId')) continue
    return value as RemoteEventInvocationFrame
  }
  return undefined
}

async function sendEventResult(
  client: RemoteEventTestClient,
  frame: RemoteEventInvocationFrame,
  outcome:
    | { readonly kind: 'next' }
    | { readonly kind: 'result'; readonly value?: unknown }
    | {
      readonly kind: 'rejected'
      readonly error: {
        readonly name: string
        readonly message: string
        readonly code?: string
        readonly details?: unknown
      }
    },
  version: 1 | 2 = 1,
  revision: number | null = frame.interaction?.revision ?? null,
): Promise<void> {
  const rpcId = `remote-event-result-${client.streamId}`
  const response = await fetch(`${client.origin}/api/$events/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: client.cookie },
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method: '$events/result',
      payload: {
        ...(version === 2 ? { apiProtocolVersion: 2 } : {}),
        args: { clientId: client.clientId, eventId: frame.eventId, outcome,
          ...(revision === null ? {} : { interactionRevision: revision }),
        },
      },
    }),
  })
  expect(response.status).toBe(200)
  const body = await response.json() as {
    readonly result?: { readonly ok?: boolean; readonly error?: { message?: string; code?: string } }
  }
  if (body.result?.ok !== true) {
    throw Object.assign(new Error(body.result?.error?.message ?? 'Remote event result failed'), {
      code: body.result?.error?.code,
    })
  }
}

function sendOpen(socket: WebSocket, streamId: string, endpoint: string, args: object): void {
  socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }))
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

function streamErrorMessage(frames: readonly Record<string, unknown>[], streamId: string): string | undefined {
  const error = frames.find(frame => frame.streamId === streamId)?.error
  if (typeof error !== 'object' || error === null) return undefined
  const message = Reflect.get(error, 'message') as unknown
  return typeof message === 'string' ? message : undefined
}

async function collect(source: AsyncIterable<unknown>): Promise<unknown[]> {
  const values: unknown[] = []
  for await (const value of source) values.push(value)
  return values
}
