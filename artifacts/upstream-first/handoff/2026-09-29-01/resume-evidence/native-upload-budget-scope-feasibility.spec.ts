/** Expected-defect reproduction on existing sources; no budget API or fix is installed. */
import { createHash, generateKeyPairSync, randomUUID, sign, X509Certificate } from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import { request } from 'node:http'
import { connect } from 'node:tls'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import NativeRemote, { type Config, type NativeRemoteInfo } from '@deepseek-ai/dsh-api-native-remote'
import { launchWebScaffold } from '../apps/web/tests/scaffold.ts'

const EVIDENCE = fileURLToPath(new URL('./native-upload-budget-scope-feasibility.evidence.log', import.meta.url))
const config: Config = {
  host: '127.0.0.1', port: 0, maxConnections: 8,
  maxRequestBodyBytes: 65_536, maxWebSocketMessageBytes: 4096, maxStreamsPerConnection: 2,
  requestTimeoutMs: 5000, headersTimeoutMs: 3000, handshakeTimeoutMs: 5000,
  websocketHeartbeatIntervalMs: 1000, certificateLifetimeDays: 7, certificateRenewBeforeDays: 1,
}

/** Real HTTP over TLS checked against the selected listener's SPKI before sending bytes. */
async function post(info: NativeRemoteInfo, endpoint: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const socket = connect({ host: '127.0.0.1', port: info.port, rejectUnauthorized: false, minVersion: 'TLSv1.2' })
  socket.setTimeout(10_000, () => socket.destroy(new Error('scope feasibility TLS deadline')))
  const closed = new Promise<void>(resolve => { socket.once('close', () => { resolve() }) })
  let req: ReturnType<typeof request> | undefined
  try {
    await once(socket, 'secureConnect')
    const certificate = new X509Certificate(socket.getPeerCertificate().raw)
    expect(createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'))
      .toBe(info.spkiFingerprint)
    const body = JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload })
    return await new Promise((resolve, reject) => {
      req = request({ host: '127.0.0.1', port: info.port, path: `/api/${endpoint}`, method: 'POST',
        createConnection: () => socket,
        headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), connection: 'close' },
      }, response => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        response.on('error', reject)
        response.on('end', () => {
          try { resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString()) as unknown }) }
          catch (error) { reject(error) }
        })
      })
      req.once('error', reject)
      req.end(body)
    })
  } finally {
    req?.destroy()
    socket.destroy()
    await closed
  }
}

/** Redeem an actual owner grant on the listener under test; retain no pairing material in output. */
async function pair(ctx: Context, info: NativeRemoteInfo) {
  const keys = generateKeyPairSync('ed25519')
  const issued = ctx.deviceTrust.issuePairing('owner')
  const response = await post(info, 'deviceTrust/redeemPairing', { apiProtocolVersion: 2, args: { request: {
    code: issued.code, deviceName: 'scope-feasibility',
    devicePublicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  } } })
  expect(response.status).toBe(200)
  expect(response.body).toMatchObject({ result: { ok: true, value: { role: 'owner' } } })
  const deviceId = (response.body as { result: { value: { deviceId: string } } }).result.value.deviceId
  return () => {
    const timestamp = Date.now()
    const nonce = randomUUID()
    return { deviceId, timestamp, nonce,
      signature: sign(null, Buffer.from(`${deviceId}\n${timestamp}\n${nonce}`), keys.privateKey).toString('base64'),
    }
  }
}

it('BASELINE DEFECT: isolated listener B returns root listener A metadata through the shared Gateway', async () => {
  const scaffold = await launchWebScaffold()
  const fibers: Fiber[] = []
  const failures: unknown[] = []
  try {
    const root = scaffold.ctx
    expect(root.get('nativeRemote')).toBeUndefined()
    const a = root.plugin(NativeRemote, config)
    fibers.push(a)
    await a
    const infoA = root.nativeRemote.describe()
    const child = root.isolate('nativeRemote')
    const b = child.plugin(NativeRemote, { ...config, maxRequestBodyBytes: 32_768 })
    fibers.push(b)
    await b
    const infoB = child.nativeRemote.describe()
    expect(infoB.port).not.toBe(infoA.port)
    const admission = await pair(root, infoB)
    const resultA = await post(infoA, 'nativeRemote/describe', { apiProtocolVersion: 2, args: {}, device: admission() })
    const resultB = await post(infoB, 'nativeRemote/describe', { apiProtocolVersion: 2, args: {}, device: admission() })
    expect(resultA.status).toBe(200)
    expect(resultA.body).toEqual(expect.objectContaining({ result: { ok: true, value: infoA } }))
    expect(resultB.status).toBe(200)
    expect(resultB.body).toEqual(expect.objectContaining({ result: { ok: true, value: infoA } }))
    expect(resultB.body).not.toEqual(expect.objectContaining({ result: { ok: true, value: infoB } }))
    await appendFile(EVIDENCE, JSON.stringify({ case: 'A-plus-isolated-B', classification: 'BASELINE_DEFECT_REPRODUCED',
      distinctLiveListenerPorts: true, realTlsPinChecked: true, ownerPairingOnB: true,
      aReturnedA: true, bReturnedA: true, bDidNotReturnB: true, budgetFeatureImplemented: false }) + '\n')
    await b.dispose()
    fibers.pop()
    expect(child.get('nativeRemote')).toBeUndefined()
    const survives = await post(infoA, 'nativeRemote/describe', { apiProtocolVersion: 2, args: {}, device: admission() })
    expect(survives.body).toEqual(expect.objectContaining({ result: { ok: true, value: infoA } }))
  } catch (error) { failures.push(error) }
  finally {
    for (const fiber of fibers.reverse()) await fiber.dispose().catch((error: unknown) => { failures.push(error) })
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Dual-listener baseline reproduction failed')
  await appendFile(EVIDENCE, JSON.stringify({ case: 'A-plus-isolated-B', cleanupAwaited: true, aSurvivedBDisposal: true }) + '\n')
})

it('BASELINE DEFECT: a lone isolated listener B cannot expose its existing describe method through root Gateway', async () => {
  const scaffold = await launchWebScaffold()
  let listener: Fiber | undefined
  const failures: unknown[] = []
  try {
    const root = scaffold.ctx
    expect(root.get('nativeRemote')).toBeUndefined()
    const child = root.isolate('nativeRemote')
    listener = child.plugin(NativeRemote, config)
    await listener
    const infoB = child.nativeRemote.describe()
    expect(root.get('nativeRemote')).toBeUndefined()
    const admission = await pair(root, infoB)
    const response = await post(infoB, 'nativeRemote/describe', { apiProtocolVersion: 2, args: {}, device: admission() })
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ result: { ok: false } })
    const error = (response.body as { result: { error: { code: string; details: unknown } } }).result.error
    expect(['gateway/permission-denied', 'gateway/method-unavailable', 'gateway/service-unavailable', 'gateway/invocation-unavailable'])
      .toContain(error.code)
    await appendFile(EVIDENCE, JSON.stringify({ case: 'isolated-B-only', classification: 'BASELINE_DEFECT_REPRODUCED',
      realTlsPinChecked: true, ownerPairingOnB: true, rootHasNoNativeRemote: true,
      localBDescribeAvailable: true, signedHttpDescribeRefused: true, actualCode: error.code,
      budgetFeatureImplemented: false }) + '\n')
  } catch (error) { failures.push(error) }
  finally {
    if (listener !== undefined) await listener.dispose().catch((error: unknown) => { failures.push(error) })
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Isolated-only baseline reproduction failed')
  await appendFile(EVIDENCE, JSON.stringify({ case: 'isolated-B-only', cleanupAwaited: true }) + '\n')
})
