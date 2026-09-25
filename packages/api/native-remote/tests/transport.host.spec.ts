import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { createHash, generateKeyPairSync, randomUUID, sign, X509Certificate } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { request, type IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, type TLSSocket } from 'node:tls'
import { once } from 'node:events'
import WebSocket from 'ws'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import DeviceTrust, { DeviceId } from '@deepseek-ai/dsh-api-device-trust'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import Typert from '@deepseek-ai/dsh-typert-registry'
import { bindTypertRemote, Remote } from '@deepseek-ai/dsh-typert-protocol'
import NativeRemote, { type Config, type NativeRemoteInfo } from '../src/index.ts'

const cleanup: Array<() => Promise<void>> = []
const config: Config = {
  host: '127.0.0.1', port: 0, maxConnections: 8,
  maxRequestBodyBytes: 65_536, maxWebSocketMessageBytes: 4096, maxStreamsPerConnection: 2,
  requestTimeoutMs: 5000, headersTimeoutMs: 3000, handshakeTimeoutMs: 5000, websocketHeartbeatIntervalMs: 100,
  certificateLifetimeDays: 7, certificateRenewBeforeDays: 1,
}

class FixtureService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'nativeFixture', {
    namespace: 'fixture', capabilities: [
      { id: 'fixture.read.v1', methods: ['read'], requiredPermission: 'view' },
      { id: 'fixture.admin.v1', methods: ['admin'], requiredPermission: 'device.admin' },
    ],
  })

  constructor(ctx: Context) { super(ctx, 'nativeFixture') }

  @Remote
  read(): string { return 'native-read' }

  @Remote
  admin(): string { return 'native-admin' }
}

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function bootNative(overrides: Partial<Config> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'native-remote-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(LocalCredentialProvider, { path: join(root, 'credentials.yaml'), watch: false })
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(DeviceTrust)
  await ctx.plugin(Typert)
  await ctx.plugin(Gateway)
  await ctx.plugin(FixtureService)
  const fiber = ctx.plugin(NativeRemote, { ...config, ...overrides })
  await fiber
  return { ctx, fiber, info: ctx.nativeRemote.describe() }
}

/** The request owner receives a socket only after the certificate pin matches. */
async function pinnedSocket(info: NativeRemoteInfo): Promise<TLSSocket> {
  const socket = connect({ host: '127.0.0.1', port: info.port, rejectUnauthorized: false, minVersion: 'TLSv1.2' })
  cleanup.push(async () => { socket.destroy(); if (!socket.closed) await once(socket, 'close') })
  await once(socket, 'secureConnect')
  const cert = new X509Certificate(socket.getPeerCertificate().raw)
  const pin = createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
  if (pin !== info.spkiFingerprint) {
    socket.destroy()
    throw new Error('native pin mismatch')
  }
  return socket
}

async function post(info: NativeRemoteInfo, endpoint: string, payload: unknown, headers: Record<string, string> = {}) {
  const socket = await pinnedSocket(info)
  const body = JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload })
  // node:http supplies HTTP framing over the already authenticated TLS socket.
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: info.port, path: `/api/${endpoint}`, method: 'POST',
      createConnection: () => socket,
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), connection: 'close', ...headers },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('error', reject)
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }) })
    })
    req.on('error', reject)
    req.end(body)
  })
}

async function paired(ctx: Context, info: NativeRemoteInfo) {
  const keys = generateKeyPairSync('ed25519')
  const issuance = ctx.deviceTrust.issuePairing('viewer')
  const response = await post(info, 'deviceTrust/redeemPairing', { apiProtocolVersion: 2, args: { request: {
    code: issuance.code, deviceName: 'native-test', devicePublicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  } } })
  expect(response.status).toBe(200)
  const result = JSON.parse(response.body) as { result: { ok: boolean; value: { deviceId: string } } }
  expect(result.result.ok).toBe(true)
  const deviceId = DeviceId(result.result.value.deviceId)
  const admission = () => {
    const timestamp = Date.now()
    const nonce = randomUUID()
    return { deviceId, timestamp, nonce,
      signature: sign(null, Buffer.from(`${deviceId}\n${timestamp}\n${nonce}`), keys.privateKey).toString('base64'),
    }
  }
  return { deviceId, admission }
}

describe('native encrypted Connection source', () => {
  it.each([
    [{ headersTimeoutMs: 6000 }, 'headersTimeoutMs must not exceed requestTimeoutMs'],
    [{ certificateRenewBeforeDays: 7 }, 'certificateRenewBeforeDays must be shorter than certificateLifetimeDays'],
  ] as const)('rejects inconsistent deployment bounds %j', async (overrides, message) => {
    await expect(bootNative(overrides)).rejects.toThrow(message)
  })

  it('rejects an occupied listen port without replacing the existing listener', async () => {
    const first = await bootNative()
    await expect(bootNative({ port: first.info.port })).rejects.toMatchObject({ code: 'EADDRINUSE' })
    expect((await post(first.info, 'fixture/read', { args: {} })).status).toBe(200)
  })

  it('admits pairing and signed RPC while rejecting cookies, missing identity, replay, and insufficient roles', async () => {
    const { ctx, info } = await bootNative()
    const denied = await post(info, 'fixture/read', { apiProtocolVersion: 2, args: {} }, { cookie: 'dsh-browser-session=irrelevant' })
    expect(JSON.parse(denied.body)).toMatchObject({ result: { ok: false, error: { code: 'gateway/permission-denied' } } })
    const device = await paired(ctx, info)
    const payload = { apiProtocolVersion: 2, args: {}, device: device.admission() }
    expect(JSON.parse((await post(info, 'fixture/read', payload)).body)).toMatchObject({ result: { ok: true, value: 'native-read' } })
    expect(JSON.parse((await post(info, 'fixture/read', payload)).body)).toMatchObject({ result: { ok: false, error: { code: 'device/replay-detected' } } })
    expect(JSON.parse((await post(info, 'fixture/admin', { ...payload, device: device.admission() })).body))
      .toMatchObject({ result: { ok: false, error: { code: 'gateway/permission-denied' } } })
    await ctx.deviceTrust.revokeDevice({ deviceId: device.deviceId })
    expect(JSON.parse((await post(info, 'fixture/read', { ...payload, device: device.admission() })).body))
      .toMatchObject({ result: { ok: false, error: { code: 'device/already-revoked' } } })
  })

  it('rejects the wrong certificate pin before any RPC can redeem a code', async () => {
    const { ctx, info } = await bootNative()
    await expect(paired(ctx, { ...info, spkiFingerprint: '0'.repeat(64) })).rejects.toThrow('native pin mismatch')
    expect(ctx.deviceTrust.listDevices()).toHaveLength(0)
  })

  it('rejects browser origin and fetch metadata independently of device authorization', async () => {
    const { ctx, info } = await bootNative()
    const device = await paired(ctx, info)
    const browserHeaders: Record<string, string>[] = [{ origin: 'https://example.invalid' }, { 'sec-fetch-site': 'none' }]
    for (const headers of browserHeaders) {
      const response = await post(info, 'fixture/read', { apiProtocolVersion: 2, args: {}, device: device.admission() }, headers)
      expect(response.status).toBe(403)
    }
  })

  it('enforces the HTTP body bound before Gateway dispatch', async () => {
    const { ctx, info } = await bootNative({ maxRequestBodyBytes: 32 })
    const response = await post(info, 'deviceTrust/redeemPairing', { args: { large: 'x'.repeat(100) } })
    expect(response.status).toBe(413)
    expect(ctx.deviceTrust.listDevices()).toHaveLength(0)
  })

  it('drains an interrupted request body during listener disposal', async () => {
    const { info, fiber } = await bootNative()
    const socket = await pinnedSocket(info)
    const continued = once(socket, 'data')
    socket.write('POST /api/fixture/read HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1024\r\nExpect: 100-continue\r\n\r\n')
    expect(String((await continued)[0])).toContain('100 Continue')
    socket.destroy()
    await fiber.dispose()
  })

  it.each(['origin', 'path'] as const)('refuses an invalid native WebSocket upgrade %s', async (kind) => {
    const { info } = await bootNative()
    const socket = await pinnedSocket(info)
    const path = kind === 'path' ? '/api/not-a-mux' : '/api/remote.mux'
    const ws = new WebSocket(`wss://127.0.0.1:${info.port}${path}`, {
      createConnection: () => socket,
      ...(kind === 'origin' ? { origin: 'https://example.invalid' } : {}),
    })
    // A refused upgrade can emit a client-side abort error while teardown closes it.
    ws.on('error', () => {})
    cleanup.push(async () => {
      if (ws.readyState === WebSocket.CLOSED) return
      const closed = new Promise<void>((resolve) => { ws.once('close', () => { resolve() }) })
      ws.terminate()
      await closed
    })
    const response = (await once(ws, 'unexpected-response'))[1] as IncomingMessage
    expect(response.statusCode).toBe(403)
    response.resume()
  })

  it('uses the shared mux with mandatory device stream admission and drains its sockets on disposal', async () => {
    const { ctx, info, fiber } = await bootNative()
    const socket = await pinnedSocket(info)
    const ws = new WebSocket(`wss://127.0.0.1:${info.port}/api/remote.mux`, { createConnection: () => socket })
    cleanup.push(async () => { ws.terminate(); if (ws.readyState !== WebSocket.CLOSED) await once(ws, 'close') })
    await once(ws, 'open')
    const message = once(ws, 'message')
    ws.send(JSON.stringify({ type: 'open', streamId: 'unsigned', endpoint: '$events', payload: { apiProtocolVersion: 2, args: {} } }))
    expect(JSON.parse(String((await message)[0]))).toMatchObject({ type: 'error', streamId: 'unsigned', error: { code: 'gateway/permission-denied' } })
    const closed = once(ws, 'close')
    const service = ctx.nativeRemote
    await fiber.dispose()
    await closed
    expect(() => service.describe()).toThrow('listener is not ready')
    await expect(pinnedSocket(info)).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })
})
