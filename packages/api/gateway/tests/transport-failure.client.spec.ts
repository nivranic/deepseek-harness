import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import { carrierFailure } from '../src/client/index.ts'
import { RemoteStream } from '../src/client/remote-stream.ts'
import { RemoteStreamCarrierError } from '../src/client/stream-client.ts'

describe('Gateway transport failure semantics', () => {
  it('recognizes a separately bundled Connection transport marker without guessing from a message', () => {
    const failure = { isDSHConnectionTransportError: true, message: 'Request interrupted' }
    expect(carrierFailure('fixture/call', failure)).toMatchObject({
      ok: false, error: { code: 'gateway/transport-interrupted', details: { endpoint: 'fixture/call' } },
    })
    expect(carrierFailure('fixture/call', new TypeError('Failed to fetch'))).toMatchObject({
      ok: false, error: { code: 'gateway/internal' },
    })
  })

  it.each([
    ['carrier', () => new RemoteStreamCarrierError('socket lost'), 'gateway/transport-interrupted', 2],
    ['business', () => new RemoteError('gateway/permission-denied', 'refused', { endpoint: 'fixture/watch', httpStatus: 403 }), 'gateway/permission-denied', 1],
    ['invalid stream', () => new RemoteError('gateway/stream-invalid', 'invalid frame', { stream: '/api/remote.mux' }), 'gateway/stream-invalid', 1],
    ['local', () => new Error('local defect'), 'gateway/internal', 1],
  ] as const)('classifies %s failure after its existing retry policy', async (_kind, failure, code, opens) => {
    let opened = 0
    let losses = 0
    const generation: ConnectionGeneration = { id: 1, host: { home: '/fixture' } }
    const stream = new RemoteStream({ generation: {
      getSnapshot: () => generation, subscribe: () => () => {},
    } }, {
      name: 'fixture observation',
      open: () => ({
        [Symbol.asyncIterator]() {
          opened++
          return { next: () => Promise.reject(failure()) }
        },
      }),
      ended: () => new Error('unexpected end'),
      carrierFailed: () => { losses++ },
    })
    try {
      await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        isDSHRemoteError: true, code,
        ...code === 'gateway/transport-interrupted' ? { details: { stream: 'fixture observation' } } : {},
      })
      expect(opened).toBe(opens)
      expect(losses).toBe(code === 'gateway/transport-interrupted' ? 2 : 0)
    } finally {
      await stream.dispose()
    }
  })
})
