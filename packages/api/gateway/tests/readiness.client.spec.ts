import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import { createWebConnectionRpc } from '@deepseek-ai/dsh-client-connection/src/client/rpc.ts'
import type { ConnectionHandle, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { apply, inject } from '../src/client/index.ts'

const contribution: TypertRemoteContribution = {
  package: '@fixture/readiness',
  descriptors: [{
    id: '@fixture/readiness#readiness/ping',
    service: 'readiness', namespace: 'readiness', method: 'ping',
    invocation: { kind: 'direct' }, parameters: [], cancellation: { parameter: 'signal' },
    result: { mode: 'strict', typeSymbol: '@fixture#Result', create: () => z.string() },
  }],
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

async function fixture(call: ConnectionHandle['rpc']['call']) {
  const ctx = new Context()
  const boot = deferred<undefined>()
  const attempts: AbortSignal[] = []
  installConnection(ctx, {
    interactions: 'answer',
    transport: { rpc: {
      call,
      open: (_channel, _endpoint, _payload, signal) => ({
        async *[Symbol.asyncIterator]() {
          attempts.push(signal)
          await aborted(signal)
          if (!signal.aborted) yield undefined
        },
      }),
    } },
  })
  await ctx.plugin(TypertRegistry)
  ctx.provide('loader', { await: () => boot.promise })
  await ctx.plugin({ inject, apply })
  const unmount = await ctx.remote.$mount(contribution)
  const api = ctx.get('remote.readiness') as { ping(signal?: AbortSignal): Promise<RemoteResult<string>> }
  const connection = ctx.get('connection') as ConnectionHandle
  return { ctx, boot, attempts, api, connection, unmount }
}

describe('Remote calls and event readiness', () => {
  it.each([
    [401, false], [403, false], [503, false], [502, false], [401, true],
  ] as const)('reports HTTP %s with caller cancellation %s without replay', async (status, cancel) => {
    const response = deferred<Response>()
    const send = vi.fn(() => response.promise)
    const rpc = createWebConnectionRpc(send)
    const f = await fixture((...args) => rpc.call(...args))
    const caller = new AbortController()
    try {
      const pending = f.api.ping(caller.signal)
      if (cancel) caller.abort()
      response.resolve(new Response('refused', { status }))
      await expect(pending).resolves.toMatchObject({
        ok: false, error: { code: cancel ? 'gateway/cancelled' : 'gateway/internal', details: {} },
      })
      expect(send).toHaveBeenCalledOnce()
      expect(f.connection.generation.getSnapshot()).toBeUndefined()
    } finally {
      response.resolve(new Response('refused', { status }))
      await f.ctx.fiber.dispose()
    }
  })

  it('dispatches once before Loader settlement and while event readiness is pending', async () => {
    const call = vi.fn<ConnectionHandle['rpc']['call']>(async () => ({ ok: true, value: 'done' }))
    const f = await fixture(call)
    try {
      await expect(f.api.ping()).resolves.toEqual({ ok: true, value: 'done' })
      expect(f.attempts).toHaveLength(0)
      f.boot.resolve(undefined)
      await expect.poll(() => f.attempts.length).toBe(1)
      expect(f.connection.generation.getSnapshot()).toBeUndefined()
      await expect(f.api.ping()).resolves.toEqual({ ok: true, value: 'done' })
      expect(call.mock.calls.map(([, endpoint, payload]) => [endpoint, payload])).toEqual([
        ['readiness/ping', { args: {} }], ['readiness/ping', { args: {} }],
      ])
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it('keeps an HTTP call independent of an event-connection replacement', async () => {
    const reply = deferred<ConnectionRpcResult<unknown>>()
    const call = vi.fn<ConnectionHandle['rpc']['call']>(() => reply.promise)
    const f = await fixture(call)
    try {
      f.boot.resolve(undefined)
      await expect.poll(() => f.attempts.length).toBe(1)
      const pending = f.api.ping()
      f.connection.reconnect()
      await expect.poll(() => f.attempts.length).toBe(2)
      expect(f.attempts[0]?.aborted).toBe(true)
      expect(call.mock.calls[0]?.[3]?.aborted).toBe(false)
      reply.resolve({ ok: true, value: 'done' })
      await expect(pending).resolves.toEqual({ ok: true, value: 'done' })
      expect(call).toHaveBeenCalledOnce()
    } finally {
      reply.resolve({ ok: true, value: 'done' })
      await f.ctx.fiber.dispose()
    }
  })

  it.each(['caller', 'mount'] as const)('discards a late reply after %s cancellation', async (owner) => {
    const reply = deferred<ConnectionRpcResult<unknown>>()
    const call = vi.fn<ConnectionHandle['rpc']['call']>(() => reply.promise)
    const f = await fixture(call)
    const caller = new AbortController()
    try {
      const pending = f.api.ping(caller.signal)
      if (owner === 'caller') caller.abort()
      else await f.unmount()
      expect(call.mock.calls[0]?.[3]?.aborted).toBe(true)
      reply.resolve({ ok: true, value: 'late' })
      await expect(pending).resolves.toMatchObject({
        ok: false, error: { code: owner === 'caller' ? 'gateway/cancelled' : 'gateway/internal' },
      })
      expect(call).toHaveBeenCalledOnce()
    } finally {
      reply.resolve({ ok: true, value: 'late' })
      await f.ctx.fiber.dispose()
    }
  })
})
