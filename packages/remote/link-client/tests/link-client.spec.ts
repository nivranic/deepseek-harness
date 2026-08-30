import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context as RootContext, Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { apply as applyConnection, inject as connectionInject } from '@deepseek-ai/dsh-client-connection'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { Remote, bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import DeviceTrustStore from '@deepseek-ai/dsh-device-trust'
import LinkAccessService from '@deepseek-ai/dsh-link-access'
import type { LinkPairingPayload } from '@deepseek-ai/dsh-link-access/protocol'
import { LinkClient, LinkError } from '../src/index.ts'

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Fake Remote service covering the reference client's full surface. */
class ClientProbeService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'probe')

  constructor(ctx: Context) {
    super(ctx, 'probe')
  }

  @Remote
  echo(value: string): string {
    return `echo:${value}`
  }

  @Remote
  fail(): never {
    throw new Error('probe business failure')
  }

  @Remote({ mode: 'stream' })
  ticks(count: number, signal: AbortSignal): AsyncIterable<string> {
    return (async function* () {
      for (let index = 0; index < count && !signal.aborted; index += 1) {
        await delay(5)
        yield String(index)
      }
    })()
  }

  @Remote({ mode: 'stream' })
  replay(after: number, signal: AbortSignal): AsyncIterable<string> {
    return (async function* () {
      for (let index = after; index < 5 && !signal.aborted; index += 1) {
        await delay(5)
        yield String(index)
      }
    })()
  }
}

interface ClientHarness {
  readonly service: LinkAccessService
  readonly close: () => Promise<void>
}

async function mount(): Promise<ClientHarness> {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-link-client-'))
  const ctx = new RootContext()
  try {
    const records = new Map<unknown, unknown>()
    ctx.provide('credentials', {
      async modifyRecord(key: unknown, mutate: (current: unknown) => Promise<unknown>): Promise<unknown> {
        const current = records.get(key)
        const next = await mutate(current)
        if (next !== undefined) records.set(key, next)
        return next ?? current
      },
    } as never)
    await ctx.plugin({ inject: [...connectionInject], apply: applyConnection })
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(TypertGatewayService)
    await ctx.plugin(ClientProbeService)
    await ctx.plugin(DeviceTrustStore, { path: ':memory:' })
    await ctx.plugin(LinkAccessService, {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      dshHome,
      endpoints: [
        { endpoint: 'probe/echo', kind: 'unary', minRole: 'observer' },
        { endpoint: 'probe/fail', kind: 'unary', minRole: 'observer' },
        { endpoint: 'probe/ticks', kind: 'stream', minRole: 'observer' },
        { endpoint: 'probe/replay', kind: 'stream', minRole: 'observer' },
        { endpoint: '$events', kind: 'stream', minRole: 'observer' },
        { endpoint: '$events/result', kind: 'unary', minRole: 'controller' },
      ],
    })
    const service = ctx.get('linkAccess') as LinkAccessService
    if (await service.endpoint() === undefined) throw new Error('link client test harness did not bind')
    return {
      service,
      close: async () => {
        await ctx.fiber.dispose()
      },
    }
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}

describe('LinkClient', () => {
  let harness: ClientHarness
  let client: LinkClient
  let pairing: LinkPairingPayload

  beforeAll(async () => {
    harness = await mount()
    pairing = await harness.service.createPairing()
    client = await LinkClient.pair(pairing, { deviceName: 'Reference Phone' })
  }, 60_000)

  afterAll(async () => {
    await client.dispose().catch(() => {})
    await harness.close()
  })

  it('pairs, describes, and calls through the pinned carrier', async () => {
    const description = await client.describe()
    expect(description.linkProtocolVersion).toBe(1)
    expect(description.runtimeClass).toBe('full')
    expect(description.capabilities.session.follow).toBe(true)
    await expect(client.call('probe/echo', { value: 'hi' })).resolves.toBe('echo:hi')
  })

  it('maps carrier and gateway failures to LinkError codes', async () => {
    const forbidden = await client.call('probe/missing', {})
      .catch((error: unknown) => error as LinkError) as LinkError
    expect(forbidden).toBeInstanceOf(LinkError)
    expect(forbidden.code).toBe('forbidden')

    const business = await client.call('probe/fail', {})
      .catch((error: unknown) => error as LinkError) as LinkError
    expect(business).toBeInstanceOf(LinkError)
    expect(business.code).toBe('internal')
    expect(business.message).toContain('probe business failure')

    const revokedPairing = await harness.service.createPairing()
    const revokedClient = await LinkClient.pair(revokedPairing, { deviceName: 'soon-revoked' })
    const devices = await harness.service.trustedDevices()
    const revokedDevice = devices.find(candidate => candidate.name === 'soon-revoked')
    await harness.service.revokeDevice(revokedDevice!.deviceId)
    await expect(revokedClient.describe()).rejects.toMatchObject({ code: 'unauthorized' })
    await revokedClient.dispose()
  })

  it('rejects malformed, expired, and replayed pairing payloads', async () => {
    await expect(LinkClient.pair(
      { ...pairing, v: 2 } as unknown as LinkPairingPayload,
      { deviceName: 'x' },
    )).rejects.toMatchObject({ code: 'pairing-unsupported' })
    await expect(LinkClient.pair(
      { ...pairing, expiresAt: Date.now() - 1 },
      { deviceName: 'x' },
    )).rejects.toMatchObject({ code: 'pairing-expired' })

    const replayed = await harness.service.createPairing()
    const first = await LinkClient.pair(replayed, { deviceName: 'one' })
    await first.dispose()
    await expect(LinkClient.pair(replayed, { deviceName: 'two' }))
      .rejects.toMatchObject({ code: 'pairing-rejected' })
  })

  it('streams NDJSON frames and ends error frames as LinkError', async () => {
    const ticks: unknown[] = []
    for await (const value of client.openStream('probe/ticks', { count: 3 })) {
      ticks.push(value)
    }
    expect(ticks).toEqual(['0', '1', '2'])

    const failure = await client.openStream('$events', { args: {} }).next().then(
      () => { throw new Error('expected the $events stream to fail without a forwarded source') },
      (error: unknown) => error as LinkError,
    )
    expect(failure).toBeInstanceOf(LinkError)
    expect(failure.code).toBe('internal')
  })

  it('resumes a stream after reconnect from its cursor', async () => {
    const abort = new AbortController()
    const first: unknown[] = []
    for await (const value of client.openStream('probe/replay', { after: 0 }, abort.signal)) {
      first.push(value)
      if (first.length === 2) abort.abort()
    }
    expect(first).toEqual(['0', '1'])

    const second: unknown[] = []
    for await (const value of client.openStream('probe/replay', { after: first.length })) {
      second.push(value)
    }
    expect([...first, ...second]).toEqual(['0', '1', '2', '3', '4'])
  })

  it('aborts an in-flight unary request', async () => {
    const abort = new AbortController()
    abort.abort(new LinkError('aborted', 'caller cancelled'))
    await expect(client.call('probe/echo', { value: 'x' }, abort.signal)).rejects.toMatchObject({ code: 'aborted' })
    const plain = AbortSignal.abort('caller cancelled')
    await expect(client.call('probe/echo', { value: 'x' }, plain)).rejects.toMatchObject({ code: 'aborted' })
  })

  it('ends a stream without error when the signal is already aborted', async () => {
    const signal = AbortSignal.abort('caller cancelled')
    const received: unknown[] = []
    for await (const value of client.openStream('probe/ticks', { count: 3 }, signal)) {
      received.push(value)
    }
    expect(received).toEqual([])

    const forbidden = await client.openStream('probe/missing', { args: {} }).next().then(
      () => { throw new Error('expected the forbidden stream to fail') },
      (error: unknown) => error as LinkError,
    )
    expect(forbidden).toBeInstanceOf(LinkError)
    expect(forbidden.code).toBe('forbidden')
  })

  it('refuses calls after dispose', async () => {
    const pairing2 = await harness.service.createPairing()
    const client2 = await LinkClient.pair(pairing2, { deviceName: 'short-lived' })
    await client2.dispose()
    await expect(client2.describe()).rejects.toMatchObject({ code: 'disposed' })
  })

  it('refuses a carrier whose certificate does not match the pin', async () => {
    const other = await mount()
    try {
      const otherPairing = await other.service.createPairing()
      const pinned = new LinkClient({
        endpoint: (await other.service.endpoint())!,
        spkiFingerprint: pairing.spkiFingerprint,
        deviceId: 'irrelevant-before-pin',
        deviceKey: (await import('node:crypto')).generateKeyPairSync('ed25519').privateKey,
      })
      await expect(pinned.describe()).rejects.toThrow(/fingerprint/u)
      const streamFailure = await pinned.openStream('probe/ticks', { count: 1 }).next().then(
        () => { throw new Error('expected the pinned stream to fail') },
        (error: unknown) => error,
      )
      expect(streamFailure).toBeInstanceOf(Error)
      await pinned.dispose()
      void otherPairing
    } finally {
      await other.close()
    }
  }, 60_000)

  it('surfaces a carrier teardown mid-stream as an error, not silence', async () => {
    const torn = await mount()
    const tornPairing = await torn.service.createPairing()
    const tornClient = await LinkClient.pair(tornPairing, { deviceName: 'teardown witness' })
    const collected: unknown[] = []
    const stream = tornClient.openStream('probe/ticks', { count: 100 })
    const iteration = (async () => {
      for await (const value of stream) {
        collected.push(value)
      }
    })()
    await delay(30)
    await torn.close()
    const failure = await iteration.then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    await tornClient.dispose().catch(() => {})
    expect(collected.length).toBeGreaterThan(0)
  }, 60_000)
})
