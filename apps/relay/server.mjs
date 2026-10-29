#!/usr/bin/env node
/**
 * The self-hostable rendezvous shell (nativization plan chapters 68/69):
 * a zero-dependency Node HTTP service mirroring the relay protocol the
 * Android and Apple rendezvous cores pin — register a device, publish a
 * reference-only envelope, drain by poll, or hold the push stream open
 * (connect flushes the pending queue, then live envelopes arrive as
 * encrypted frames). Presence rides the streams: a device is online while
 * it holds a stream open; same-account streams receive device-online/
 * offline frames, and the presence endpoint answers the account's roster
 * with derived online state. In-memory by design: the relay holds no
 * session data, no workspace state, and no authority; the host keeps full
 * session authority.
 *
 * Every rendezvous endpoint is Noise-encrypted (noise.mjs): a client
 * completes Noise_XX over /relay/noise/hello + /relay/noise/complete, then
 * addresses the endpoints with the x-relay-session header (the handshake
 * transcript hash after message 2) and framed AEAD bodies. The handshake
 * endpoints themselves stay plaintext — Noise conceals static keys, so the
 * messages are public by design. Sessions idle out after 15 minutes; the
 * reply is 410 and the client handshakes again. Start: `node server.mjs`
 * (PORT env overrides the default 8787). APNs/FCM push wakeup rides the
 * pushToken slot when delivery lands.
 */

import { createServer } from 'node:http'
import { NoiseCipherState, NoiseHandshake, decodeFrames, encodeFrame } from './noise.mjs'

const PORT = Number(process.env.PORT ?? 8787)
const SESSION_IDLE_MS = 15 * 60 * 1000
const EMPTY = Buffer.alloc(0)

const devices = new Map()
const pending = new Map()
// One open push stream per rendezvous token; a device with an open stream
// receives envelopes live and keeps nothing queued.
const streams = new Map()
// Noise sessions by hex transcript hash: pending handshakes first, then the
// split cipher states once message 3 lands.
const sessions = new Map()

const register = (device) => {
  const token = `rt-${device.accountId}-${device.deviceId}`
  devices.set(token, device)
  if (!pending.has(token)) pending.set(token, [])
  return token
}

const publish = (accountId, envelope) => {
  let delivered = 0
  for (const [token, device] of devices) {
    if (device.accountId !== accountId) continue
    const open = streams.get(token)
    if (open?.size) {
      for (const writeEvent of open) writeEvent(envelope)
    } else {
      pending.get(token).push(envelope)
    }
    delivered += 1
  }
  return delivered
}

const poll = (token) => {
  const queue = pending.get(token) ?? []
  pending.set(token, [])
  return queue
}

const roster = (accountId) =>
  [...devices.entries()]
    .filter(([, device]) => device.accountId === accountId)
    .map(([token, device]) => ({
      deviceId: device.deviceId,
      platform: device.platform,
      online: (streams.get(token)?.size ?? 0) > 0,
    }))

const writePresence = (accountId, exceptToken, deviceId, online) => {
  const value = { type: 'presence', deviceId, online }
  for (const [token, open] of streams) {
    if (token === exceptToken) continue
    if (devices.get(token)?.accountId !== accountId) continue
    for (const writeEvent of open) writeEvent(value)
  }
}

const json = (res, status, value) => {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body)
}

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []
  req.on('data', chunk => { chunks.push(chunk) })
  req.on('end', () => { resolve(Buffer.concat(chunks)) })
  req.on('error', reject)
})

const retireIdleSessions = () => {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.last > SESSION_IDLE_MS) sessions.delete(id)
  }
}

/** Decrypt one framed request body into its JSON value. */
const readEncryptedRequest = (session, body) => {
  const frames = decodeFrames(body)
  if (frames.length !== 1) throw new Error('expected exactly one request frame')
  return JSON.parse(session.recv.decryptWithAd(EMPTY, frames[0]).toString('utf8'))
}

/** One encrypted frame as a complete response body. */
const frameResponse = (session, res, value) => {
  const body = encodeFrame(session.send.encryptWithAd(EMPTY, Buffer.from(JSON.stringify(value))))
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' })
  res.end(body)
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  try {
    if (url.pathname === '/relay/noise/hello' && req.method === 'POST') {
      retireIdleSessions()
      const handshake = new NoiseHandshake('responder')
      handshake.readMessage1(await readBody(req))
      const message = handshake.writeMessage2()
      sessions.set(handshake.transcriptHash.toString('hex'), { phase: 'pending', handshake, last: Date.now() })
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-relay-session': handshake.transcriptHash.toString('hex') })
      res.end(message)
    } else if (url.pathname === '/relay/noise/complete' && req.method === 'POST') {
      const session = sessions.get(req.headers['x-relay-session'] ?? '')
      if (session === undefined || session.phase !== 'pending') {
        json(res, 410, { error: 'unknown relay session' })
        return
      }
      session.handshake.readMessage3(await readBody(req))
      const { send, recv } = session.handshake.split()
      const ready = { phase: 'ready', send, recv, last: Date.now() }
      sessions.set(req.headers['x-relay-session'], ready)
      frameResponse(ready, res, { ok: true })
    } else if (url.pathname === '/relay/register' && req.method === 'POST') {
      const session = established(req)
      const token = register(readEncryptedRequest(session, await readBody(req)))
      session.last = Date.now()
      frameResponse(session, res, { token })
    } else if (url.pathname === '/relay/publish' && req.method === 'POST') {
      const session = established(req)
      const { accountId, ...envelope } = readEncryptedRequest(session, await readBody(req))
      const delivered = publish(accountId, envelope)
      session.last = Date.now()
      frameResponse(session, res, { delivered })
    } else if (url.pathname === '/relay/poll' && req.method === 'POST') {
      const session = established(req)
      const { token } = readEncryptedRequest(session, await readBody(req))
      const queue = poll(token)
      session.last = Date.now()
      const body = Buffer.concat(queue.map(envelope =>
        encodeFrame(session.send.encryptWithAd(EMPTY, Buffer.from(JSON.stringify(envelope))))))
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(body)
    } else if (url.pathname === '/relay/presence' && req.method === 'POST') {
      const session = established(req)
      const { accountId } = readEncryptedRequest(session, await readBody(req))
      session.last = Date.now()
      frameResponse(session, res, roster(accountId))
    } else if (url.pathname === '/relay/stream' && req.method === 'POST') {
      const session = established(req)
      const { token, streamKey } = readEncryptedRequest(session, await readBody(req))
      session.last = Date.now()
      // The stream encrypts under the one-time key the request carried, not
      // the session states: HTTP responses and live stream pushes would
      // otherwise interleave nondeterministically over one counter.
      const stream = new NoiseCipherState(Buffer.from(streamKey, 'hex'))
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' })
      if (!devices.has(token)) {
        // An unknown token gets the definitive empty answer poll gives:
        // headers, zero frames, clean close.
        res.end()
        return
      }
      const writer = (frame) => { res.write(frame) }
      const writeEvent = (value) => writer(encodeFrame(stream.encryptWithAd(EMPTY, Buffer.from(JSON.stringify(value)))))
      // Connect flushes the offline queue, then the stream pushes live.
      for (const envelope of poll(token)) writeEvent(envelope)
      if (!streams.has(token)) streams.set(token, new Set())
      streams.get(token).add(writeEvent)
      writePresence(devices.get(token).accountId, token, devices.get(token).deviceId, true)
      res.on('close', () => {
        const open = streams.get(token)
        open?.delete(writeEvent)
        if (open?.size === 0) {
          streams.delete(token)
          const device = devices.get(token)
          if (device) writePresence(device.accountId, token, device.deviceId, false)
        }
      })
    } else {
      json(res, 404, { error: 'not found' })
    }
  } catch (error) {
    const status = error?.statusCode ?? 400
    json(res, status, { error: status === 410 ? 'unknown relay session' : 'bad request' })
  }
}).listen(PORT, () => {
  console.log(`relay rendezvous listening on :${PORT}`)
})

/** The established Noise session a protected endpoint requires, or 410. */
function established(req) {
  const session = sessions.get(req.headers['x-relay-session'] ?? '')
  if (session === undefined || session.phase !== 'ready') {
    const error = new Error('unknown relay session')
    error.statusCode = 410
    throw error
  }
  return session
}
