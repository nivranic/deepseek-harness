#!/usr/bin/env node
/**
 * The self-hostable rendezvous shell (nativization plan chapters 68/69):
 * a zero-dependency Node HTTP service mirroring the relay protocol the
 * Android and Apple rendezvous cores pin — register a device, publish a
 * reference-only envelope, drain by poll. In-memory by design: the relay
 * holds no session data, no workspace state, and no authority; the host
 * keeps full session authority. Start: `node server.mjs` (PORT env
 * overrides the default 8787). TLS terminates in front (a reverse proxy);
 * APNs/FCM push wakeup rides the pushToken slot when delivery lands.
 */

import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8787)
const devices = new Map()
const pending = new Map()

const register = (device) => {
  const token = `rt-${device.accountId}-${device.deviceId}`
  devices.set(token, device)
  if (!pending.has(token)) pending.set(token, [])
  return token
}

const publish = (accountId, envelope) => {
  let delivered = 0
  for (const [token, device] of devices) {
    if (device.accountId === accountId) {
      pending.get(token).push(envelope)
      delivered += 1
    }
  }
  return delivered
}

const poll = (token) => {
  const queue = pending.get(token) ?? []
  pending.set(token, [])
  return queue
}

const json = (exchange, status, value) => {
  const body = JSON.stringify(value)
  exchange.writeHead(status, { 'content-type': 'application/json' })
  exchange.end(body)
}

const readBody = (exchange) => new Promise((resolve, reject) => {
  let data = ''
  exchange.on('data', (chunk) => { data += chunk })
  exchange.on('end', () => {
    try { resolve(JSON.parse(data)) } catch (error) { reject(error) }
  })
})

createServer(async (exchange, res) => {
  const url = new URL(exchange.url, 'http://localhost')
  try {
    if (url.pathname === '/relay/register' && exchange.method === 'POST') {
      const device = await readBody(exchange)
      json(exchange, 200, { token: register(device) })
    } else if (url.pathname === '/relay/publish' && exchange.method === 'POST') {
      const { accountId, ...envelope } = await readBody(exchange)
      json(exchange, 200, { delivered: publish(accountId, envelope) })
    } else if (url.pathname === '/relay/poll' && exchange.method === 'GET') {
      json(exchange, 200, poll(url.searchParams.get('token') ?? ''))
    } else {
      json(exchange, 404, { error: 'not found' })
    }
  } catch {
    json(exchange, 400, { error: 'bad request' })
  }
}).listen(PORT, () => {
  console.log(`relay rendezvous listening on :${PORT}`)
})
