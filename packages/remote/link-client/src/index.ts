/**
 * Reference client for the dsh link-access carrier: an SPKI-pinned TLS
 * transport, one-time pairing, Ed25519-signed unary RPC over `/api`, and
 * NDJSON Remote streams over `/link/stream`. Native companions (Swift,
 * Kotlin) reimplement this state machine against the same wire vocabulary;
 * this package is the executable contract they are checked against.
 * @module @deepseek-ai/dsh-link-client
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign as edSign,
  timingSafeEqual,
  X509Certificate,
  type KeyObject,
} from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import * as tls from 'node:tls'
import {
  LINK_DESCRIBE_PATH,
  LINK_DEVICE_ID_HEADER,
  LINK_PAIR_PATH,
  LINK_PROTOCOL_VERSION,
  LINK_SIGNATURE_HEADER,
  LINK_STREAM_PREFIX,
  LINK_TIMESTAMP_HEADER,
  linkSigningInput,
  parseLinkPairValue,
  type LinkHostDescription,
  type LinkPairingPayload,
} from '@deepseek-ai/dsh-link-access/protocol'

/** Failure raised for carrier rejections and gateway error envelopes. */
export class LinkError extends Error {
  /** Stable failure category: the carrier's `error`/`reason`, or the gateway error code. */
  readonly code: string
  /** Gateway error details, when the gateway produced the failure. */
  readonly details: unknown

  /**
   * Construct a link failure.
   * @param code - stable failure category.
   * @param message - diagnostic from the carrier or gateway.
   * @param details - optional gateway error details.
   */
  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'LinkError'
    this.code = code
    this.details = details
  }
}

/** Constructor-facing credentials of one paired device. */
export interface LinkClientOptions {
  /** Carrier `https://` endpoint from the pairing payload. */
  readonly endpoint: string
  /** Lowercase hex SHA-256 of the host certificate's SubjectPublicKeyInfo. */
  readonly spkiFingerprint: string
  readonly deviceId: string
  /** Ed25519 private key whose public half the host stored at pairing. */
  readonly deviceKey: KeyObject
}

/** One parsed carrier or gateway response body. */
interface LinkHttpResponse {
  readonly status: number
  readonly json: unknown
  readonly text: string
}

/**
 * Keep-alive HTTPS agent that refuses every server certificate whose
 * SubjectPublicKeyInfo is not the pinned one, before any request byte is
 * written.
 */
class PinnedAgent extends HttpsAgent {
  /**
   * Pin the agent to one fingerprint.
   * @param expected - SHA-256 digest of the accepted SubjectPublicKeyInfo DER.
   */
  constructor(private readonly expected: Buffer) {
    super({ keepAlive: true })
  }

  /** Open one TLS connection and destroy it when the pin does not hold.
   * @param options - connection options the agent resolved for this request.
   * @returns the connecting TLS socket.
   */
  override createConnection(
    options: { readonly host?: string; readonly port?: number; readonly servername?: string },
  ): tls.TLSSocket {
    const socket = tls.connect({
      host: options.host,
      port: options.port,
      servername: options.servername,
      rejectUnauthorized: false,
    })
    socket.once('secureConnect', () => {
      if (!pinnedSocketOk(socket, this.expected)) {
        socket.destroy(new Error('link host certificate does not match the pairing fingerprint'))
      }
    })
    return socket
  }
}

/**
 * The link-access reference client.
 */
export class LinkClient {
  private readonly agent: PinnedAgent
  private disposed = false

  /**
   * Build a client from existing paired credentials.
   * @param options - endpoint, pinned fingerprint, and device credentials.
   */
  constructor(private readonly options: LinkClientOptions) {
    this.agent = new PinnedAgent(Buffer.from(options.spkiFingerprint, 'hex'))
  }

  /**
   * Pair with a host using its displayed QR payload: verify the payload is
   * current, generate (or reuse) the device signing key, and exchange the
   * one-time code for a device identity over the pinned TLS connection.
   * @param pairing - payload decoded from the host's pairing QR code.
   * @param options - device name shown in the host's trusted-device list; an optional existing signing key.
   * @returns the paired client.
   * @throws {@link LinkError} when the payload is expired or the host refuses the pairing.
   */
  static async pair(
    pairing: LinkPairingPayload,
    options: { readonly deviceName: string; readonly deviceKey?: KeyObject },
  ): Promise<LinkClient> {
    const wire = pairing as unknown as { readonly v?: number; readonly kind?: string }
    if (wire.v !== LINK_PROTOCOL_VERSION || wire.kind !== 'dsh-link-pairing') {
      throw new LinkError('pairing-unsupported', 'pairing payload speaks an unsupported protocol version')
    }
    if (Date.now() >= pairing.expiresAt) {
      throw new LinkError('pairing-expired', 'pairing payload has expired; start a new pairing on the host')
    }
    const deviceKey = options.deviceKey ?? generateKeyPairSync('ed25519').privateKey
    const body = JSON.stringify({
      code: pairing.code,
      deviceName: options.deviceName,
      devicePublicKey: deviceKeyToSpki(deviceKey),
    })
    const agent = new PinnedAgent(Buffer.from(pairing.spkiFingerprint, 'hex'))
    let response: LinkHttpResponse
    try {
      response = await httpResponse(
        pairing.endpoint,
        agent,
        LINK_PAIR_PATH,
        'POST',
        body,
        { 'content-type': 'application/json' },
        undefined,
      )
    } finally {
      agent.destroy()
    }
    if (response.status !== 200) throw carrierError(response)
    const value = parseLinkPairValue(response.json)
    return new LinkClient({
      endpoint: pairing.endpoint,
      spkiFingerprint: pairing.spkiFingerprint,
      deviceId: value.deviceId,
      deviceKey,
    })
  }

  /**
   * Fetch the authenticated host description.
   * @param signal - aborts the request.
   * @returns host identity, versions, runtime class, and capabilities.
   */
  async describe(signal?: AbortSignal): Promise<LinkHostDescription> {
    const response = await this.request(LINK_DESCRIBE_PATH, 'POST', '', signal)
    if (response.status !== 200) throw carrierError(response)
    return response.json as LinkHostDescription
  }

  /**
   * Call one allowlisted unary Remote endpoint through `/api`.
   * @param endpoint - canonical `<namespace>/<method>` endpoint.
   * @param args - named wire arguments.
   * @param signal - aborts the request.
   * @returns the gateway result value.
   * @throws {@link LinkError} for carrier rejections and gateway error envelopes.
   */
  async call<T = unknown>(endpoint: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await this.request(`/api/${endpoint}`, 'POST', JSON.stringify({
      type: 'client-request',
      rpcId: randomUUID(),
      method: endpoint,
      payload: { args },
    }), signal)
    if (response.status !== 200) throw carrierError(response)
    const envelope = response.json as LinkRpcEnvelope
    /* v8 ignore next 3 -- the shared /api chain always envelopes; only a carrier bug reaches this branch. */
    if (envelope.type !== 'server-response' || envelope.result === undefined) {
      throw new LinkError('internal', 'carrier returned a malformed response envelope')
    }
    if (!envelope.result.ok) {
      throw new LinkError(envelope.result.error.code, envelope.result.error.message, envelope.result.error.details)
    }
    return envelope.result.value as T
  }

  /**
   * Open one allowlisted Remote stream over NDJSON. Reconnect semantics are
   * the caller's: a new `openStream` call on the same endpoint produces a
   * fresh generation, exactly like the browser carrier's stream restart.
   * @param endpoint - Gateway Remote stream endpoint, for example `session/follow` or `$events`.
   * @param args - named wire arguments.
   * @param signal - cancels the stream; iteration ends without error.
   * @returns the stream's values in order.
   * @throws {@link LinkError} for carrier rejections and stream error frames.
   */
  async *openStream(
    endpoint: string,
    args: Record<string, unknown>,
    signal: AbortSignal = new AbortController().signal,
  ): AsyncGenerator {
    const path = `${LINK_STREAM_PREFIX}${encodeURIComponent(endpoint)}`
    const body = JSON.stringify({ args })
    const headers = this.signedHeaders('POST', path, body)
    const url = new URL(this.options.endpoint)
    const opened = new Promise<IncomingMessage>((resolve, reject) => {
      const request = httpsRequest({
        host: url.hostname,
        port: url.port,
        path,
        method: 'POST',
        agent: this.agent,
        headers,
      }, resolve)
      request.on('error', reject)
      const onAbort = (): (void) => {
        request.destroy(signal.reason instanceof Error ? signal.reason : new LinkError('aborted', 'stream was aborted'))
      }
      if (signal.aborted) onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
      request.write(body)
      request.end()
    })
    let response: IncomingMessage
    try {
      response = await opened
    } catch (error) {
      if (signal.aborted) return
      throw error
    }
    if (response.statusCode !== 200) {
      const text = await collectText(response)
      /* v8 ignore next -- node:http always sets statusCode on server responses. */
      throw carrierError(parseHttpResponse(response.statusCode ?? 0, text))
    }
    const lines = new LineQueue()
    let ended = false
    response.on('data', (chunk) => { lines.push((chunk as Buffer).toString('utf8')) })
    response.on('end', () => {
      ended = true
      lines.end()
    })
    // A response that closes without ending is a carrier loss, never a clean
    // stream end: the caller must resubscribe rather than treat silence as
    // completion.
    response.on('close', () => {
      if (!ended && !signal.aborted) lines.end(new LinkError('carrier-lost', 'link carrier stream closed unexpectedly'))
    })
    response.on('error', (error) => {
      if (!signal.aborted) lines.end(error)
    })
    signal.addEventListener('abort', () => { lines.end() }, { once: true })
    while (true) {
      let line: string | undefined
      try {
        line = await lines.next()
      } catch (error) {
        /* v8 ignore next 2 -- only an abort racing the teardown error reaches this guard; both paths end the iteration. */
        if (signal.aborted) return
        throw error
      }
      if (line === undefined) return
      const frame = JSON.parse(line) as LinkStreamFrame
      if (frame.k === 'v') {
        yield frame.v
      } else if (frame.k === 'e') {
        throw new LinkError(frame.c, frame.m, frame.d)
      }
      /* v8 ignore start -- the carrier emits only value and error frames; a foreign frame is a wire bug contained here. */
      else {
        throw new LinkError('internal', `unknown stream frame kind ${JSON.stringify(frame.k)}`)
      }
      /* v8 ignore stop */
    }
  }

  /**
   * Close the pooled TLS connections. The client refuses later calls.
   * @returns resolution after the pool is destroyed.
   */
  dispose(): Promise<void> {
    this.disposed = true
    this.agent.destroy()
    return Promise.resolve()
  }

  private async request(path: string, method: string, body: string, signal?: AbortSignal): Promise<LinkHttpResponse> {
    if (this.disposed) throw new LinkError('disposed', 'link client was disposed')
    return httpResponse(this.options.endpoint, this.agent, path, method, body, this.signedHeaders(method, path, body), signal)
  }

  private signedHeaders(method: string, path: string, body: string): Record<string, string> {
    const timestamp = String(Date.now())
    const digest = createHash('sha256').update(body).digest('hex')
    const signature = edSign(
      null,
      Buffer.from(linkSigningInput(timestamp, method, path, digest)),
      this.options.deviceKey,
    ).toString('base64')
    return {
      [LINK_DEVICE_ID_HEADER]: this.options.deviceId,
      [LINK_TIMESTAMP_HEADER]: timestamp,
      [LINK_SIGNATURE_HEADER]: signature,
      ...(body === '' ? {} : { 'content-type': 'application/json' }),
    }
  }
}

function pinnedSocketOk(socket: tls.TLSSocket, expected: Buffer): boolean {
  try {
    const certificate = socket.getPeerCertificate() as { readonly raw?: Buffer }
    if (certificate.raw == null) return false
    const actual = createHash('sha256')
      .update(new X509Certificate(certificate.raw).publicKey.export({ type: 'spki', format: 'der' }))
      .digest()
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    /* v8 ignore next -- an X509 rejection needs a TLS-accepted but unmodeled certificate; false either way. */
    return false
  }
}

function deviceKeyToSpki(deviceKey: KeyObject): string {
  const privateKey = createPrivateKey({
    key: deviceKey.export({ type: 'pkcs8', format: 'der' }) as Buffer,
    format: 'der',
    type: 'pkcs8',
  })
  const publicKey = createPublicKey(privateKey)
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
}

function carrierError(response: LinkHttpResponse): LinkError {
  const body = response.json as { error?: string; message?: string; reason?: string } | undefined
  /* v8 ignore next 2 -- every carrier rejection is JSON; these arms contain a non-JSON intermediary. */
  return new LinkError(
    body?.error ?? `http-${String(response.status)}`,
    body?.message ?? body?.reason ?? response.text,
  )
}

function httpResponse(
  endpoint: string,
  agent: HttpsAgent,
  path: string,
  method: string,
  body: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<LinkHttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint)
    const request = httpsRequest({
      host: url.hostname,
      port: url.port,
      path,
      method,
      agent,
      headers,
    }, (response) => {
      void collectText(response).then((text) => {
        /* v8 ignore next -- node:http always sets statusCode on server responses. */
        resolve(parseHttpResponse(response.statusCode ?? 0, text))
      }, reject)
    })
    request.on('error', reject)
    if (signal !== undefined) {
      const onAbort = (): (void) => {
        request.destroy(signal.reason instanceof Error ? signal.reason : new LinkError('aborted', 'request was aborted'))
      }
      if (signal.aborted) onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
    }
    if (body !== '') request.write(body)
    request.end()
  })
}

/** The `/api` response envelope: one server-response result. */
interface LinkRpcEnvelope {
  readonly type: string
  readonly result?:
    | { readonly ok: true; readonly value?: unknown }
    | { readonly ok: false; readonly error: LinkStreamFailure }
}

/** The wire failure fields a stream error frame or an RPC error carries. */
interface LinkStreamFailure {
  readonly code: string
  readonly message: string
  readonly details: unknown
}

/** One NDJSON frame of a Remote stream response. */
interface LinkStreamFrame {
  readonly k: string
  readonly v?: unknown
  readonly c: string
  readonly m: string
  readonly d?: unknown
}

/** Push-driven newline queue over one NDJSON response. */
class LineQueue {
  private readonly lines: string[] = []
  private waiter: (() => void) | undefined
  private failure: Error | undefined
  private closed = false
  private pending = ''

  /** Buffer one response chunk; complete lines join the queue.
   * @param chunk - text received from the stream response.
   */
  push(chunk: string): void {
    /* v8 ignore next -- a chunk racing the terminal close is dropped by design. */
    if (this.closed) return
    let rest = this.pending + chunk
    let newline = rest.indexOf('\n')
    while (newline >= 0) {
      const line = rest.slice(0, newline)
      rest = rest.slice(newline + 1)
      newline = rest.indexOf('\n')
      /* v8 ignore next -- every carrier frame ends in exactly one newline, so a blank line never forms. */
      if (line !== '') this.lines.push(line)
    }
    this.pending = rest
    this.wake()
  }

  /** Complete the queue, optionally with a terminal failure.
   * @param error - failure that ended the response.
   */
  end(error?: Error): void {
    if (error !== undefined && this.failure === undefined) this.failure = error
    this.closed = true
    this.wake()
  }

  /** Await the next complete line.
   * @returns the line, or `undefined` when the response ended.
   * @throws the response failure when one ended the stream.
   */
  next(): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const settle = (): (void) => {
        const line = this.lines.shift()
        if (line !== undefined) {
          resolve(line)
          return
        }
        if (this.failure !== undefined) {
          reject(this.failure)
          return
        }
        if (this.closed) {
          resolve(undefined)
          return
        }
        this.waiter = settle
      }
      settle()
    })
  }

  private wake(): void {
    const waiter = this.waiter
    this.waiter = undefined
    waiter?.()
  }
}

function collectText(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
    response.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    response.on('error', reject)
  })
}

function parseHttpResponse(status: number, text: string): LinkHttpResponse {
  let json: unknown
  try {
    json = JSON.parse(text) as unknown
  } catch {
    /* v8 ignore next -- every carrier response is JSON; a non-JSON body means an intermediary answered. */
    json = undefined
  }
  return { status, json, text }
}
