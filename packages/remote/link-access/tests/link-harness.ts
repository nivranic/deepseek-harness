/** Carrier test harness: one real composition (Connection, Typert gateway, Device Trust, carrier) over a real TLS socket. */

import { createHash, generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Context as RootContext, Service } from '@deepseek-ai/cordis'
import { apply as applyConnection, inject as connectionInject } from '@deepseek-ai/dsh-client-connection'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { Remote, bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import DeviceTrustStore from '@deepseek-ai/dsh-device-trust'
import LinkAccessService from '../src/index.ts'
import { linkSigningInput, type LinkEndpointInput } from '../src/protocol.ts'

/** Fake Remote service proving unary and stream dispatch through the carrier. */
class ProbeService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'probe')
  readonly calls: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'probe')
  }

  @Remote
  echo(value: string): string {
    this.calls.push(`echo:${value}`)
    return `echo:${value}`
  }

  @Remote
  admin(value: string): string {
    this.calls.push(`admin:${value}`)
    return `admin:${value}`
  }

  @Remote
  slow(signal: AbortSignal): Promise<string> {
    const calls = this.calls
    return new Promise<string>((resolve) => {
      const finish = (): void => {
        calls.push(signal.aborted ? 'slow:aborted' : 'slow:done')
        resolve(signal.aborted ? 'cancelled' : 'slow')
      }
      if (signal.aborted) {
        finish()
        return
      }
      const timer = setTimeout(finish, 300)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        finish()
      }, { once: true })
    })
  }

  @Remote({ mode: 'stream' })
  ticks(count: number, signal: AbortSignal): AsyncIterable<string> {
    const calls = this.calls
    return (async function* () {
      for (let index = 0; index < count && !signal.aborted; index += 1) {
        calls.push(`tick:${String(index)}`)
        yield String(index)
      }
    })()
  }
}

/** Allowlist rows covering allowlist, role, kind, and approval gates in tests. */
export const PROBE_ENDPOINTS: LinkEndpointInput[] = [
  { endpoint: 'probe/echo', kind: 'unary', minRole: 'observer' },
  { endpoint: 'probe/admin', kind: 'unary', minRole: 'controller' },
  { endpoint: 'probe/slow', kind: 'unary', minRole: 'observer' },
  { endpoint: 'probe/ticks', kind: 'stream', minRole: 'observer' },
  { endpoint: '$events', kind: 'stream', minRole: 'observer' },
  { endpoint: '$events/result', kind: 'unary', minRole: 'controller' },
]

/** Credentials of one paired test device. */
export interface TestDevice {
  readonly deviceId: string
  readonly privateKey: KeyObject
}

/** One raw carrier response. */
export interface CarrierResponse {
  readonly status: number
  readonly json: unknown
  readonly text: string
}

/** One mounted carrier composition. */
export interface CarrierHarness {
  readonly ctx: Context
  readonly service: LinkAccessService
  readonly endpoint: string
  readonly close: () => Promise<void>
}

/** Provide an in-memory credential-record owner for a mounted Connection plugin. */
export function provideCredentials(ctx: Context): void {
  const records = new Map<unknown, unknown>()
  ctx.provide('credentials', {
    async modifyRecord(key: unknown, mutate: (current: unknown) => Promise<unknown>): Promise<unknown> {
      const current = records.get(key)
      const next = await mutate(current)
      if (next !== undefined) records.set(key, next)
      return next ?? current
    },
  } as never)
}

/**
 * Mount the full carrier composition with probe services.
 * @param overrides - carrier config overrides applied over the test defaults.
 * @returns the mounted harness with its live endpoint.
 */
export async function mountCarrier(
  overrides: Partial<ConstructorParameters<typeof LinkAccessService>[1]> = {},
): Promise<CarrierHarness> {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-link-access-'))
  const ctx = new RootContext()
  try {
    provideCredentials(ctx)
    await ctx.plugin({ inject: [...connectionInject], apply: applyConnection })
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(TypertGatewayService)
    await ctx.plugin(ProbeService)
    await ctx.plugin(DeviceTrustStore, { path: ':memory:' })
    await ctx.plugin(LinkAccessService, {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      dshHome,
      endpoints: PROBE_ENDPOINTS,
      maxRequestBodyBytes: 4096,
      ...overrides,
    })
    const service = ctx.get('linkAccess') as LinkAccessService
    const endpoint = await service.endpoint()
    if (endpoint === undefined) throw new Error('carrier test harness did not bind an endpoint')
    return {
      ctx,
      service,
      endpoint,
      close: async () => {
        await ctx.fiber.dispose()
      },
    }
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}

/**
 * Pair one device through the live pairing route.
 * @param harness - mounted carrier harness.
 * @param deviceName - name carried in the pairing request.
 * @returns the paired device identity and its Ed25519 signing key.
 */
export async function pairDevice(harness: CarrierHarness, deviceName: string): Promise<TestDevice> {
  const pairing = await harness.service.createPairing()
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const response = await carrierRequest(harness.endpoint, '/link/pair', {
    method: 'POST',
    body: JSON.stringify({
      code: pairing.code,
      deviceName,
      devicePublicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    }),
  })
  if (response.status !== 200) throw new Error(`pairDevice failed: HTTP ${String(response.status)}`)
  return { deviceId: (response.json as { deviceId: string }).deviceId, privateKey }
}

/**
 * Send one unsigned request straight to the carrier.
 * @param endpoint - carrier `https://` endpoint.
 * @param path - request target.
 * @param options - method, optional JSON body, and optional header replacement.
 * @returns the parsed response.
 */
export function carrierRequest(
  endpoint: string,
  path: string,
  options: { readonly method: string; readonly body?: string; readonly headers?: Record<string, string> } = { method: 'GET' },
): Promise<CarrierResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint)
    const request = httpsRequest({
      host: url.hostname,
      port: url.port,
      path,
      method: options.method,
      rejectUnauthorized: false,
      headers: options.headers ?? (options.body === undefined ? {} : { 'content-type': 'application/json' }),
    }, (response) => {
      void collect(response).then(({ text }) => {
        resolve(parseResponse(response.statusCode ?? 0, text))
      }, reject)
    })
    request.on('error', reject)
    if (options.body !== undefined) request.write(options.body)
    request.end()
  })
}

/**
 * Issue one device-signed carrier request.
 * @param endpoint - carrier `https://` endpoint.
 * @param device - paired device credentials.
 * @param path - request target; the signature covers it exactly.
 * @param method - HTTP method.
 * @param body - exact body bytes.
 * @param overrides - optional timestamp override and header replacement.
 * @returns the parsed response.
 */
export function issueSigned(
  endpoint: string,
  device: TestDevice,
  path: string,
  method: string,
  body: string,
  overrides: { readonly timestamp?: number; readonly headers?: Record<string, string> } = {},
): Promise<CarrierResponse> {
  const timestamp = String(overrides.timestamp ?? Date.now())
  const digest = createHash('sha256').update(body).digest('hex')
  const signature = edSign(
    null,
    Buffer.from(linkSigningInput(timestamp, method, path, digest)),
    device.privateKey,
  ).toString('base64')
  const url = new URL(endpoint)
  return new Promise((resolve, reject) => {
    const request = httpsRequest({
      host: url.hostname,
      port: url.port,
      path,
      method,
      rejectUnauthorized: false,
      headers: overrides.headers ?? {
        'x-dsh-device-id': device.deviceId,
        'x-dsh-timestamp': timestamp,
        'x-dsh-signature': signature,
        ...(body === '' ? {} : { 'content-type': 'application/json' }),
      },
    }, (response) => {
      void collect(response).then(({ text }) => {
        resolve(parseResponse(response.statusCode ?? 0, text))
      }, reject)
    })
    request.on('error', reject)
    if (body !== '') request.write(body)
    request.end()
  })
}

/**
 * Send one signed unary RPC envelope through `/api`.
 * @param endpoint - carrier `https://` endpoint.
 * @param device - paired device credentials.
 * @param method - canonical endpoint, for example `probe/echo`.
 * @param args - named wire arguments.
 * @returns the parsed response.
 */
export function signedRpc(
  endpoint: string,
  device: TestDevice,
  method: string,
  args: Record<string, unknown>,
): Promise<CarrierResponse> {
  const path = `/api/${method}`
  return issueSigned(endpoint, device, path, 'POST', JSON.stringify({
    type: 'client-request',
    rpcId: `rpc-${method}`,
    method,
    payload: { args },
  }))
}

/**
 * Collect one response (or NDJSON stream) to completion.
 * @param response - incoming carrier response.
 * @returns the full response text.
 */
function collect(response: IncomingMessage): Promise<{ readonly text: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
    response.on('end', () => { resolve({ text: Buffer.concat(chunks).toString('utf8') }) })
    response.on('error', reject)
  })
}

function parseResponse(status: number, text: string): CarrierResponse {
  let json: unknown
  try {
    json = JSON.parse(text) as unknown
  } catch {
    json = undefined
  }
  return { status, json, text }
}
