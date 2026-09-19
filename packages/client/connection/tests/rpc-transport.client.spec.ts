import { describe, expect, it, vi } from 'vitest'
import { createWebConnectionRpc } from '../src/client/rpc.ts'

describe('Connection RPC transport failures', () => {
  it('identifies a rejected fetch independently of its exception message', async () => {
    const cause = new TypeError('fixture network rejection')
    const rpc = createWebConnectionRpc(() => Promise.reject(cause))
    await expect(rpc.call('/api', 'fixture/call', {})).rejects.toMatchObject({
      isDSHConnectionTransportError: true, cause,
    })
  })

  it('identifies a response body interrupted after successful headers', async () => {
    const cause = new Error('fixture body interrupted')
    const body = new ReadableStream({ start(controller) { controller.error(cause) } })
    const rpc = createWebConnectionRpc(async () => new Response(body))
    await expect(rpc.call('/api', 'fixture/call', {})).rejects.toMatchObject({
      isDSHConnectionTransportError: true, cause,
    })
  })

  it('keeps malformed JSON distinct from a transport interruption', async () => {
    const rpc = createWebConnectionRpc(async () => new Response('{invalid'))
    await expect(rpc.call('/api', 'fixture/call', {})).rejects.toBeInstanceOf(SyntaxError)
  })

  it('serializes before dispatch without marking a local serialization fault as transport loss', async () => {
    const send = vi.fn()
    const rpc = createWebConnectionRpc(send)
    await expect(rpc.call('/api', 'fixture/call', { unsupported: 1n })).rejects.toBeInstanceOf(TypeError)
    expect(send).not.toHaveBeenCalled()
  })

  it.each(['fetch', 'body'] as const)('preserves caller cancellation during %s', async (stage) => {
    const abort = new AbortController()
    const cause = new Error('caller cancelled')
    const rpc = createWebConnectionRpc(async () => {
      if (stage === 'fetch') {
        abort.abort(cause)
        throw new TypeError('aborted fetch')
      }
      return new Response(new ReadableStream({
        pull(controller) {
          abort.abort(cause)
          controller.error(new TypeError('aborted body'))
        },
      }))
    })
    await expect(rpc.call('/api', 'fixture/call', {}, abort.signal)).rejects.toBe(cause)
  })
})
