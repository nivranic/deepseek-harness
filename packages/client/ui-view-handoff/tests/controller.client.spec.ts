/** Host identity, cancellation, and wire validation for received viewing links. */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import type { HostDescriptor, HostId } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { ViewHandoffController } from '../src/client/controller.ts'
import { decodeSessionViewLocation, encodeSessionViewLocation, HandoffFailure } from '../src/client/view-location.ts'

const HOST: HostDescriptor = {
  hostId: 'host-1' as HostId, displayName: 'Fixture', productVersion: 'fixture',
  apiProtocolVersion: 1, sessionFormatVersion: 4, platform: 'linux', arch: 'x64',
  runtimeMode: 'full', capabilities: [], transports: ['http'], serverTime: 0,
}
const VIEW = { hostId: HOST.hostId, sessionId: SessionId('session-1'), anchorSeq: SessionSeq(41) }

function bench(hash = `#dsh-view=${encodeSessionViewLocation(VIEW)}`) {
  const generations = createSnapshotStore<ConnectionGeneration | undefined>(undefined)
  const describeHost = vi.fn<() => Promise<RemoteResult<HostDescriptor>>>(async () => ({ ok: true, value: HOST }))
  const open = vi.fn(async (_location: typeof VIEW, _signal: AbortSignal) => {})
  const clipboard = vi.fn(async (_text: string) => {})
  const location = { origin: 'https://host.example', pathname: '/app', hash }
  const controller = new ViewHandoffController(generations, describeHost, open, clipboard, location)
  onTestFinished(() => { controller.dispose() })
  const connect = (id = 1): void => { generations.set({ id, host: { home: '/fixture' } }) }
  return { generations, describeHost, open, clipboard, location, controller, connect }
}

describe('view link encoding', () => {
  it('round-trips the existing v1 payload', () => {
    expect(decodeSessionViewLocation(encodeSessionViewLocation(VIEW))).toEqual(VIEW)
  })

  it.each(['', 'other.v1.abc', 'dsh-session-view.v1.%', 'dsh-session-view.v1.A'])('rejects malformed encoding %j', (value) => {
    expect(() => decodeSessionViewLocation(value)).toThrow(HandoffFailure)
  })

  it.each([
    'null', '[]', '{}',
    '{"hostId":"h","sessionId":"s","anchorSeq":-0}',
    '{"hostId":"h","sessionId":"s","anchorSeq":-1}',
    '{"hostId":"h","sessionId":"s","anchorSeq":1.5}',
    '{"hostId":"h","sessionId":"s","anchorSeq":9007199254740992}',
    '{"hostId":"","sessionId":"s","anchorSeq":1}',
    '{"hostId":"h","sessionId":"","anchorSeq":1}',
    '{"hostId":"h","sessionId":"s","anchorSeq":1,"extra":true}',
  ])('rejects invalid wire fields %s', (json) => {
    const payload = btoa(json).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    expect(() => decodeSessionViewLocation(`dsh-session-view.v1.${payload}`)).toThrow(HandoffFailure)
  })
})

describe('view handoff lifecycle', () => {
  it('waits for authenticated discovery, opens once, and captures the admitted Host', async () => {
    const h = bench()
    const described = Promise.withResolvers<RemoteResult<HostDescriptor>>()
    h.describeHost.mockReturnValueOnce(described.promise)
    const received = h.controller.receive()
    expect(h.location.hash).toBe('')
    expect(h.describeHost).not.toHaveBeenCalled()
    h.connect()
    expect(h.controller.admission.getSnapshot().status).toBe('waiting')
    expect(h.open).not.toHaveBeenCalled()
    described.resolve({ ok: true, value: HOST })
    await received
    expect(h.open).toHaveBeenCalledWith(VIEW, expect.any(AbortSignal))
    expect(decodeSessionViewLocation(h.controller.encode(VIEW.sessionId, VIEW.anchorSeq)!)).toEqual(VIEW)
    expect(h.controller.buildLink('payload')).toBe('https://host.example/app#dsh-view=payload')
    await h.controller.receive()
    expect(h.open).toHaveBeenCalledOnce()
  })

  it('rejects a different Host before any Session navigation', async () => {
    const h = bench(`#dsh-view=${encodeSessionViewLocation({ ...VIEW, hostId: 'other' as HostId })}`)
    h.connect()
    await h.controller.receive()
    expect(h.open).not.toHaveBeenCalled()
    expect(h.controller.failure.getSnapshot()).toBe('wrongHost')
  })

  it('reports malformed links without waiting for a connection', async () => {
    const h = bench('#dsh-view=invalid')
    await h.controller.receive()
    expect(h.open).not.toHaveBeenCalled()
    expect(h.controller.failure.getSnapshot()).toBe('invalidLink')
  })

  it('ignores discovery from the replaced generation', async () => {
    const h = bench('')
    const old = Promise.withResolvers<RemoteResult<HostDescriptor>>()
    h.describeHost.mockReturnValueOnce(old.promise)
    h.connect(1)
    h.connect(2)
    await vi.waitFor(() => { expect(h.controller.admission.getSnapshot().status).toBe('ready') })
    old.resolve({ ok: true, value: { ...HOST, hostId: 'stale' as HostId } })
    await old.promise
    expect(h.controller.admission.getSnapshot()).toMatchObject({ status: 'ready', hostId: HOST.hostId })
  })

  it('settles pending receipt on disposal and discards late discovery', async () => {
    const h = bench()
    const described = Promise.withResolvers<RemoteResult<HostDescriptor>>()
    h.describeHost.mockReturnValueOnce(described.promise)
    h.connect()
    const received = h.controller.receive()
    h.controller.dispose()
    await received
    described.resolve({ ok: true, value: HOST })
    await described.promise
    expect(h.open).not.toHaveBeenCalled()
    expect(h.controller.admission.getSnapshot()).toEqual({ status: 'waiting' })
    expect(h.controller.failure.getSnapshot()).toBeUndefined()
  })

  it('cancels an in-flight open when its generation is replaced', async () => {
    const h = bench()
    const opening = Promise.withResolvers<undefined>()
    h.open.mockReturnValueOnce(opening.promise)
    h.connect()
    const received = h.controller.receive()
    await vi.waitFor(() => { expect(h.open).toHaveBeenCalledOnce() })
    const signal = h.open.mock.calls[0]![1]
    h.connect(2)
    expect(signal.aborted).toBe(true)
    opening.reject(signal.reason)
    await received
    expect(h.controller.failure.getSnapshot()).toBe('unavailable')
  })

  it('reports refused discovery, failed opening, and clipboard refusal', async () => {
    const unavailable = bench()
    unavailable.describeHost.mockRejectedValueOnce(new Error('offline'))
    unavailable.connect()
    await unavailable.controller.receive()
    expect(unavailable.controller.failure.getSnapshot()).toBe('unavailable')
    expect(unavailable.open).not.toHaveBeenCalled()
    const failed = bench()
    failed.open.mockRejectedValueOnce(new Error('missing session'))
    failed.connect()
    await failed.controller.receive()
    expect(failed.controller.failure.getSnapshot()).toBe('openFailed')
    failed.clipboard.mockRejectedValueOnce(new Error('denied'))
    await expect(failed.controller.copy('link')).resolves.toBe(false)
  })
})
