/** Opt-in encrypted native Connection source; Gateway owns all dispatch and device permissions. */

import { createServer } from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { bridgeConnectionHttp, createRpcFetchHandler } from '@deepseek-ai/dsh-client-connection'
import { REMOTE_STREAM_MUX_PATH, RemoteStreamMuxServer } from '@deepseek-ai/dsh-api-gateway'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import { loadTlsIdentity, type CertificateConfig } from './tls-identity.ts'

/** Explicit deployment bounds for the opt-in listener. */
export interface Config extends CertificateConfig {
  /** Literal listen address; all-interface binds require an explicit choice. */
  readonly host: '127.0.0.1' | '0.0.0.0' | '::1' | '::'
  /** TCP port; zero requests an OS-assigned port. */
  readonly port: number
  /** Maximum simultaneous TCP connections, including TLS handshakes. */
  readonly maxConnections: number
  /** Maximum complete buffered HTTP RPC body in bytes. */
  readonly maxRequestBodyBytes: number
  /** Maximum complete incoming WebSocket message in bytes. */
  readonly maxWebSocketMessageBytes: number
  /** Maximum live logical streams on one WebSocket. */
  readonly maxStreamsPerConnection: number
  /** Deadline for receiving a complete HTTP request. */
  readonly requestTimeoutMs: number
  /** Deadline for receiving HTTP request headers; must not exceed requestTimeoutMs. */
  readonly headersTimeoutMs: number
  /** Deadline for completing the TLS handshake. */
  readonly handshakeTimeoutMs: number
  /** WebSocket Ping interval; the mux terminates unresponsive connections. */
  readonly websocketHeartbeatIntervalMs: number
}

/** Local operator facts for constructing an out-of-band pairing payload. */
export interface NativeRemoteInfo {
  /** Configured literal interface; an all-interface address is not a pairing destination. */
  readonly bindHost: Config['host']
  /** Actual TCP port, including an OS-assigned value. */
  readonly port: number
  /** Pin the leaf certificate's SPKI, independently of its DNS name or issuing CA. */
  readonly spkiFingerprint: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Opt-in native TLS listener; its metadata is local operator state. */
    nativeRemote: NativeRemoteService
  }
}

const timer = () => z.number().step(1).min(1).max(2_147_483_647).required()
const limit = () => z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required()

function browserRequest(request: IncomingMessage): boolean {
  return request.headers.origin !== undefined || Object.keys(request.headers).some(name => name.startsWith('sec-fetch-'))
}

/** A separately configured HTTPS listener with no browser assets, cookies, or local exact Fetch routes. */
export class NativeRemoteService extends Service {
  static inject = ['credentials', 'typertGateway', 'deviceTrust']
  static Config: z<Config> = z.object({
    host: z.union([z.const('127.0.0.1'), z.const('0.0.0.0'), z.const('::1'), z.const('::')]).required(),
    port: z.natural().max(65535).required(),
    maxConnections: limit(), maxRequestBodyBytes: limit(), maxWebSocketMessageBytes: limit(), maxStreamsPerConnection: limit(),
    requestTimeoutMs: timer(), headersTimeoutMs: timer(), handshakeTimeoutMs: timer(), websocketHeartbeatIntervalMs: timer(),
    certificateLifetimeDays: z.number().min(1).max(3650).required(),
    certificateRenewBeforeDays: z.number().min(0).required(),
  })

  private info: NativeRemoteInfo | undefined

  /**
   * Configure the native listener without opening a port before credential readiness.
   * @param ctx - owning Host context with Gateway, Device Trust, and credentials.
   * @param config - validated listener and certificate bounds.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'nativeRemote')
    if (config.headersTimeoutMs > config.requestTimeoutMs) {
      throw new Error('native-remote: headersTimeoutMs must not exceed requestTimeoutMs')
    }
    if (config.certificateRenewBeforeDays >= config.certificateLifetimeDays) {
      throw new Error('native-remote: certificateRenewBeforeDays must be shorter than certificateLifetimeDays')
    }
  }

  /**
   * Read the bound port and certificate pin for the local operator.
   * @returns public identity facts, without certificate or private-key material.
   * @throws while the listener is not ready or has been disposed.
   */
  describe(): NativeRemoteInfo {
    if (this.info === undefined) throw new Error('native-remote: listener is not ready')
    return { ...this.info }
  }

  /** Load a durable identity before accepting native requests; teardown drains every owned connection. */
  protected async [Service.init](): Promise<void> {
    const identity = await loadTlsIdentity(this.ctx.credentials, this.config)
    const adapter = this.ctx.typertGateway.deviceConnection
    const handler = createRpcFetchHandler('/api', adapter.rpc)
    const mux = new RemoteStreamMuxServer(adapter.stream.open, adapter.stream.failure, this.config.websocketHeartbeatIntervalMs, {
      maxPayloadBytes: this.config.maxWebSocketMessageBytes, maxStreamsPerConnection: this.config.maxStreamsPerConnection,
    })
    const sockets = new Set<Duplex>()
    const pending = new Set<Promise<void>>()
    const server = createServer({
      cert: identity.certificatePem, key: identity.privateKeyPem, minVersion: 'TLSv1.2',
      handshakeTimeout: this.config.handshakeTimeoutMs,
      headersTimeout: this.config.headersTimeoutMs, requestTimeout: this.config.requestTimeoutMs,
      connectionsCheckingInterval: Math.min(this.config.headersTimeoutMs, this.config.requestTimeoutMs),
    }, (request, response) => {
      if (browserRequest(request)) {
        response.writeHead(403, { connection: 'close' })
        response.end('forbidden')
        return
      }
      const done = bridgeConnectionHttp(request, response, handler, this.config.maxRequestBodyBytes).catch(() => {
        // Gateway failures already have RPC envelopes; a broken HTTP transfer ends this response.
        response.destroy()
      })
      pending.add(done)
      void done.then(() => { pending.delete(done) })
    })
    server.maxConnections = this.config.maxConnections
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.once('close', () => { sockets.delete(socket) })
    })
    server.on('upgrade', (request, socket, head) => {
      if (browserRequest(request) || request.url !== REMOTE_STREAM_MUX_PATH) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        return
      }
      mux.handleUpgrade(request, socket, head)
    })
    this.ctx.effect(() => async () => {
      this.info = undefined
      const closed = new Promise<void>((resolve) => {
        // close() also completes teardown when a failed listen never acquired a port.
        server.close(() => { resolve() })
      })
      for (const socket of sockets) socket.destroy()
      await Promise.all([mux.close(), closed])
      await Promise.all(pending)
    }, 'native-remote: TLS listener')
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => { reject(error) }
      server.once('error', onError)
      server.listen(this.config.port, this.config.host, () => {
        server.off('error', onError)
        const address = server.address() as AddressInfo
        this.info = { bindHost: this.config.host, port: address.port, spkiFingerprint: identity.spkiFingerprint }
        resolve()
      })
    })
  }
}

export default NativeRemoteService
