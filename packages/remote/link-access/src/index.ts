/**
 * @deepseek-ai/dsh-link-access — the Native Remote Access carrier: a TLS
 * listener that authenticates paired devices (Ed25519 request signatures
 * against the Device Trust store), enforces a role-gated remote endpoint
 * allowlist, and dispatches onto the existing Typert gateway surface — unary
 * RPC through the Connection shared `/api` fetch handler and Remote streams
 * through `typertGateway.wireStream` as NDJSON, the same adapter pair the
 * desktop carrier uses. The carrier owns no session, workspace, or approval
 * state; revoking a device in the trust store cuts its authorization on the
 * next request.
 * @module @deepseek-ai/dsh-link-access
 */

import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Server } from 'node:https'
import { createServer as createHttpsServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { ConnectionFetchHandler } from '@deepseek-ai/dsh-client-connection'
// Activates the typertGateway Context merge used by the stream route.
import type {} from '@deepseek-ai/dsh-api-gateway'
import {
  DeviceTrustError,
  type DeviceId,
  type PairedDevice,
} from '@deepseek-ai/dsh-device-trust'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/types'
import z from '@deepseek-ai/schemastery'
import { ensureHostTlsMaterial } from './tls.ts'
import {
  DEFAULT_LINK_ENDPOINTS,
  LINK_API_PREFIX,
  LINK_DEFAULT_MAX_REQUEST_BODY_BYTES,
  LINK_DESCRIBE_PATH,
  LINK_DEVICE_ID_HEADER,
  LINK_PAIR_PATH,
  LINK_PROTOCOL_BODY_LIMIT_BYTES,
  LINK_PROTOCOL_VERSION,
  LINK_SIGNATURE_HEADER,
  LINK_STREAM_PREFIX,
  LINK_TIMESTAMP_HEADER,
  REMOTE_INTERACTION_ANSWER_ENDPOINT,
  authorizeLinkEndpoint,
  linkSigningInput,
  pairingEndpoint,
  parseLinkPairRequest,
  type LinkEndpointAccess,
  type LinkEndpointInput,
  type LinkHostDescription,
  type LinkPairingPayload,
} from './protocol.ts'

const require = createRequire(import.meta.url)
const HOST_VERSION: string = (require('../package.json') as { version: string }).version

/** Interval between durable `lastSeenAt` writes for one repeatedly active device. */
const DEVICE_TOUCH_INTERVAL_MS = 60_000

/** Test seam for the carrier's clock; production reads the wall clock. */
export const internals = {
  now: (): number => Date.now(),
}

interface CarrierState {
  readonly server: Server
  readonly endpoint: string
  readonly spkiFingerprint: string
}

/** Plugin configuration. */
export interface LinkAccessConfig {
  /** Bind the TLS carrier. Remote access stays disabled until this is explicitly enabled. */
  enabled?: boolean
  /**
   * Bind address; `0.0.0.0` selects every interface and derives the pairing
   * endpoint from the first non-internal IPv4 address.
   */
  host?: string
  /** Bind port; `0` takes an OS-assigned port (tests). */
  port?: number
  /** Harness home owning the TLS material directory; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /**
   * The complete remote endpoint allowlist, replacing the default surface.
   * Every row states its invocation kind and minimum device role.
   */
  endpoints?: LinkEndpointInput[]
  /** Independent switch for answering remote approvals and questions; `Can prompt` never implies this. */
  allowRemoteApproval?: boolean
  /** Role granted to devices at pairing. Default `controller` (an ordinary phone). */
  pairingRole?: 'observer' | 'controller'
  /** Pairing code lifetime in seconds. */
  pairingTtlSeconds?: number
  /** Accepted request-timestamp skew in seconds. */
  clockSkewSeconds?: number
  /** Carrier cap for unary RPC bodies. */
  maxRequestBodyBytes?: number
}

/** Schemastery validator for {@link LinkAccessConfig}. */
export const Config: z<LinkAccessConfig> = z.object({
  enabled: z.boolean().default(false),
  host: z.string().default('127.0.0.1'),
  port: z.natural().max(65535).default(0),
  dshHome: z.string(),
  endpoints: z.array(z.object({
    endpoint: z.string(),
    kind: z.union(['unary', 'stream'] as const),
    minRole: z.union(['observer', 'controller'] as const),
  })).default(DEFAULT_LINK_ENDPOINTS),
  allowRemoteApproval: z.boolean().default(false),
  pairingRole: z.union(['observer', 'controller'] as const).default('controller'),
  pairingTtlSeconds: z.natural().min(30).max(3600).default(300),
  clockSkewSeconds: z.natural().min(30).max(3600).default(300),
  maxRequestBodyBytes: z.natural().min(1).default(LINK_DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/** Refusal served to an authenticated-carrier check that did not pass. */
interface LinkRejection {
  readonly status: 401
  readonly message: string
}

/** Config after the Loader (or `ctx.plugin`) applied the schema defaults. */
interface ResolvedLinkAccessConfig extends LinkAccessConfig {
  readonly enabled: boolean
  readonly host: string
  readonly port: number
  readonly endpoints: LinkEndpointInput[]
  readonly allowRemoteApproval: boolean
  readonly pairingRole: 'observer' | 'controller'
  readonly pairingTtlSeconds: number
  readonly clockSkewSeconds: number
  readonly maxRequestBodyBytes: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Host's native remote access carrier. */
    linkAccess: LinkAccessService
  }
}

/**
 * The native remote access carrier service: TLS listener, device
 * authentication, remote endpoint authorization, and the pairing ingress
 * over the existing gateway surface.
 * @typert service linkAccess
 */
export class LinkAccessService extends Service {
  static inject = ['connection', 'typertGateway', 'deviceTrust']
  static Config: z<LinkAccessConfig> = Config

  private readonly table: ReadonlyMap<string, LinkEndpointAccess>
  private readonly allowRemoteApproval: boolean
  private readonly pairingRole: 'observer' | 'controller'
  private readonly pairingTtlSeconds: number
  private readonly clockSkewMs: number
  private readonly maxRequestBodyBytes: number
  private readonly sharedFetch: ConnectionFetchHandler
  private readonly lastTouch = new Map<DeviceId, number>()
  private readonly carrier: Promise<CarrierState | undefined>

  /**
   * Resolve configuration, provide the host service face, and bind the TLS
   * carrier when enabled.
   * @param ctx - owning Host context with Connection, Typert gateway, and Device Trust.
   * @param config - validated plugin configuration (schema defaults applied).
   */
  constructor(ctx: Context, config: LinkAccessConfig) {
    super(ctx, 'linkAccess')
    const resolved = config as ResolvedLinkAccessConfig
    this.table = endpointTable(resolved.endpoints)
    this.allowRemoteApproval = resolved.allowRemoteApproval
    this.pairingRole = resolved.pairingRole
    this.pairingTtlSeconds = resolved.pairingTtlSeconds
    this.clockSkewMs = resolved.clockSkewSeconds * 1000
    this.maxRequestBodyBytes = resolved.maxRequestBodyBytes
    this.sharedFetch = ctx.connection.createSharedFetchHandler('/api')
    this.carrier = resolved.enabled
      ? this.startCarrier(resolved.host, resolved.port, resolved.dshHome)
      : Promise.resolve(undefined)
    // Mark the rejection handled: every consumer re-awaits `carrier`, so a
    // bind failure still surfaces to each caller; this guard only prevents an
    // unhandled-rejection crash when the failure precedes the first use.
    this.carrier.catch(() => {})
    ctx.effect(() => async () => {
      await this.stopCarrier()
    }, 'link-access.carrier')
  }

  /**
   * The carrier endpoint the pairing QR carries.
   * @returns the bound `https://` endpoint, or `undefined` while disabled.
   * @throws when the carrier failed to bind.
   */
  async endpoint(): Promise<string | undefined> {
    return (await this.carrier)?.endpoint
  }

  /**
   * The fingerprint devices pin when pairing with this host.
   * @returns lowercase hex SHA-256 of the host certificate's SPKI, or `undefined` while disabled.
   * @throws when the carrier failed to bind.
   */
  async spkiFingerprint(): Promise<string | undefined> {
    return (await this.carrier)?.spkiFingerprint
  }

  /**
   * Issue one pairing payload for the QR display: host identity, endpoint,
   * certificate fingerprint, and a one-time short-lived code.
   * @returns the payload rendered into the pairing QR code.
   * @throws when the carrier is disabled or failed to bind.
   */
  async createPairing(): Promise<LinkPairingPayload> {
    const state = await this.carrier
    if (state === undefined) throw new Error('link access: carrier is disabled; enable it before pairing')
    const [identity, pairing] = await Promise.all([
      this.ctx.deviceTrust.hostIdentity(),
      this.ctx.deviceTrust.createPairing(this.pairingTtlSeconds),
    ])
    return {
      v: LINK_PROTOCOL_VERSION,
      kind: 'dsh-link-pairing',
      hostId: identity.hostId,
      hostName: hostname(),
      endpoint: state.endpoint,
      spkiFingerprint: state.spkiFingerprint,
      code: pairing.code,
      expiresAt: pairing.expiresAt,
    }
  }

  /**
   * List every device record, revoked ones included.
   * @returns the trust store's device records.
   */
  async trustedDevices(): Promise<readonly PairedDevice[]> {
    return this.ctx.deviceTrust.devices()
  }

  /**
   * Revoke one paired device; its next request is refused.
   * @param deviceId - identity of the device to revoke.
   * @returns the device record after revocation, or `undefined` when unknown.
   */
  async revokeDevice(deviceId: DeviceId): Promise<PairedDevice | undefined> {
    return this.ctx.deviceTrust.revoke(deviceId)
  }

  private async startCarrier(host: string, port: number, dshHome: string | undefined): Promise<CarrierState> {
    const stateDir = join(resolveDshHome(dshHome), 'link-access')
    const tls = await ensureHostTlsMaterial(stateDir)
    const server = createHttpsServer({ key: tls.keyPem, cert: tls.certPem }, (req, res) => {
      void this.handle(req, res)
    })
    server.on('tlsClientError', (_error, socket) => {
      socket.destroy()
    })
    await listen(server, host, port)
    return {
      server,
      endpoint: pairingEndpoint(
        host,
        (server.address() as AddressInfo).port,
        Object.values(networkInterfaces()).flatMap(links => links ?? []),
      ),
      spkiFingerprint: tls.spkiFingerprint,
    }
  }

  private async stopCarrier(): Promise<void> {
    const state = await this.carrier.catch(() => undefined)
    if (state === undefined) return
    state.server.closeAllConnections()
    await closeServer(state.server)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    /* v8 ignore next -- node:http always sets url on server requests. */
    const pathname = new URL(req.url ?? '/', 'https://dsh.link').pathname
    try {
      if (pathname === LINK_PAIR_PATH) {
        await this.handlePair(req, res)
        return
      }
      if (pathname === LINK_DESCRIBE_PATH) {
        await this.handleDescribe(req, res)
        return
      }
      if (pathname.startsWith(LINK_API_PREFIX)) {
        await this.handleUnary(req, res, pathname)
        return
      }
      if (pathname.startsWith(LINK_STREAM_PREFIX)) {
        await this.handleStream(req, res, pathname)
        return
      }
      respond(res, 404, { error: 'not-found' })
    } catch (error) {
      /* v8 ignore next 2 -- defensive: every route owns its failures; this guard only contains a carrier bug. */
      respond(res, 500, { error: 'internal', message: messageOf(error) })
    }
  }

  private async handlePair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      respond(res, 405, { error: 'method-not-allowed' })
      return
    }
    const body = await readBody(req, res, LINK_PROTOCOL_BODY_LIMIT_BYTES)
    if (body === undefined) return
    let request: ReturnType<typeof parseLinkPairRequest>
    try {
      request = parseLinkPairRequest(parseJson(body))
    } catch (error) {
      respond(res, 400, { error: 'bad-pairing-request', message: messageOf(error) })
      return
    }
    try {
      const device = await this.ctx.deviceTrust.consumePairing(
        request.code,
        { name: request.deviceName, publicKeySpki: request.devicePublicKey },
        this.pairingRole,
      )
      const identity = await this.ctx.deviceTrust.hostIdentity()
      respond(res, 200, {
        deviceId: device.deviceId,
        hostId: identity.hostId,
        hostName: hostname(),
        role: device.role,
        linkProtocolVersion: LINK_PROTOCOL_VERSION,
      })
      return
    } catch (error) {
      if (error instanceof DeviceTrustError) {
        respond(res, 403, { error: 'pairing-rejected', message: error.message })
        return
      }
      respond(res, 400, { error: 'bad-pairing-request', message: messageOf(error) })
    }
  }

  private async handleDescribe(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      respond(res, 405, { error: 'method-not-allowed' })
      return
    }
    const body = await readBody(req, res, LINK_PROTOCOL_BODY_LIMIT_BYTES)
    if (body === undefined) return
    const device = await this.authenticate(req, body)
    if ('status' in device) {
      respondRejection(res, device)
      return
    }
    const identity = await this.ctx.deviceTrust.hostIdentity()
    respond(res, 200, describeHost(identity.hostId, hostname(), this.allowRemoteApproval))
  }

  private async handleUnary(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    const body = await readBody(req, res, this.maxRequestBodyBytes)
    if (body === undefined) return
    const device = await this.authenticate(req, body)
    if ('status' in device) {
      respondRejection(res, device)
      return
    }
    const endpoint = pathname.slice(LINK_API_PREFIX.length)
    const refusal = authorizeLinkEndpoint(this.table, endpoint, 'unary', device.role, this.allowRemoteApproval)
    if (refusal !== undefined) {
      respond(res, 403, { error: 'forbidden', reason: refusal })
      return
    }
    this.touchSoon(device)
    const abort = new AbortController()
    res.once('close', () => {
      if (!res.writableEnded) abort.abort()
    })
    const canSendBody = req.method !== 'GET' && req.method !== 'HEAD'
    /* v8 ignore next -- node:http always sets url on server requests. */
    const request = new Request(new URL(req.url ?? '/', 'https://dsh.link'), {
      /* v8 ignore next -- node:http always sets method on server requests. */
      method: req.method ?? 'POST',
      headers: stringHeaders(req.headers),
      ...body.length > 0 && canSendBody ? { body: body.toString('utf8') } : {},
      signal: abort.signal,
    })
    const response = await this.sharedFetch.fetch(request)
    await pumpResponse(res, response)
  }

  private async handleStream(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    const endpoint = decodeURIComponent(pathname.slice(LINK_STREAM_PREFIX.length))
    if (endpoint === '') {
      respond(res, 404, { error: 'not-found' })
      return
    }
    const body = await readBody(req, res, LINK_PROTOCOL_BODY_LIMIT_BYTES)
    if (body === undefined) return
    const device = await this.authenticate(req, body)
    if ('status' in device) {
      respondRejection(res, device)
      return
    }
    if (req.method !== 'POST') {
      respond(res, 405, { error: 'method-not-allowed' })
      return
    }
    const refusal = authorizeLinkEndpoint(this.table, endpoint, 'stream', device.role, this.allowRemoteApproval)
    if (refusal !== undefined) {
      respond(res, 403, { error: 'forbidden', reason: refusal })
      return
    }
    let payload: unknown
    try {
      payload = parseJson(body)
    } catch (error) {
      respond(res, 400, { error: 'bad-stream-request', message: messageOf(error) })
      return
    }
    this.touchSoon(device)
    const lifetime = new AbortController()
    res.once('close', () => {
      if (!res.writableEnded) lifetime.abort()
    })
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    })
    try {
      const source = await this.ctx.typertGateway.wireStream.open(endpoint, payload, lifetime.signal)
      for await (const item of source) {
        await writeFrame(res, { k: 'v', v: item })
        if (lifetime.signal.aborted) return
      }
    } catch (error) {
      if (!lifetime.signal.aborted) {
        const failure = this.ctx.typertGateway.wireStream.failure(error)
        await writeFrame(res, { k: 'e', c: failure.code, m: failure.message, d: failure.details })
      }
    } finally {
      res.end()
    }
  }

  /**
   * Verify one request's device credentials: known device, not revoked,
   * timestamp inside the accepted skew, and a valid Ed25519 signature over
   * the canonical input.
   * @param req - carrier request carrying the three credential headers.
   * @param body - exact bytes the signature's body digest covers.
   * @returns the trusted device, or the 401 refusal to serve.
   */
  private async authenticate(req: IncomingMessage, body: Buffer): Promise<PairedDevice | LinkRejection> {
    const deviceId = req.headers[LINK_DEVICE_ID_HEADER]
    const timestamp = req.headers[LINK_TIMESTAMP_HEADER]
    const signature = req.headers[LINK_SIGNATURE_HEADER]
    if (typeof deviceId !== 'string' || typeof timestamp !== 'string' || typeof signature !== 'string') {
      return { status: 401, message: 'missing device credentials' }
    }
    const device = await this.ctx.deviceTrust.device(deviceId as DeviceId)
    if (device === undefined) return { status: 401, message: 'unknown device' }
    if (device.revokedAt !== undefined) return { status: 401, message: 'device is revoked' }
    const issued = Number(timestamp)
    if (!Number.isSafeInteger(issued) || Math.abs(internals.now() - issued) > this.clockSkewMs) {
      return { status: 401, message: 'stale request timestamp' }
    }
    const bodyDigest = createHash('sha256').update(body).digest('hex')
    let verified = false
    try {
      const key = createPublicKey({
        key: Buffer.from(device.publicKeySpki, 'base64'),
        format: 'der',
        type: 'spki',
      })
      verified = verifySignature(
        null,
        /* v8 ignore next 2 -- node:http always sets method and url on server requests. */
        Buffer.from(linkSigningInput(timestamp, req.method ?? '', req.url ?? '/', bodyDigest)),
        key,
        Buffer.from(signature, 'base64'),
      )
    } catch {
      /* v8 ignore next -- pairing validates every stored key and base64 never throws; this guard contains a tampered store. */
      verified = false
    }
    if (!verified) return { status: 401, message: 'invalid request signature' }
    return device
  }

  private touchSoon(device: PairedDevice): void {
    const now = internals.now()
    if (now - (this.lastTouch.get(device.deviceId) ?? 0) < DEVICE_TOUCH_INTERVAL_MS) return
    this.lastTouch.set(device.deviceId, now)
    void this.ctx.deviceTrust.touch(device.deviceId)
  }
}

function endpointTable(inputs: readonly LinkEndpointInput[]): ReadonlyMap<string, LinkEndpointAccess> {
  const table = new Map<string, LinkEndpointAccess>()
  for (const input of inputs) {
    if (table.has(input.endpoint)) {
      throw new Error(`link access: endpoint ${JSON.stringify(input.endpoint)} appears twice in the remote allowlist`)
    }
    // The interaction-answer endpoint is protocol-defined; resolution marks
    // it so the independent approval switch applies regardless of which
    // allowlist lists it.
    table.set(input.endpoint, {
      ...input,
      ...(input.endpoint === REMOTE_INTERACTION_ANSWER_ENDPOINT ? { approval: true as const } : {}),
    })
  }
  return table
}

function describeHost(hostId: string, hostName: string, allowRemoteApproval: boolean): LinkHostDescription {
  return {
    linkProtocolVersion: LINK_PROTOCOL_VERSION,
    hostVersion: HOST_VERSION,
    hostId,
    hostName,
    runtimeClass: 'full',
    sessionFormatVersion: SESSION_FORMAT_VERSION,
    allowRemoteApproval,
    capabilities: {
      session: { list: true, history: true, follow: true, prompt: true, cancel: true },
      workspace: { follow: true },
      interaction: { approval: allowRemoteApproval, question: allowRemoteApproval },
    },
  }
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error): void => {
      server.off('listening', done)
      reject(error)
    }
    const done = (): void => {
      server.off('error', fail)
      resolve()
    }
    server.once('error', fail)
    server.once('listening', done)
    server.listen(port, host)
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      /* v8 ignore next 3 -- stopCarrier closes each listening server exactly once; this guard contains a double teardown. */
      if (error === undefined) resolve()
      else reject(error)
    })
  })
}

/**
 * Buffer one request body under a byte cap. The response owns the 413; a
 * body the client abandons mid-read surfaces as a rejected promise to the
 * route.
 * @param req - incoming carrier request.
 * @param res - response the 413 is written to.
 * @param limit - maximum buffered bytes.
 * @returns the exact request bytes, or `undefined` after serving a 413.
 */
async function readBody(
  req: IncomingMessage,
  res: ServerResponse,
  limit: number,
): Promise<Buffer | undefined> {
  const declared = req.headers['content-length']
  if (declared !== undefined && Number(declared) > limit) {
    respond(res, 413, { error: 'payload-too-large' }, { connection: 'close' })
    return undefined
  }
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    received += buffer.byteLength
    if (received > limit) {
      respond(res, 413, { error: 'payload-too-large' }, { connection: 'close' })
      return undefined
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function respond(res: ServerResponse, status: number, value: object, extra: Record<string, string> = {}): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    ...extra,
  })
  res.end(body)
}

function respondRejection(res: ServerResponse, rejection: LinkRejection): void {
  respond(res, rejection.status, { error: 'unauthorized', message: rejection.message })
}

async function pumpResponse(res: ServerResponse, response: Response): Promise<void> {
  /* v8 ignore next -- a client that vanished mid-RPC closes the response; the dispatcher below observes the abort. */
  if (res.destroyed || res.writableEnded) return
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  /* v8 ignore next 3 -- the /api chain always answers with a JSON body; a bodiless response is a carrier bug. */
  if (response.body === null) {
    res.end()
    return
  }
  for await (const chunk of response.body) {
    if (!res.write(chunk)) await drain(res)
  }
  res.end()
}

async function writeFrame(res: ServerResponse, frame: object): Promise<void> {
  /* v8 ignore next -- defensive: frames are never queued after end(); contains a carrier bug. */
  if (res.writableEnded || res.destroyed) return
  if (!res.write(`${JSON.stringify(frame)}\n`)) await drain(res)
}

/** Await socket drain, resolving immediately on a closed or torn-down response.
 * @param res - response whose write returned `false`.
 * @returns resolution when the socket drains or the response closed.
 */
function drain(res: ServerResponse): Promise<void> {
  /* v8 ignore next -- only a destroy racing the write guard reaches here; the close listener resolves it too. */
  if (res.destroyed || res.writableEnded) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = (): void => {
      res.off('drain', done)
      res.off('close', done)
      resolve()
    }
    res.once('drain', done)
    res.once('close', done)
  })
}

function parseJson(body: Buffer): unknown {
  return JSON.parse(body.toString('utf8')) as unknown
}

function stringHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function messageOf(error: unknown): string {
  /* v8 ignore next -- every thrown boundary value in this package is an Error; the String arm contains a foreign throw. */
  return error instanceof Error ? error.message : String(error)
}

export default LinkAccessService
