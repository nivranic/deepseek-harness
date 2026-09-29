/** Native listeners share the normal Host Gateway while retaining their own Cordis service scopes. */
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { Context, Service, type Fiber } from '@deepseek-ai/cordis'
import { DeviceId, type DeviceRole } from '@deepseek-ai/dsh-api-device-trust'
import NativeRemote, { type Config } from '@deepseek-ai/dsh-api-native-remote'
import { bindTypertRemote, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { FileUploadValue } from '@deepseek-ai/dsh-client-file-upload'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-attachment'
import { expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import { NativeTestClient } from './native-remote-support.ts'
import { launchWebScaffold } from './scaffold.ts'

const config: Config = {
  host: '127.0.0.1', port: 0, maxConnections: 8,
  maxRequestBodyBytes: 65_536, maxWebSocketMessageBytes: 4096, maxStreamsPerConnection: 2,
  requestTimeoutMs: 5000, headersTimeoutMs: 3000, handshakeTimeoutMs: 5000,
  websocketHeartbeatIntervalMs: 1000, certificateLifetimeDays: 7, certificateRenewBeforeDays: 1,
}

class ScopeProbe extends Service {
  readonly typertRemote = bindTypertRemote(this, 'nativeScopeProbe', {
    capabilities: [{ id: 'native-scope-probe.follow.v1', methods: ['follow'], requiredPermission: 'view' }],
  })

  readonly finished: string[] = []

  constructor(ctx: Context, private readonly owner: string) { super(ctx, 'nativeScopeProbe') }

  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<string> {
    try {
      yield this.owner
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    } finally {
      this.finished.push(this.owner)
    }
  }
}

async function rpc(client: NativeTestClient, endpoint: string, payload: unknown): Promise<unknown> {
  const response = await client.post(`/api/${endpoint}`, JSON.stringify({
    type: 'client-request', rpcId: randomUUID(), method: endpoint, payload,
  }))
  expect(response.status).toBe(200)
  return response.json()
}

function nextMessage(socket: WebSocket) {
  return once(socket, 'message', { signal: AbortSignal.timeout(10_000) })
}

async function pair(ctx: Context, client: NativeTestClient, role: DeviceRole) {
  const keys = generateKeyPairSync('ed25519')
  const issued = ctx.deviceTrust.issuePairing(role)
  const response = await rpc(client, 'deviceTrust/redeemPairing', { apiProtocolVersion: 2, args: { request: {
    code: issued.code, deviceName: 'native-scope-test',
    devicePublicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  } } })
  expect(response).toMatchObject({ result: { ok: true, value: { role } } })
  const deviceId = DeviceId((response as { result: { value: { deviceId: string } } }).result.value.deviceId)
  return {
    deviceId,
    admission() {
      const timestamp = Date.now()
      const nonce = randomUUID()
      return { deviceId, timestamp, nonce,
        signature: sign(null, Buffer.from(`${deviceId}\n${timestamp}\n${nonce}`), keys.privateKey).toString('base64'),
      }
    },
  }
}

it.each([true, false])('keeps normal-profile native RPC and streams in the accepting listener scope with root listener = %s', async (withRoot) => {
  const scaffold = await launchWebScaffold()
  const fibers: Fiber[] = []
  const clients: NativeTestClient[] = []
  const failures: unknown[] = []
  try {
    const root = scaffold.ctx
    expect(root.get('nativeRemote')).toBeUndefined()
    let rootClient: NativeTestClient | undefined
    if (withRoot) {
      const a = root.plugin(NativeRemote, config)
      fibers.push(a)
      await a
      await root.plugin(ScopeProbe, 'root-stream')
      rootClient = new NativeTestClient(root.nativeRemote.describe())
      clients.push(rootClient)
    }
    const child = root.isolate('nativeRemote').isolate('nativeScopeProbe')
    await child.plugin(ScopeProbe, 'isolated-stream')
    const b = child.plugin(NativeRemote, { ...config, maxRequestBodyBytes: 32_768 })
    fibers.push(b)
    await b
    const infoB = child.nativeRemote.describe()
    const client = new NativeTestClient(infoB)
    clients.push(client)
    const owner = await pair(root, client, 'owner')
    const viewer = await pair(root, client, 'viewer')
    const describe = (target: NativeTestClient, device = owner) => rpc(target, 'nativeRemote/describe', {
      apiProtocolVersion: 2, args: {}, device: device.admission(),
    })
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await describe(client)).toMatchObject({ result: { ok: true, value: infoB } })
      if (rootClient !== undefined) {
        const infoA = root.nativeRemote.describe()
        expect(infoA.port).not.toBe(infoB.port)
        expect(await describe(rootClient)).toMatchObject({ result: { ok: true, value: infoA } })
      } else expect(root.get('nativeRemote')).toBeUndefined()
    }
    expect(await describe(client, viewer)).toMatchObject({ result: { ok: false, error: { code: 'gateway/permission-denied' } } })
    expect(await rpc(client, 'nativeRemote/describe', { apiProtocolVersion: 2, args: {} }))
      .toMatchObject({ result: { ok: false, error: { code: 'gateway/permission-denied' } } })

    const ws = await client.mux()
    const unsigned = nextMessage(ws)
    ws.send(JSON.stringify({ type: 'open', streamId: 'unsigned', endpoint: 'nativeScopeProbe/follow',
      payload: { apiProtocolVersion: 2, args: {} } }))
    expect(JSON.parse(String((await unsigned)[0]))).toMatchObject({ type: 'error', error: { code: 'gateway/permission-denied' } })
    const probe = child.get('nativeScopeProbe') as unknown as ScopeProbe
    for (const action of ['cancel', 'revoke', 'dispose'] as const) {
      const opened = nextMessage(ws)
      ws.send(JSON.stringify({ type: 'open', streamId: action, endpoint: 'nativeScopeProbe/follow',
        payload: { apiProtocolVersion: 2, args: {}, device: (action === 'revoke' ? viewer : owner).admission() } }))
      expect(JSON.parse(String((await opened)[0]))).toEqual({ type: 'item', streamId: action, value: 'isolated-stream' })
      if (action === 'cancel') {
        ws.send(JSON.stringify({ type: 'cancel', streamId: action }))
        await vi.waitFor(() => { expect(probe.finished).toHaveLength(1) })
      } else if (action === 'revoke') {
        const [revoked] = await Promise.all([nextMessage(ws), root.deviceTrust.revokeDevice({ deviceId: viewer.deviceId })])
        expect(JSON.parse(String(revoked[0]))).toMatchObject({ type: 'error', streamId: action, error: { code: 'device/already-revoked' } })
        await vi.waitFor(() => { expect(probe.finished).toHaveLength(2) })
      } else {
        await Promise.all([once(ws, 'close', { signal: AbortSignal.timeout(10_000) }), b.dispose()])
        expect(probe.finished).toEqual(['isolated-stream', 'isolated-stream', 'isolated-stream'])
      }
    }
    expect(child.get('nativeRemote')).toBeUndefined()
    if (rootClient !== undefined) {
      expect(await describe(rootClient)).toMatchObject({ result: { ok: true, value: root.nativeRemote.describe() } })
      const rootWs = await rootClient.mux()
      const rootOpened = nextMessage(rootWs)
      rootWs.send(JSON.stringify({ type: 'open', streamId: 'root-survives', endpoint: 'nativeScopeProbe/follow',
        payload: { apiProtocolVersion: 2, args: {}, device: owner.admission() } }))
      expect(JSON.parse(String((await rootOpened)[0]))).toMatchObject({ type: 'item', value: 'root-stream' })
    }
  } catch (error) { failures.push(error) }
  finally {
    for (const client of clients.reverse()) await client.close().catch((error: unknown) => { failures.push(error) })
    for (const fiber of fibers.reverse()) {
      try { await fiber.dispose(); await fiber.await() } catch (error) { failures.push(error) }
    }
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Native listener isolation failed')
})

it('enforces the advertised complete HTTP body budget around real staged uploads without granting upload permission', async () => {
  const scaffold = await launchWebScaffold()
  const failures: unknown[] = []
  let listener: Fiber | undefined
  let client: NativeTestClient | undefined
  const uploads = vi.spyOn(scaffold.ctx.fileUploads, 'upload')
  const storage = vi.spyOn(scaffold.ctx.attachments, 'admitEncodedFile')
  try {
    const root = scaffold.ctx
    const budget = 2048
    const { sessionId } = await root.sessionController.create({ cwd: scaffold.workspaceCwd })
    const resolved = await root.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) throw resolved.error
    listener = root.plugin(NativeRemote, { ...config, maxRequestBodyBytes: budget })
    await listener.await()
    client = new NativeTestClient(root.nativeRemote.describe())
    const collaborator = await pair(root, client, 'collaborator')
    const viewer = await pair(root, client, 'viewer')
    const readBudget = (device: typeof collaborator) => rpc(client!, 'nativeRemote/httpRequestBudget', {
      apiProtocolVersion: 2, args: {}, device: device.admission(),
    })
    for (const device of [viewer, collaborator]) {
      expect(await readBudget(device)).toMatchObject({ result: { ok: true, value: { maxRequestBodyBytes: budget } } })
    }
    const body = (device: typeof collaborator, bytes: Buffer, name: string) => ({
      type: 'client-request', rpcId: randomUUID(), method: 'fileUploads/upload',
      payload: { apiProtocolVersion: 2, args: { agentId: sessionId, request: { data: bytes.toString('base64'), name } }, device: device.admission() },
    })
    for (const offset of [-1, 0, 1]) {
      const bytes = Buffer.alloc(1100, 65 + offset)
      const request = body(collaborator, bytes, '数据😀"\\\t.txt')
      const padding = budget + offset - Buffer.byteLength(JSON.stringify(request))
      expect(padding).toBeGreaterThanOrEqual(0)
      request.payload.args.request.name += 'x'.repeat(padding)
      const encoded = JSON.stringify(request)
      expect(Buffer.byteLength(encoded)).toBe(budget + offset)
      expect(Buffer.byteLength(JSON.stringify(request.payload.args))).toBeLessThan(budget)
      const beforeUploads = uploads.mock.calls.length
      const beforeStorage = storage.mock.calls.length
      const response = await client.post('/api/fileUploads/upload', encoded)
      if (offset === 1) {
        expect(response.status).toBe(413)
        expect(uploads.mock.calls).toHaveLength(beforeUploads)
        expect(storage.mock.calls).toHaveLength(beforeStorage)
      } else {
        expect(response.status).toBe(200)
        const result = await response.json() as { result: { ok: boolean; value: FileUploadValue } }
        expect(result.result.ok).toBe(true)
        expect(result.result.value.receiptId).toBeTypeOf('string')
        const ref = result.result.value.file
        expect(ref.bytes).toBe(bytes.length)
        expect(ref.attachmentId).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`)
        expect(await readFile(root.attachments.fileHostPath(ref)!)).toEqual(bytes)
        // Host service, not resolved.agent.ctx: the Agent scope does not inject
        // fileUploads, and resolve() itself asserts the receiving Agent's scope.
        expect(root.fileUploads.resolve(resolved.agent, result.result.value.receiptId)).toEqual(ref)
        expect(uploads.mock.calls).toHaveLength(beforeUploads + 1)
        expect(storage.mock.calls).toHaveLength(beforeStorage + 1)
      }
    }
    const viewerRequest = JSON.stringify(body(viewer, Buffer.from('view-only'), 'viewer.txt'))
    expect(Buffer.byteLength(viewerRequest)).toBeLessThan(budget)
    const viewerResponse = await client.post('/api/fileUploads/upload', viewerRequest)
    expect(viewerResponse.status).toBe(200)
    expect(await viewerResponse.json()).toMatchObject({ result: { ok: false, error: { code: 'gateway/permission-denied', details: { required: 'prompt.send' } } } })
    expect(await readBudget(collaborator)).toMatchObject({ result: { ok: true } })
    await root.deviceTrust.revokeDevice({ deviceId: collaborator.deviceId })
    const revokedRequest = JSON.stringify(body(collaborator, Buffer.from('revoked'), 'revoked.txt'))
    expect(Buffer.byteLength(revokedRequest)).toBeLessThan(budget)
    const revokedResponse = await client.post('/api/fileUploads/upload', revokedRequest)
    expect(revokedResponse.status).toBe(200)
    expect(await revokedResponse.json()).toMatchObject({ result: { ok: false, error: { code: 'device/already-revoked' } } })
    expect(uploads.mock.calls).toHaveLength(2)
    expect(storage.mock.calls).toHaveLength(2)
    expect(resolved.agent.session.snapshotEvents().filter(event => event.type === 'user/message')).toEqual([])
  } catch (error) { failures.push(error) }
  finally {
    await client?.close().catch((error: unknown) => { failures.push(error) })
    if (listener !== undefined) {
      try { await listener.dispose(); await listener.await() } catch (error) { failures.push(error) }
    }
    uploads.mockRestore()
    storage.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Native HTTP body budget failed')
})
