/** Test-only native client: pin TLS before HTTP framing or a WebSocket handshake can send bytes. */
import { createHash, X509Certificate } from 'node:crypto'
import { once } from 'node:events'
import { request } from 'node:http'
import { connect, type TLSSocket } from 'node:tls'
import WebSocket from 'ws'
import type { Page } from 'playwright'
import type { AdmitDeviceRequest } from '@deepseek-ai/dsh-api-device-trust/types'
import type { NativeRemoteInfo } from '@deepseek-ai/dsh-api-native-remote'

export class NativeTestClient {
  private readonly sockets = new Set<TLSSocket>()
  private readonly websockets = new Set<WebSocket>()

  constructor(private readonly info: NativeRemoteInfo) {}

  private async socket(): Promise<TLSSocket> {
    const socket = connect({ host: '127.0.0.1', port: this.info.port, rejectUnauthorized: false, minVersion: 'TLSv1.2' })
    this.sockets.add(socket)
    socket.once('close', () => { this.sockets.delete(socket) })
    await once(socket, 'secureConnect')
    const certificate = new X509Certificate(socket.getPeerCertificate().raw)
    const actual = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
    if (actual !== this.info.spkiFingerprint) {
      socket.destroy()
      throw new Error('native test client: Host pin mismatch')
    }
    return socket
  }

  async post(path: string, body: string): Promise<Response> {
    const socket = await this.socket()
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: this.info.port, path, method: 'POST', createConnection: () => socket,
        headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), connection: 'close' },
      }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        response.on('error', reject)
        response.on('end', () => { resolve(new Response(Buffer.concat(chunks).toString(), { status: response.statusCode ?? 500 })) })
      })
      req.on('error', reject)
      req.end(body)
    })
  }

  async mux(): Promise<WebSocket> {
    const socket = await this.socket()
    const ws = new WebSocket(`wss://127.0.0.1:${this.info.port}/api/remote.mux`, { createConnection: () => socket })
    this.websockets.add(ws)
    ws.once('close', () => { this.websockets.delete(ws) })
    await once(ws, 'open')
    return ws
  }

  /**
   * Forward browser streams through the signed native carrier.
   * @param page - browser page before its first Host connection.
   * @param admission - fresh signed device admission for each stream.
   * @param onFailure - owner collecting asynchronous carrier failures.
   */
  async bridgeStreams(page: Page, admission: () => AdmitDeviceRequest, onFailure: (error: unknown) => void): Promise<void> {
    await page.routeWebSocket('**/api/remote.mux', async (socket) => {
      const server = await this.mux()
      server.on('message', (data) => {
        const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data
        socket.send(bytes.toString())
      })
      server.on('close', () => { void socket.close().catch(onFailure) })
      server.on('error', () => {
        void socket.close({ code: 1011, reason: 'native test carrier failed' }).catch(onFailure)
      })
      socket.onClose(() => { server.close() })
      socket.onMessage((message) => {
        const frame = JSON.parse(message.toString()) as {
          type?: string
          endpoint?: string
          payload?: { args: Record<string, unknown>; apiProtocolVersion?: number; device?: AdmitDeviceRequest }
        }
        if (frame.type === 'open' && frame.payload !== undefined) {
          frame.payload.apiProtocolVersion = 2
          if (frame.endpoint === '$events') frame.payload.args.device = admission()
          else frame.payload.device = admission()
        }
        server.send(JSON.stringify(frame))
      })
    })
  }

  async close(): Promise<void> {
    const closed = [...this.websockets, ...this.sockets].map(socket => new Promise<void>((resolve) => {
      socket.once('close', () => { resolve() })
    }))
    for (const ws of this.websockets) ws.terminate()
    for (const socket of this.sockets) socket.destroy()
    await Promise.all(closed)
  }
}
