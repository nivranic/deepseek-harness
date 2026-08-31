#!/usr/bin/env node
/**
 * The self-hostable rendezvous shell (nativization plan chapters 68/69):
 * a zero-dependency Node HTTP service mirroring the relay protocol the
 * Android and Apple rendezvous cores pin — register a device, publish a
 * reference-only envelope, drain by poll, or hold the push stream open
 * (connect flushes the pending queue, then live envelopes arrive as NDJSON
 * lines). In-memory by design: the relay holds no session data, no
 * workspace state, and no authority; the host keeps full session
 * authority. Start: `node server.mjs` (PORT env overrides the default
 * 8787). TLS terminates in front (a reverse proxy); APNs/FCM push wakeup
 * rides the pushToken slot when delivery lands.
 */

import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8787)
const devices = new Map()
const pending = new Map()
// One open push stream per rendezvous token; a device with an open stream
// receives envelopes live and keeps nothing queued.
const streams = new Map()

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
      for (const stream of open) stream.write(`${JSON.stringify(envelope)}\n`)
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

const json = (res, status, value) => {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body)
}

const readBody = (req) => new Promise((resolve, reject) => {
  let data = ''
  req.on('data', (chunk) => { data += chunk })
  req.on('end', () => {
    try { resolve(JSON.parse(data)) } catch (error) { reject(error) }
  })
})

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  try {
    if (url.pathname === '/relay/register' && req.method === 'POST') {
      const device = await readBody(req)
      json(res, 200, { token: register(device) })
    } else if (url.pathname === '/relay/publish' && req.method === 'POST') {
      const { accountId, ...envelope } = await readBody(req)
      json(res, 200, { delivered: publish(accountId, envelope) })
    } else if (url.pathname === '/relay/poll' && req.method === 'GET') {
      json(res, 200, poll(url.searchParams.get('token') ?? ''))
    } else if (url.pathname === '/relay/stream' && req.method === 'GET') {
      const token = url.searchParams.get('token') ?? ''
      if (!devices.has(token)) {
        // An unknown token gets the definitive empty answer poll gives:
        // headers, zero lines, clean close.
        res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' })
      // Connect flushes the offline queue, then the stream pushes live.
      for (const envelope of poll(token)) res.write(`${JSON.stringify(envelope)}\n`)
      if (!streams.has(token)) streams.set(token, new Set())
      streams.get(token).add(res)
      res.on('close', () => {
        const open = streams.get(token)
        open?.delete(res)
        if (open?.size === 0) streams.delete(token)
      })
    } else {
      json(res, 404, { error: 'not found' })
    }
  } catch {
    json(res, 400, { error: 'bad request' })
  }
}).listen(PORT, () => {
  console.log(`relay rendezvous listening on :${PORT}`)
})
