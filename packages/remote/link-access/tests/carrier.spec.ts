import { connect as tcpConnect } from 'node:net'
import { createHash, createPublicKey, generateKeyPairSync, sign as edSign } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpsRequest } from 'node:https'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context as RootContext } from '@deepseek-ai/cordis'
import { apply as applyConnection, inject as connectionInject } from '@deepseek-ai/dsh-client-connection'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import DeviceTrustStore from '@deepseek-ai/dsh-device-trust'
import LinkAccessService from '../src/index.ts'
import { linkSigningInput } from '../src/protocol.ts'
import {
  PROBE_ENDPOINTS,
  carrierRequest,
  issueSigned,
  mountCarrier,
  mountComposition,
  pairDevice,
  provideCredentials,
  signedRpc,
  type CarrierHarness,
  type TestDevice,
} from './link-harness.ts'

/** Pair one device directly through the trust store under an explicit role. */
async function pairWithRole(harness: CarrierHarness, role: 'observer' | 'controller'): Promise<TestDevice> {
  const pairing = await harness.service.createPairing()
  const store = harness.ctx.get('deviceTrust') as DeviceTrustStore
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const device = await store.consumePairing(
    pairing.code,
    { name: `direct-${role}`, publicKeySpki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') },
    role,
  )
  return { deviceId: device.deviceId, privateKey }
}

describe('link-access carrier', () => {
  let harness: CarrierHarness
  let device: TestDevice

  beforeAll(async () => {
    harness = await mountCarrier()
    device = await pairDevice(harness, 'iPhone')
  }, 60_000)

  afterAll(async () => {
    await harness.close()
  })

  it('pairs a device once and refuses code replay and malformed pairing', async () => {
    const oneTime = await harness.service.createPairing()
    const body = JSON.stringify({
      code: oneTime.code,
      deviceName: 'Other',
      devicePublicKey: createPublicKey(device.privateKey).export({ type: 'spki', format: 'der' }).toString('base64'),
    })
    expect((await carrierRequest(harness.endpoint, '/link/pair', { method: 'POST', body })).status).toBe(200)
    const replay = await carrierRequest(harness.endpoint, '/link/pair', { method: 'POST', body })
    expect(replay.status).toBe(403)
    expect(replay.json).toMatchObject({ error: 'pairing-rejected' })

    expect((await carrierRequest(harness.endpoint, '/link/pair', { method: 'GET' })).status).toBe(405)
    expect((await carrierRequest(harness.endpoint, '/link/pair', { method: 'POST', body: 'not json' })).status).toBe(400)
    expect((await carrierRequest(harness.endpoint, '/link/pair', { method: 'POST', body: '{"code":1}' })).status).toBe(400)
    const { publicKey } = generateKeyPairSync('ed25519')
    expect((await carrierRequest(harness.endpoint, '/link/pair', {
      method: 'POST',
      body: JSON.stringify({
        code: 'unknown-code',
        deviceName: 'x',
        devicePublicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      }),
    })).status).toBe(403)
    expect((await carrierRequest(harness.endpoint, '/link/pair', {
      method: 'POST',
      body: JSON.stringify({ code: 'still-unknown', deviceName: 'x', devicePublicKey: 'bm90LWRlcg==' }),
    })).status).toBe(400)
  })

  it('serves an oversized pairing body a 413', async () => {
    const response = await carrierRequest(harness.endpoint, '/link/pair', {
      method: 'POST',
      body: 'x'.repeat(70 * 1024),
    })
    expect(response.status).toBe(413)
  })

  it('describes the host to an authenticated device', async () => {
    const response = await issueSigned(harness.endpoint, device, '/link/describe', 'POST', '')
    expect(response.status).toBe(200)
    expect(response.json).toMatchObject({
      linkProtocolVersion: 1,
      runtimeClass: 'full',
      hostVersion: expect.any(String) as string,
      hostId: expect.any(String) as string,
      hostName: expect.any(String) as string,
      capabilities: { interaction: { approval: false } },
    })
    expect((await carrierRequest(harness.endpoint, '/link/describe', { method: 'GET' })).status).toBe(405)
    expect((await carrierRequest(harness.endpoint, '/link/describe', { method: 'POST', body: '' })).status).toBe(401)
    expect((await issueSigned(harness.endpoint, device, '/link/describe', 'POST', 'z'.repeat(70 * 1024))).status).toBe(413)
  })

  it('dispatches an allowlisted unary RPC through the existing gateway chain', async () => {
    const response = await signedRpc(harness.endpoint, device, 'probe/echo', { value: 'hi' })
    expect(response.status).toBe(200)
    expect(response.json).toEqual({
      type: 'server-response',
      rpcId: 'rpc-probe/echo',
      result: { ok: true, value: 'echo:hi' },
    })
  })

  it('refuses unauthenticated, unknown, stale, mis-signed, and revoked devices', async () => {
    expect((await carrierRequest(harness.endpoint, '/api/probe/echo', { method: 'POST', body: '{}' })).status).toBe(401)
    expect((await issueSigned(harness.endpoint, device, '/api/probe/echo', 'POST', '{}', {
      headers: { 'x-dsh-device-id': 'no-such-device', 'x-dsh-timestamp': String(Date.now()), 'x-dsh-signature': 'AA' },
    })).status).toBe(401)
    expect((await issueSigned(harness.endpoint, device, '/api/probe/echo', 'POST', '{}', {
      timestamp: Date.now() - 10 * 60_000,
    })).status).toBe(401)
    expect((await issueSigned(harness.endpoint, device, '/api/probe/echo', 'POST', '{}', {
      headers: { 'x-dsh-device-id': device.deviceId, 'x-dsh-timestamp': String(Date.now()), 'x-dsh-signature': Buffer.from('not-a-signature').toString('base64') },
    })).status).toBe(401)
    expect((await issueSigned(harness.endpoint, device, '/api/probe/echo', 'POST', '{}', {
      headers: { 'x-dsh-device-id': device.deviceId },
    })).status).toBe(401)

    const revoked = await pairDevice(harness, 'ToRevoke')
    const record = (await harness.service.trustedDevices()).find(candidate => candidate.deviceId === revoked.deviceId)
    await harness.service.revokeDevice(record!.deviceId)
    expect((await signedRpc(harness.endpoint, revoked, 'probe/echo', { value: 'x' })).status).toBe(401)
  })

  it('records last-seen for an active device at most once per interval', async () => {
    await signedRpc(harness.endpoint, device, 'probe/echo', { value: 'one' })
    await signedRpc(harness.endpoint, device, 'probe/echo', { value: 'two' })
    const record = (await harness.service.trustedDevices()).find(candidate => candidate.deviceId === device.deviceId)
    expect(record?.lastSeenAt).toEqual(expect.any(Number) as number)
  })

  it('enforces the allowlist and the invocation kind', async () => {
    expect((await signedRpc(harness.endpoint, device, 'probe/missing', {})).status).toBe(403)
    expect((await signedRpc(harness.endpoint, device, 'probe/ticks', { count: 1 })).status).toBe(403)
    expect((await carrierRequest(harness.endpoint, '/link/nothing', { method: 'POST' })).status).toBe(404)
    expect((await issueSigned(harness.endpoint, device, '/link/stream/', 'POST', '{}')).status).toBe(404)
    expect((await issueSigned(harness.endpoint, device, '/api/probe/echo', 'GET', '')).status).toBe(404)
    expect((await issueSigned(harness.endpoint, device, '/api/probe/echo', 'HEAD', '')).status).toBe(404)
    expect((await issueSigned(harness.endpoint, device, '/api/probe/echo', 'POST', '')).status).toBe(415)
  })

  it('enforces device roles beyond the allowlist', async () => {
    const observer = await pairWithRole(harness, 'observer')
    expect((await signedRpc(harness.endpoint, observer, 'probe/echo', { value: 'ok' })).status).toBe(200)
    const refused = await signedRpc(harness.endpoint, observer, 'probe/admin', { value: 'no' })
    expect(refused.status).toBe(403)
    expect(refused.json).toMatchObject({ error: 'forbidden', reason: 'role' })
    expect((await signedRpc(harness.endpoint, device, 'probe/admin', { value: 'yes' })).status).toBe(200)
  })

  it('serves an oversized unary body a 413 whether declared or streamed', async () => {
    const declared = await issueSigned(harness.endpoint, device, '/api/probe/echo', 'POST', '{}', {
      headers: {
        'x-dsh-device-id': device.deviceId,
        'x-dsh-timestamp': String(Date.now()),
        'x-dsh-signature': 'AA',
        'content-type': 'application/json',
        'content-length': '9999999',
      },
    })
    expect(declared.status).toBe(413)
    const streamed = await issueSigned(harness.endpoint, device, '/api/probe/echo', 'POST', 'y'.repeat(5000))
    expect(streamed.status).toBe(413)
  })

  it('carries one Remote stream as signed NDJSON frames', async () => {
    const frames = await streamUntil(harness, device, 'probe/ticks', { args: { count: 3 } }, lines => lines.length >= 3)
    expect(frames).toEqual(['{"k":"v","v":"0"}', '{"k":"v","v":"1"}', '{"k":"v","v":"2"}'])
    expect((await issueSigned(harness.endpoint, device, '/link/stream/probe/ticks', 'GET', '')).status).toBe(405)
    expect((await issueSigned(harness.endpoint, device, '/link/stream/probe/echo', 'POST', '{"args":{"value":"x"}}')).status).toBe(403)
    expect((await issueSigned(harness.endpoint, device, '/link/stream/probe/ticks', 'POST', 'not json')).status).toBe(400)
    expect((await carrierRequest(harness.endpoint, '/link/stream/probe/ticks', {
      method: 'POST',
      body: '{"args":{}}',
    })).status).toBe(401)
    expect((await issueSigned(harness.endpoint, device, '/link/stream/probe/ticks', 'POST', 'y'.repeat(70 * 1024))).status).toBe(413)
  })

  it('serves a typed failure frame when the stream source throws', async () => {
    const frames = await streamUntil(
      harness, device, 'probe/boom', { args: {} },
      lines => lines.some(line => line.includes('"k":"e"')),
    )
    const failure = frames.find(line => line.includes('"k":"e"'))
    expect(failure).toContain('probe stream failure')
  })

  it('skips the failure frame when the stream client vanishes first', async () => {
    const url = new URL(harness.endpoint)
    const target = '/link/stream/probe/linger'
    const body = JSON.stringify({ args: {} })
    const timestamp = String(Date.now())
    const digest = createHash('sha256').update(body).digest('hex')
    const signature = edSign(null, Buffer.from(linkSigningInput(timestamp, 'POST', target, digest)), device.privateKey).toString('base64')
    const lines: string[] = []
    await new Promise<void>((resolve) => {
      const request = httpsRequest({
        host: url.hostname,
        port: url.port,
        path: target,
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'x-dsh-device-id': device.deviceId,
          'x-dsh-timestamp': timestamp,
          'x-dsh-signature': signature,
          'content-type': 'application/json',
        },
      }, (response) => {
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          for (const line of chunk.split('\n')) {
            if (line !== '') lines.push(line)
          }
          if (lines.length >= 1) {
            request.destroy()
            resolve()
          }
        })
      })
      request.on('error', () => {})
      request.write(body)
      request.end()
    })
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(lines).toEqual(['{"k":"v","v":"open"}'])
  })

  it('stops a stream promptly when its client vanishes mid-flight', async () => {
    const probe = harness.ctx.get('probe') as unknown as { calls: readonly string[] }
    await streamUntil(harness, device, 'probe/ticks', { args: { count: 10_000 } }, lines => lines.length >= 2)
    // The abort must freeze the server-side iteration well short of the full
    // 10 000 items; poll until the count is stable instead of sleeping fixed
    // windows, then require it to have stopped early.
    let stable = -1
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = probe.calls.length
      if (current === stable) break
      stable = current
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(stable).toBeGreaterThanOrEqual(2)
    expect(stable).toBeLessThan(5_000)
  })

  it('aborts an in-flight unary RPC when its client vanishes', async () => {
    const probe = harness.ctx.get('probe') as unknown as { calls: readonly string[] }
    const url = new URL(harness.endpoint)
    const path = '/api/probe/slow'
    const body = JSON.stringify({
      type: 'client-request',
      rpcId: 'rpc-slow',
      method: 'probe/slow',
      payload: { args: {} },
    })
    const timestamp = String(Date.now())
    const digest = createHash('sha256').update(body).digest('hex')
    const signature = edSign(null, Buffer.from(linkSigningInput(timestamp, 'POST', path, digest)), device.privateKey).toString('base64')
    await new Promise<void>((resolve) => {
      const request = httpsRequest({
        host: url.hostname,
        port: url.port,
        path,
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'x-dsh-device-id': device.deviceId,
          'x-dsh-timestamp': timestamp,
          'x-dsh-signature': signature,
          'content-type': 'application/json',
        },
      }, () => {})
      request.on('error', () => {})
      request.on('close', () => { resolve() })
      request.write(body)
      request.end()
      setTimeout(() => { request.destroy() }, 30)
    })
    for (let attempt = 0; attempt < 50 && !probe.calls.includes('slow:aborted'); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 40))
    }
    expect(probe.calls).toContain('slow:aborted')
  })

  it('streams a large unary response with socket backpressure', async () => {
    const roomy = await mountCarrier({ maxRequestBodyBytes: 8 * 1024 * 1024 })
    try {
      const roomyDevice = await pairDevice(roomy, 'big-response')
      const big = 'z'.repeat(4 * 1024 * 1024)
      const response = await signedRpc(roomy.endpoint, roomyDevice, 'probe/echo', { value: big })
      expect(response.status).toBe(200)
      const envelope = response.json as { result: { ok: boolean; value?: string } }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value).toBe(`echo:${big}`)
    } finally {
      await roomy.close()
    }
  }, 60_000)

  it('rejects remote interaction answers while the approval switch is off', async () => {
    const response = await signedRpc(harness.endpoint, device, '$events/result', {
      clientId: 'c', eventId: 'e', outcome: { kind: 'next' },
    })
    expect(response.status).toBe(403)
    expect(response.json).toMatchObject({ error: 'forbidden', reason: 'approval-disabled' })
  })

  it('destroys TLS handshakes that never complete cleanly', async () => {
    const url = new URL(harness.endpoint)
    const outcome = new Promise<void>((resolve, reject) => {
      const socket = tcpConnect(Number(url.port), url.hostname)
      socket.on('connect', () => { socket.destroy(); resolve() })
      socket.on('error', reject)
      socket.end('not a tls handshake\r\n\r\n')
    })
    await expect(outcome).resolves.toBeUndefined()
  })
})

describe('link-access carrier with remote approval enabled', () => {
  let harness: CarrierHarness

  beforeAll(async () => {
    harness = await mountCarrier({
      allowRemoteApproval: true,
      pairingRole: 'observer',
      pairingTtlSeconds: 60,
      clockSkewSeconds: 60,
      maxRequestBodyBytes: 8192,
    })
  }, 60_000)

  afterAll(async () => {
    await harness.close()
  })

  it('delivers the forwarded event stream and gates answers by role behind the switch', async () => {
    const gateway = harness.ctx.get('typertGateway') as TypertGatewayService
    const unregister = gateway.registerRemoteEvents(
      (signal: AbortSignal) => (async function* () {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
      })(),
      { home: '/home/fixture' },
    )
    const observer = await pairDevice(harness, 'iPhone-observer')
    const controller = await pairWithRole(harness, 'controller')

    const events = await openEventsStream(harness, observer)
    try {
      const refused = await signedRpc(harness.endpoint, observer, '$events/result', {
        clientId: events.clientId, eventId: 'missing', outcome: { kind: 'next' },
      })
      expect(refused.status).toBe(403)
      expect(refused.json).toMatchObject({ error: 'forbidden', reason: 'role' })

      const answered = await signedRpc(harness.endpoint, controller, '$events/result', {
        clientId: events.clientId, eventId: 'missing', outcome: { kind: 'next' },
      })
      expect(answered.status).toBe(200)
      expect(answered.json).toMatchObject({ type: 'server-response', result: { ok: true } })
    } finally {
      events.close()
    }
    await unregister()
  })
})

describe('link-access carrier lifecycle', () => {
  it('stays disabled by default and refuses pairing', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-link-disabled-'))
    const ctx = new RootContext()
    try {
      provideCredentials(ctx)
      await ctx.plugin({ inject: [...connectionInject], apply: applyConnection })
      await ctx.plugin(TypertRegistry)
      await ctx.plugin(TypertGatewayService)
      await ctx.plugin(DeviceTrustStore, { path: ':memory:' })
      await ctx.plugin(LinkAccessService, { dshHome })
      const service = ctx.get('linkAccess') as LinkAccessService
      await expect(service.endpoint()).resolves.toBeUndefined()
      await expect(service.spkiFingerprint()).resolves.toBeUndefined()
      await expect(service.createPairing()).rejects.toThrow(/carrier is disabled/u)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('refuses a duplicated allowlist row and a taken port', async () => {
    await expect(mountCarrier({ endpoints: [...PROBE_ENDPOINTS, PROBE_ENDPOINTS[0]!] }))
      .rejects.toThrow(/appears twice/u)

    const taken = await mountCarrier()
    const port = Number(new URL(taken.endpoint).port)
    try {
      await expect(mountCarrier({ port })).rejects.toThrow(/EADDRINUSE|listen/u)
    } finally {
      await taken.close()
    }
  })

  it('reuses its certificate across mounts sharing one harness home', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-link-reuse-'))
    const first = await mountCarrier({ dshHome })
    const second = await mountCarrier({ dshHome })
    try {
      const fingerprint = await first.service.spkiFingerprint()
      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/u)
      await expect(second.service.spkiFingerprint()).resolves.toBe(fingerprint)
      await expect(first.service.endpoint()).resolves.not.toBe(await second.service.endpoint())
    } finally {
      await first.close()
      await second.close()
    }
  }, 60_000)

  it('restarts on demand and rebinds a fresh endpoint', async () => {
    const harness = await mountComposition({ enabled: false })
    try {
      await expect(harness.service.endpoint()).resolves.toBeUndefined()
      await harness.service.setCarrierEnabled(true)
      const first = await harness.service.carrierStatus()
      expect(first.listening).toBe(true)
      expect(first.endpoint).toMatch(/^https:\/\//u)
      expect(first.spkiFingerprint).toMatch(/^[0-9a-f]{64}$/u)
      expect(first.bindError).toBeUndefined()
      const firstEndpoint = first.endpoint

      await harness.service.setCarrierEnabled(false)
      await expect(harness.service.carrierStatus()).resolves.toEqual({ listening: false })
      await expect(harness.service.endpoint()).resolves.toBeUndefined()
      await harness.service.setCarrierEnabled(true)
      const second = await harness.service.carrierStatus()
      expect(second.listening).toBe(true)
      expect(second.endpoint).not.toBe(firstEndpoint)
    } finally {
      await harness.close()
    }
  }, 60_000)

  it('serializes rapid toggles without double-binding', async () => {
    const harness = await mountComposition({ enabled: false })
    try {
      const off = harness.service.setCarrierEnabled(false)
      const on = harness.service.setCarrierEnabled(true)
      await Promise.all([off, on])
      const status = await harness.service.carrierStatus()
      expect(status.listening).toBe(true)
    } finally {
      await harness.close()
    }
  }, 60_000)

  it('stops a constructor-started bind while it is still pending', async () => {
    const blocker = await mountCarrier()
    const port = Number(new URL(blocker.endpoint).port)
    const harness = await mountComposition({ enabled: true, port })
    try {
      await harness.service.setCarrierEnabled(false)
      const status = await harness.service.carrierStatus()
      expect(status.listening).toBe(false)
      expect(status.bindError).toMatch(/EADDRINUSE|listen/u)
    } finally {
      await harness.close()
      await blocker.close()
    }
  }, 60_000)

  it('reports a failed bind in status and recovers once the port frees', async () => {
    const blocker = await mountCarrier()
    const port = Number(new URL(blocker.endpoint).port)
    const harness = await mountComposition({ enabled: false, port })
    try {
      const enabling = harness.service.setCarrierEnabled(true).catch(() => undefined)
      const concurrent = harness.service.carrierStatus()
      await enabling
      await expect(concurrent).resolves.toMatchObject({ listening: false })
      const failed = await harness.service.carrierStatus()
      expect(failed.listening).toBe(false)
      expect(failed.bindError).toMatch(/EADDRINUSE|listen/u)
      await expect(harness.service.createPairing()).rejects.toThrow(/failed to bind/u)

      await blocker.close()
      await harness.service.setCarrierEnabled(true)
      const recovered = await harness.service.carrierStatus()
      expect(recovered.listening).toBe(true)
      expect(recovered.bindError).toBeUndefined()
    } finally {
      await harness.close()
    }
  }, 60_000)

  it('applies the live name and approval switches to the wire', async () => {
    const harness = await mountCarrier()
    try {
      const device = await pairDevice(harness, 'switch-probe')
      harness.service.setDeviceName('Studio Desk')
      harness.service.setAllowRemoteApproval(true)
      expect(harness.service.deviceName()).toBe('Studio Desk')
      expect(harness.service.isRemoteApprovalAllowed()).toBe(true)

      const pairing = await harness.service.createPairing()
      expect(pairing.hostName).toBe('Studio Desk')

      const described = await issueSigned(harness.endpoint, device, '/link/describe', 'POST', '')
      expect(described.status).toBe(200)
      expect(described.json).toMatchObject({ hostName: 'Studio Desk', allowRemoteApproval: true })
    } finally {
      await harness.close()
    }
  }, 60_000)
})

/**
 * Open one signed `$events` stream and keep it alive until closed, so its
 * Client generation can answer interactions.
 * @param harness - mounted carrier harness.
 * @param device - paired device credentials.
 * @returns the bound Client id and a close handle.
 */
function openEventsStream(harness: CarrierHarness, device: TestDevice): Promise<{ readonly clientId: string; close(): void }> {
  const target = '/link/stream/%24events'
  const body = JSON.stringify({ args: {} })
  const timestamp = String(Date.now())
  const digest = createHash('sha256').update(body).digest('hex')
  const signature = edSign(
    null,
    Buffer.from(linkSigningInput(timestamp, 'POST', target, digest)),
    device.privateKey,
  ).toString('base64')
  return new Promise((resolve, reject) => {
    const url = new URL(harness.endpoint)
    const request = httpsRequest({
      host: url.hostname,
      port: url.port,
      path: target,
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'x-dsh-device-id': device.deviceId,
        'x-dsh-timestamp': timestamp,
        'x-dsh-signature': signature,
        'content-type': 'application/json',
      },
    }, (response) => {
      let buffer = ''
      response.on('data', (chunk) => {
        buffer += (chunk as Buffer).toString('utf8')
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        const frame = JSON.parse(buffer.slice(0, newline)) as {
          readonly k: string
          readonly v?: { readonly type: string; readonly clientId?: string }
        }
        buffer = buffer.slice(newline + 1)
        if (frame.v?.type === 'ready' && frame.v.clientId !== undefined) {
          resolve({
            clientId: frame.v.clientId,
            close: () => { request.destroy() },
          })
        }
      })
      response.on('error', (error) => { reject(error) })
    })
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

/**
 * Open one signed NDJSON stream and resolve once its collected lines satisfy
 * the predicate or the stream ends.
 * @param harness - mounted carrier harness.
 * @param device - paired device credentials.
 * @param endpointName - Gateway Remote stream endpoint.
 * @param payload - decoded stream payload.
 * @param until - stop predicate over the collected lines.
 * @returns every line collected when the predicate held.
 */
function streamUntil(
  harness: CarrierHarness,
  device: TestDevice,
  endpointName: string,
  payload: unknown,
  until: (lines: string[]) => boolean,
): Promise<string[]> {
  const target = `/link/stream/${encodeURIComponent(endpointName)}`
  const body = JSON.stringify(payload)
  const timestamp = String(Date.now())
  const digest = createHash('sha256').update(body).digest('hex')
  const signature = edSign(
    null,
    Buffer.from(linkSigningInput(timestamp, 'POST', target, digest)),
    device.privateKey,
  ).toString('base64')
  return new Promise((resolve, reject) => {
    const url = new URL(harness.endpoint)
    const request = httpsRequest({
      host: url.hostname,
      port: url.port,
      path: target,
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'x-dsh-device-id': device.deviceId,
        'x-dsh-timestamp': timestamp,
        'x-dsh-signature': signature,
        'content-type': 'application/json',
      },
    }, (response) => {
      const lines: string[] = []
      let buffer = ''
      response.on('data', (chunk) => {
        buffer += (chunk as Buffer).toString('utf8')
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          lines.push(buffer.slice(0, newline))
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
        }
        if (until(lines)) {
          request.destroy()
          resolve(lines)
        }
      })
      response.on('end', () => { resolve(lines) })
      /* v8 ignore next -- the destroy after the predicate races socket teardown; both paths resolve. */
      response.on('error', () => { resolve(lines) })
    })
    request.on('error', (error) => {
      if (!request.destroyed) reject(error)
    })
    request.write(body)
    request.end()
  })
}
