import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { apply as applyConnection } from '@deepseek-ai/dsh-client-connection/client'
import type { ConnectionHandle, ConnectionRpcResult, ConnectionGenerationProgress } from '@deepseek-ai/dsh-client-connection/client'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { apply, inject, RemoteStreamCarrierError } from '../src/client/index.ts'
import type { RemoteAdmission } from '../src/client/preparation.ts'

const contribution: TypertRemoteContribution = {
  package: '@fixture/admission',
  descriptors: ['ping', 'watch'].map(method => ({
    id: `@fixture/admission#admission/${method}`,
    service: 'admission', namespace: 'admission', method,
    invocation: { kind: 'direct' }, parameters: [], cancellation: { parameter: 'signal' },
    ...(method === 'watch' ? { mode: 'stream' as const } : {}),
    result: { mode: 'strict', typeSymbol: '@fixture#Result', schema: z.string() },
  })),
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
}

async function fixture(version: 1 | 2 = 1, deliverEvent = false, admission?: RemoteAdmission, holdStream = false, authenticate = false) {
  const boot = deferred<undefined>()
  const eventReady = deferred<undefined>()
  const descriptions: Array<ReturnType<typeof deferred<ConnectionRpcResult<unknown>>> & { signal: AbortSignal }> = []
  const order: string[] = []
  const payloads = new Map<string, unknown>()
  let heldReply: ReturnType<typeof deferred<ConnectionRpcResult<unknown>>> | undefined
  let businessSignal: AbortSignal | undefined
  const call: ConnectionHandle['rpc']['call'] = async (_channel, endpoint, _payload, signal) => {
    if (signal === undefined) throw new Error('fixture requires attempt cancellation')
    order.push(endpoint)
    payloads.set(endpoint, _payload)
    if (endpoint === 'host/describe') {
      const pending = { ...deferred<ConnectionRpcResult<unknown>>(), signal }
      descriptions.push(pending)
      return pending.promise
    }
    businessSignal = signal
    return heldReply?.promise ?? { ok: true, value: 'done' }
  }
  const open: NonNullable<ConnectionHandle['rpc']['open']> = (_channel, endpoint, _payload, signal) => ({
    async *[Symbol.asyncIterator]() {
      order.push(endpoint)
      payloads.set(endpoint, _payload)
      if (endpoint === 'admission/watch') {
        yield 'stream'
        if (holdStream) { await aborted(signal); throw signal.reason }
        return
      }
      await Promise.race([eventReady.promise, aborted(signal)])
      if (signal.aborted) return
      yield { type: 'ready', clientId: 'admission-client', host: { home: '/home/admission', platform: 'linux' } }
      if (deliverEvent) yield { type: 'waterfall', event: 'fixture/approval', eventId: 'event-1', agentId: 'agent-1', request: {} }
      await aborted(signal)
    },
  })
  vi.stubGlobal('__DSH_TRANSPORT__', { rpc: { call, open } })
  const ctx = new Context()
  await ctx.plugin({ apply: applyConnection })
  vi.unstubAllGlobals()
  await ctx.plugin(TypertRegistry)
  ctx.provide('loader', { await: () => boot.promise })
  await ctx.plugin({ inject, apply })
  const connection = ctx.get('connection') as ConnectionHandle
  const prepare = vi.fn(async (rpc: ConnectionHandle['rpc'], signal: AbortSignal, progress?: ConnectionGenerationProgress) => {
    if (authenticate) progress?.('authenticating')
    const result = await rpc.call('/api', 'host/describe', { args: {} }, signal)
    if (authenticate) progress?.('connecting')
    if (!result.ok) throw new RemoteError(result.error.code as never, result.error.message, result.error.details as never)
    return { apiProtocolVersion: version }
  })
  const unregister = ctx.remote.$prepare(prepare, admission)
  await ctx.remote.$mount(contribution)
  const api = ctx.get('remote.admission') as unknown as {
    ping(signal?: AbortSignal): Promise<RemoteResult<string>>
    watch(signal?: AbortSignal): AsyncIterable<string>
  }
  return {
    ctx, connection, api, boot, eventReady, descriptions, order, payloads, prepare, unregister,
    holdReply() { heldReply = deferred<ConnectionRpcResult<unknown>>(); return heldReply },
    businessSignal: () => businessSignal,
    async close() {
      for (const pending of descriptions) pending.resolve({ ok: true, value: {} })
      eventReady.resolve(undefined)
      heldReply?.resolve({ ok: true, value: 'late' })
      await ctx.fiber.dispose()
    },
  }
}

describe('application Remote preparation', () => {
  it.each([
    [401, 'none', 'gateway/authentication-required'],
    [403, 'none', 'gateway/permission-denied'],
    [503, 'none', 'gateway/host-not-ready'],
    [502, 'none', 'gateway/transport-interrupted'],
    [401, 'caller', 'gateway/cancelled'],
    [401, 'generation', 'gateway/cancelled'],
  ] as const)('preserves HTTP %s semantics with %s cancellation', async (status, cancellation, code) => {
    const boot = deferred<undefined>()
    const dispatched = deferred<undefined>()
    const response = deferred<Response>()
    const ctx = new Context()
    const fetch = vi.fn(async (input: URL, init: RequestInit) => {
      if (typeof init.body !== 'string') throw new Error('fixture requires a JSON request body')
      const request = JSON.parse(init.body) as { rpcId: string }
      if (input.pathname === '/api/host/describe') return Response.json({
        type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: {} },
      })
      dispatched.resolve(undefined)
      return response.promise
    })
    vi.stubGlobal('__DSH_TRANSPORT__', { fetch, openStream: (_endpoint: string, _payload: unknown, signal: AbortSignal) => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'ready', clientId: 'http-client', host: { home: '/h', platform: 'linux' } }
        await aborted(signal)
      },
    }) })
    try {
      await ctx.plugin({ apply: applyConnection })
      vi.unstubAllGlobals()
      await ctx.plugin(TypertRegistry)
      ctx.provide('loader', { await: () => boot.promise })
      await ctx.plugin({ inject, apply })
      ctx.remote.$prepare(async (rpc, signal) => {
        await rpc.call('/api', 'host/describe', { args: {} }, signal)
        return { apiProtocolVersion: 1 }
      })
      await ctx.remote.$mount(contribution)
      boot.resolve(undefined)
      const connection = ctx.get('connection') as ConnectionHandle
      await expect.poll(() => connection.state.getSnapshot()).toBe('ready')
      const api = ctx.get('remote.admission') as unknown as { ping(signal?: AbortSignal): Promise<RemoteResult<string>> }
      const caller = new AbortController()
      const result = api.ping(caller.signal)
      await dispatched.promise
      if (cancellation === 'caller') caller.abort(new Error('caller stopped'))
      if (cancellation === 'generation') {
        connection.reconnect()
        await expect.poll(() => connection.generation.getSnapshot()?.id).toBe(2)
      }
      response.resolve(new Response('rejected', { status }))
      await expect(result).resolves.toMatchObject({ ok: false, error: {
        code, ...(cancellation === 'none' ? { details: { endpoint: 'admission/ping', httpStatus: status } } : {}),
      } })
      expect(connection.state.getSnapshot()).toBe(status === 401 && cancellation === 'none' ? 'auth-expired' : 'ready')
      expect(fetch.mock.calls.filter(([input]) => input.pathname === '/api/admission/ping')).toHaveLength(1)
    } finally {
      response.resolve(new Response('rejected', { status }))
      await ctx.fiber.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('waits for initial authentication but rejects new calls during retry authentication without queuing them', async () => {
    const f = await fixture(1, false, undefined, false, true)
    try {
      const first = f.api.ping()
      f.boot.resolve(undefined)
      await expect.poll(() => f.connection.state.getSnapshot()).toBe('authenticating')
      expect(f.order).toEqual(['host/describe'])
      f.eventReady.resolve(undefined)
      f.descriptions[0]!.resolve({ ok: true, value: {} })
      await expect(first).resolves.toMatchObject({ ok: true })
      f.connection.reconnect()
      await expect.poll(() => f.descriptions.length).toBe(2)
      expect(f.connection.state.getSnapshot()).toBe('authenticating')
      await expect(f.api.ping()).resolves.toMatchObject({ ok: false, error: { code: 'gateway/connection-unavailable' } })
      await expect(f.api.watch()[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'gateway/connection-unavailable' })
      f.descriptions[1]!.resolve({ ok: true, value: {} })
      await expect.poll(() => f.connection.state.getSnapshot()).toBe('ready')
      expect(f.order.filter(endpoint => endpoint.startsWith('admission/'))).toEqual(['admission/ping'])
      await expect(f.api.ping()).resolves.toMatchObject({ ok: true })
      expect(f.order.filter(endpoint => endpoint.startsWith('admission/'))).toEqual(['admission/ping', 'admission/ping'])
    } finally { await f.close() }
  })

  it('denies calls while Host readiness is delayed and admits them after the opening frame', async () => {
    const f = await fixture()
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const waiting = f.api.ping()
      f.boot.resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)
      f.descriptions[0]!.resolve({ ok: true, value: {} })
      await vi.advanceTimersByTimeAsync(3_000)
      expect(f.connection.state.getSnapshot()).toBe('host-not-ready')
      expect(f.connection.generation.getSnapshot()).toBeUndefined()
      await expect(waiting).resolves.toMatchObject({ ok: false, error: { code: 'gateway/connection-unavailable' } })
      await expect(f.api.watch()[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'gateway/connection-unavailable' })
      expect(f.order).toEqual(['host/describe', '$events'])
      f.eventReady.resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)
      expect(f.connection.state.getSnapshot()).toBe('ready')
      await expect(f.api.ping()).resolves.toMatchObject({ ok: true })
    } finally {
      await f.close()
      warn.mockRestore()
      vi.useRealTimers()
    }
  })

  it.each([
    ['host/protocol-unsupported', 'incompatible'],
    ['gateway/protocol-unsupported', 'incompatible'],
    ['host/capability-unavailable', 'incompatible'],
    ['host/description-invalid', 'fatal'],
    ['gateway/preparation-unavailable', 'fatal'],
  ] as const)('publishes %s as %s and denies new calls until recovery', async (code, state) => {
    const f = await fixture()
    try {
      const first = f.api.ping()
      f.boot.resolve(undefined)
      await expect.poll(() => f.descriptions.length).toBe(1)
      f.descriptions[0]!.resolve({ ok: false, error: { code, message: 'Unavailable', details: {} } })
      await expect(first).resolves.toMatchObject({ ok: false, error: { code } })
      await expect.poll(() => f.connection.state.getSnapshot()).toBe(state)
      await expect(f.api.ping()).resolves.toMatchObject({ ok: false, error: { code: 'gateway/connection-unavailable' } })
      await expect(f.api.watch()[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'gateway/connection-unavailable' })
      expect(f.order).toEqual(['host/describe'])
      expect(f.connection.generation.getSnapshot()).toBeUndefined()
      f.connection.reconnect()
      await expect.poll(() => f.descriptions.length).toBe(2)
      f.descriptions[1]!.resolve({ ok: true, value: {} })
      f.eventReady.resolve(undefined)
      await expect.poll(() => f.connection.state.getSnapshot()).toBe('ready')
      await expect(f.api.ping()).resolves.toMatchObject({ ok: true })
    } finally { await f.close() }
  })

  it.each(['connection', 'caller'] as const)('classifies %s cancellation of an admitted stream by its owner', async (owner) => {
    const f = await fixture(2, false, undefined, true)
    try {
      f.boot.resolve(undefined)
      await expect.poll(() => f.descriptions.length).toBe(1)
      f.descriptions[0]!.resolve({ ok: true, value: {} })
      f.eventReady.resolve(undefined)
      const caller = new AbortController()
      const iterator = f.api.watch(caller.signal)[Symbol.asyncIterator]()
      await expect(iterator.next()).resolves.toMatchObject({ value: 'stream' })
      const pending = iterator.next().catch((error: unknown) => error)
      if (owner === 'connection') f.connection.reconnect()
      else caller.abort(new Error('caller stopped'))
      const failure = await pending
      if (owner === 'connection') expect(failure).toBeInstanceOf(RemoteStreamCarrierError)
      else {
        expect(failure).toBe(caller.signal.reason)
        expect(failure).not.toBeInstanceOf(RemoteStreamCarrierError)
      }
    } finally { await f.close() }
  })

  it.each(['admission/ping', 'admission/watch'])('denies %s before carrier dispatch without poisoning other calls', async (denied) => {
    const f = await fixture(2, false, (endpoint) => {
      if (endpoint === denied) throw new RemoteError('host/capability-unavailable', 'Unavailable', { capability: 'fixture.v1' })
    })
    try {
      f.boot.resolve(undefined)
      await expect.poll(() => f.descriptions.length).toBe(1)
      f.descriptions[0]!.resolve({ ok: true, value: {} })
      f.eventReady.resolve(undefined)
      await expect.poll(() => f.connection.generation.getSnapshot()).toBeDefined()
      if (denied === 'admission/ping') {
        await expect(f.api.ping()).resolves.toMatchObject({ ok: false, error: { code: 'host/capability-unavailable' } })
        await expect(f.api.watch()[Symbol.asyncIterator]().next()).resolves.toMatchObject({ value: 'stream' })
      } else {
        await expect(f.api.watch()[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'host/capability-unavailable' })
        await expect(f.api.ping()).resolves.toMatchObject({ ok: true })
      }
      expect(f.order).not.toContain(denied)
      expect(f.connection.generation.getSnapshot()).toBeDefined()
    } finally { await f.close() }
  })

  it.each([1, 2] as const)('uses selected protocol %s only after discovery and event observation are ready', async (version) => {
    const f = await fixture(version)
    try {
      const unary = f.api.ping()
      const stream = f.api.watch()[Symbol.asyncIterator]().next()
      expect(f.order).toEqual([])
      f.boot.resolve(undefined)
      await expect.poll(() => f.descriptions.length).toBe(1)
      expect(f.order).toEqual(['host/describe'])
      f.descriptions[0]!.resolve({ ok: true, value: {} })
      await expect.poll(() => f.order).toEqual(['host/describe', '$events'])
      expect(f.connection.generation.getSnapshot()).toBeUndefined()
      f.eventReady.resolve(undefined)
      await expect(unary).resolves.toEqual({ ok: true, value: 'done' })
      await expect(stream).resolves.toEqual({ done: false, value: 'stream' })
      expect(f.prepare).toHaveBeenCalledTimes(1)
      expect(f.order.slice(2).sort()).toEqual(['admission/ping', 'admission/watch'])
      for (const endpoint of ['$events', 'admission/ping', 'admission/watch']) {
        expect(f.payloads.get(endpoint)).toEqual(version === 1 ? { args: {} } : { apiProtocolVersion: version, args: {} })
      }
    } finally { await f.close() }
  })

  it('returns discovery failure without sending a business request or opening events', async () => {
    const f = await fixture()
    try {
      const result = f.api.ping()
      f.boot.resolve(undefined)
      await expect.poll(() => f.descriptions.length).toBe(1)
      f.descriptions[0]!.resolve({ ok: false, error: { code: 'gateway/internal', message: 'discovery failed', details: {} } })
      await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'gateway/internal', message: 'discovery failed' } })
      expect(f.order).toEqual(['host/describe'])
      expect(f.connection.generation.getSnapshot()).toBeUndefined()
    } finally { await f.close() }
  })

  it('cancels one waiting caller without cancelling shared discovery', async () => {
    const f = await fixture()
    try {
      const caller = new AbortController()
      const result = f.api.ping(caller.signal)
      const sibling = f.api.ping()
      f.boot.resolve(undefined)
      await expect.poll(() => f.descriptions.length).toBe(1)
      caller.abort()
      await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'gateway/cancelled' } })
      expect(f.descriptions[0]!.signal.aborted).toBe(false)
      f.eventReady.resolve(undefined)
      f.descriptions[0]!.resolve({ ok: true, value: {} })
      await expect(sibling).resolves.toMatchObject({ ok: true })
      expect(f.order.filter(endpoint => endpoint === 'admission/ping')).toHaveLength(1)
    } finally { await f.close() }
  })

  it('invalidates admitted calls on reconnect and repeats discovery before replacements', async () => {
    const f = await fixture()
    try {
      f.boot.resolve(undefined)
      f.eventReady.resolve(undefined)
      await expect.poll(() => f.descriptions.length).toBe(1)
      f.descriptions[0]!.resolve({ ok: true, value: {} })
      await expect.poll(() => f.connection.generation.getSnapshot()?.id).toBe(1)
      const reply = f.holdReply()
      const old = f.api.ping()
      await expect.poll(() => f.businessSignal()).toBeDefined()
      f.connection.reconnect()
      expect(f.businessSignal()?.aborted).toBe(true)
      reply.resolve({ ok: true, value: 'late' })
      await expect(old).resolves.toMatchObject({ ok: false, error: { code: 'gateway/cancelled' } })
      const replacement = f.api.ping()
      await expect(replacement).resolves.toMatchObject({ ok: false, error: { code: 'gateway/connection-unavailable' } })
      await expect.poll(() => f.descriptions.length).toBe(2)
      expect(f.order.filter(endpoint => endpoint === 'admission/ping')).toHaveLength(1)
      f.descriptions[1]!.resolve({ ok: true, value: {} })
      await expect.poll(() => f.connection.generation.getSnapshot()?.id).toBe(2)
      await expect(f.api.ping()).resolves.toMatchObject({ ok: true })
    } finally { await f.close() }
  })

  it('does not publish late discovery from an aborted attempt', async () => {
    const f = await fixture()
    try {
      f.boot.resolve(undefined)
      f.eventReady.resolve(undefined)
      await expect.poll(() => f.descriptions.length).toBe(1)
      f.connection.reconnect()
      expect(f.descriptions[0]!.signal.aborted).toBe(true)
      f.descriptions[0]!.resolve({ ok: true, value: {} })
      await expect.poll(() => f.descriptions.length).toBe(2)
      expect(f.order).toEqual(['host/describe', 'host/describe'])
      expect(f.connection.generation.getSnapshot()).toBeUndefined()
      f.descriptions[1]!.resolve({ ok: true, value: {} })
      await expect.poll(() => f.connection.generation.getSnapshot()?.id).toBe(1)
    } finally { await f.close() }
  })

  it('rejects duplicate owners and keeps admission closed after withdrawal', async () => {
    const f = await fixture()
    try {
      expect(() => f.ctx.remote.$prepare(f.prepare)).toThrow('already registered')
      await f.unregister()
      await expect(f.api.ping()).resolves.toMatchObject({ ok: false, error: { code: 'gateway/preparation-unavailable' } })
      expect(f.order).toEqual([])
    } finally { await f.close() }
  })
})


it.each([1, 2] as const)('replies to forwarded events with the admitted protocol %s', async (version) => {
  const f = await fixture(version, true)
  try {
    f.boot.resolve(undefined)
    await expect.poll(() => f.descriptions.length).toBe(1)
    f.descriptions[0]!.resolve({ ok: true, value: {} })
    f.eventReady.resolve(undefined)
    await expect.poll(() => f.payloads.has('$events/result')).toBe(true)
    expect(f.payloads.get('$events/result')).toEqual({
      ...(version === 1 ? {} : { apiProtocolVersion: version }),
      args: { clientId: 'admission-client', eventId: 'event-1', outcome: { kind: 'next' } },
    })
    expect(f.ctx.remote.$host.apiProtocolVersion).toBe(version)
  } finally {
    await f.close()
  }
})
