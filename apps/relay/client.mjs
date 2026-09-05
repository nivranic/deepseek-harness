/**
 * The node reference consumer of the Noise-encrypted relay protocol — the
 * executable specification the Kotlin and Apple RelayClients mirror, and
 * the actor selftest.mjs drives. One Noise_XX session per instance,
 * established lazily on the first call: hello → read msg2 → verify the
 * server-assigned session id equals our own transcript hash → complete →
 * consume the encrypted ack frame. Request/response bodies are single AEAD
 * frames; the stream body is a sequence of frames decrypted as they
 * arrive. Calls serialize through response consumption. A failed exchange
 * discards its session without replay; the next explicit call handshakes.
 */

import { randomBytes } from 'node:crypto'
import { NoiseCipherState, NoiseHandshake, decodeFrames, encodeFrame } from './noise.mjs'

const EMPTY = Buffer.alloc(0)

/** Split one buffered body into complete frames, keeping any tail. */
function takeFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset + 2 <= buffer.length) {
    const length = buffer.readUInt16BE(offset)
    if (offset + 2 + length > buffer.length) break
    frames.push(buffer.subarray(offset + 2, offset + 2 + length))
    offset += 2 + length
  }
  return { frames, rest: buffer.subarray(offset) }
}

export class RelayClient {
  #exchangeTail = Promise.resolve()

  /** @param {string} baseUrl - the relay service root, e.g. http://host:8787. */
  constructor(baseUrl) {
    this.baseUrl = baseUrl
    this.session = null
  }

  async #ensure() {
    if (this.session) return
    const handshake = new NoiseHandshake('initiator')
    const hello = await fetch(`${this.baseUrl}/relay/noise/hello`, { method: 'POST', body: handshake.writeMessage1() })
    if (!hello.ok) throw new Error(`relay hello failed: HTTP ${hello.status}`)
    const id = hello.headers.get('x-relay-session') ?? ''
    handshake.readMessage2(Buffer.from(await hello.arrayBuffer()))
    if (id !== handshake.transcriptHash.toString('hex')) {
      throw new Error('relay session id does not match the handshake transcript')
    }
    const complete = await fetch(`${this.baseUrl}/relay/noise/complete`, {
      method: 'POST',
      headers: { 'x-relay-session': id },
      body: handshake.writeMessage3(),
    })
    if (!complete.ok) throw new Error(`relay complete failed: HTTP ${complete.status}`)
    const { send, recv } = handshake.split()
    const ack = decodeFrames(Buffer.from(await complete.arrayBuffer()))
    if (ack.length !== 1) throw new Error('relay key confirmation failed')
    const confirmed = JSON.parse(recv.decryptWithAd(EMPTY, ack[0]).toString('utf8'))
    if (confirmed?.ok !== true) throw new Error('relay key confirmation failed')
    this.session = { id, send, recv }
  }

  /** Ordered HTTP exchanges share counters; a failed exchange retires its cached keys without replay. */
  #withSession(operation) {
    const next = this.#exchangeTail.then(async () => {
      await this.#ensure()
      const session = this.session
      try {
        return await operation(session)
      } catch (error) {
        if (this.session === session) this.session = null
        throw error
      }
    })
    this.#exchangeTail = next.catch(() => { /* Queue readiness ignores the error already returned to this caller. */ })
    return next
  }

  async #post(path, session, body, signal) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST', headers: { 'x-relay-session': session.id }, body, signal,
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`relay ${path} failed: HTTP ${response.status}`)
    }
    return response
  }

  /** One framed request/response round trip. */
  async #call(path, request) {
    return await this.#withSession(async session => {
      const body = encodeFrame(session.send.encryptWithAd(EMPTY, Buffer.from(JSON.stringify(request))))
      const response = await this.#post(path, session, body)
      const frames = decodeFrames(Buffer.from(await response.arrayBuffer()))
      if (frames.length !== 1) throw new Error(`relay ${path} answered ${frames.length} frames`)
      return JSON.parse(session.recv.decryptWithAd(EMPTY, frames[0]).toString('utf8'))
    })
  }

  /**
   * Register one device at the rendezvous service.
   * @returns the rendezvous token polling and streaming require.
   */
  async register(device) {
    const request = { accountId: device.accountId, deviceId: device.deviceId, platform: device.platform }
    if (device.pushToken !== undefined) request.pushToken = device.pushToken
    return (await this.#call('/relay/register', request)).token
  }

  /**
   * Publish one reference envelope to an account's devices.
   * @returns how many devices the envelope reached.
   */
  async publish(accountId, envelope) {
    return (await this.#call('/relay/publish', { accountId, ...envelope })).delivered
  }

  /** Drain the device's pending envelopes in arrival order. */
  async poll(token) {
    return await this.#withSession(async session => {
      const response = await this.#post('/relay/poll', session, encodeFrame(session.send.encryptWithAd(EMPTY, Buffer.from(JSON.stringify({ token })))))
      return decodeFrames(Buffer.from(await response.arrayBuffer()))
        .map(frame => JSON.parse(session.recv.decryptWithAd(EMPTY, frame).toString('utf8')))
    })
  }

  /**
   * The account roster with each device's stream-derived online state.
   * @returns the registered devices, in registration order.
   */
  async presence(accountId) {
    return await this.#call('/relay/presence', { accountId })
  }

  /**
   * Hold the push stream open: connect flushes the pending queue as its
   * first frames, then every live publish to this device and every
   * same-account device's presence change arrives as one encrypted frame;
   * the iterator ends when the service closes the stream. An async
   * generator suspended waiting for the next frame cannot observe
   * `return()` — the consumer tears the stream down with {@link
   * AsyncStreamWithClose.close}, which aborts the underlying body and ends
   * the iteration promptly.
   * @returns the stream events (envelope objects or presence lines) with a
   * `close()` teardown handle.
   */
  stream(token) {
    const abort = new AbortController()
    const generator = this.#streamEvents(token, abort)
    generator.close = () => { abort.abort() }
    return generator
  }

  async *#streamEvents(token, abort) {
    // The stream rides its own one-time key so live pushes never share a
    // counter with HTTP responses on the session states.
    const streamKey = randomBytes(32)
    const decrypt = new NoiseCipherState(streamKey)
    const closed = new Promise((_, reject) => {
      abort.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('relay stream closed locally'), { code: 'RELAY_STREAM_CLOSED' }))
      })
    })
    closed.catch(() => { /* Local close can precede the response head; the stream owner handles cancellation below. */ })
    try {
      const response = await this.#withSession(session => this.#post(
        '/relay/stream', session,
        encodeFrame(session.send.encryptWithAd(EMPTY, Buffer.from(JSON.stringify({ token, streamKey: streamKey.toString('hex') })))),
        abort.signal,
      ))
      const chunks = response.body[Symbol.asyncIterator]()
      let buffer = Buffer.alloc(0)
      while (true) {
        const { value: chunk, done } = await Promise.race([chunks.next(), closed])
        if (done) {
          if (buffer.length !== 0) throw new Error('relay noise stream ended inside a frame')
          break
        }
        buffer = Buffer.concat([buffer, chunk])
        const { frames, rest } = takeFrames(buffer)
        buffer = rest
        for (const frame of frames) {
          yield JSON.parse(decrypt.decryptWithAd(EMPTY, frame).toString('utf8'))
        }
      }
    } catch (error) {
      if (!abort.signal.aborted && error?.code !== 'RELAY_STREAM_CLOSED') throw error
    } finally {
      abort.abort()
    }
  }
}

/**
 * The async iterator `RelayClient.stream` returns: stream events plus the
 * `close()` teardown consumers call instead of relying on generator
 * `return()`, which cannot interrupt a wait for the next frame.
 * @typedef {AsyncGenerator<object> & { close(): void }} AsyncStreamWithClose
 */
