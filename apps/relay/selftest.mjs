#!/usr/bin/env node
/**
 * Local selftest for the relay transport: Noise_XX round trips, framing
 * edge cases, and the full HTTP flow (register/publish/poll/presence/
 * stream) against this repo's server.mjs and client.mjs over a real local
 * socket. Run: `node selftest.mjs` (exit 0 = all assertions hold). Not a
 * CI gate — the lanes own the Kotlin and Swift ports; this pins the node
 * reference implementation they are verified against.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { NoiseHandshake, decodeFrames, encodeFrame } from './noise.mjs'

const hex = (buf) => Buffer.from(buf).toString('hex')

// --- Noise_XX round trip ----------------------------------------------------

{
  const alice = new NoiseHandshake('initiator')
  const bob = new NoiseHandshake('responder')
  const msg1 = alice.writeMessage1()
  assert.equal(msg1.length, 32, 'msg1 is one unkeyed ephemeral key')
  bob.readMessage1(msg1)
  const msg2 = bob.writeMessage2()
  assert.equal(msg2.length, 96, 'msg2 is e + tagged static + tagged empty payload')
  alice.readMessage2(msg2)
  assert.equal(hex(alice.transcriptHash), hex(bob.transcriptHash), 'session id agrees after msg2')
  const msg3 = alice.writeMessage3()
  assert.equal(msg3.length, 64, 'msg3 is tagged static + tagged empty payload')
  bob.readMessage3(msg3)
  assert.equal(hex(alice.transcriptHash), hex(bob.transcriptHash), 'channel binding agrees after msg3')
  const a = alice.split()
  const b = bob.split()
  const sealed = a.send.encryptWithAd(Buffer.alloc(0), Buffer.from('ping'))
  assert.equal(hex(b.recv.decryptWithAd(Buffer.alloc(0), sealed)), hex(Buffer.from('ping')))
  const reply = b.send.encryptWithAd(Buffer.alloc(0), Buffer.from('pong'))
  assert.equal(hex(a.recv.decryptWithAd(Buffer.alloc(0), reply)), hex(Buffer.from('pong')))
  assert.throws(() => b.recv.decryptWithAd(Buffer.from('x'), sealed), undefined, 'wrong AAD fails the tag')
  const flipped = Buffer.from(sealed)
  flipped[0] ^= 1
  assert.throws(() => b.recv.decryptWithAd(Buffer.alloc(0), flipped), undefined, 'tampered ciphertext fails the tag')
}

// --- framing ----------------------------------------------------------------

{
  assert.deepEqual(decodeFrames(Buffer.alloc(0)), [], 'empty body decodes no frames')
  const one = encodeFrame(Buffer.from([1, 2, 3]))
  assert.deepEqual(decodeFrames(Buffer.concat([one, one])).map(hex), [hex([1, 2, 3]), hex([1, 2, 3])])
  assert.throws(() => decodeFrames(one.subarray(0, 3)), /truncated/)
  assert.throws(() => decodeFrames(Buffer.from([0, 4, 9])), /truncated/)
}

// --- full HTTP flow over a real local socket ---------------------------------

const PORT = 18787 + Math.floor(Math.random() * 1000)
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' })
try {
  const base = `http://127.0.0.1:${PORT}`
  let ready = false
  for (let round = 0; round < 100 && !ready; round++) {
    try {
      const probe = await fetch(`${base}/relay/register`, { method: 'POST' })
      await probe.arrayBuffer()
      ready = true
    } catch {
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  assert.ok(ready, 'server came up')

  const { RelayClient } = await import('./client.mjs')
  const client = new RelayClient(base)
  const token = await client.register({ accountId: 'acct', deviceId: 'phone', platform: 'android' })
  assert.equal(token, 'rt-acct-phone')
  const delivered = await client.publish('acct', { kind: 'approval-waiting', sessionId: 's1', eventId: 'e1' })
  assert.equal(delivered, 1)
  const polled = await client.poll(token)
  assert.deepEqual(polled, [{ kind: 'approval-waiting', sessionId: 's1', eventId: 'e1' }])
  assert.deepEqual(await client.poll(token), [], 'poll drains')

  const roster = await client.presence('acct')
  assert.deepEqual(roster, [{ deviceId: 'phone', platform: 'android', online: false }])

  const events = []
  const stream = client.stream(token)
  const pumping = (async () => { for await (const event of stream) events.push(event) })()
  await new Promise(resolve => setTimeout(resolve, 200))
  await client.publish('acct', { kind: 'task-completed', sessionId: 's1', turn: 2 })
  await new Promise(resolve => setTimeout(resolve, 200))
  assert.deepEqual(events, [{ kind: 'task-completed', sessionId: 's1', turn: 2 }], 'live envelope arrives through the encrypted stream')
  stream.close()
  await pumping
  assert.deepEqual(await client.presence('acct'), [{ deviceId: 'phone', platform: 'android', online: false }], 'stream close flips presence offline')

  // A second client sees the roster and presence lines cross-device.
  const pad = new RelayClient(base)
  const padToken = await pad.register({ accountId: 'acct', deviceId: 'pad', platform: 'ios' })
  const padEvents = []
  const padStream = pad.stream(padToken)
  const padPumping = (async () => { for await (const event of padStream) padEvents.push(event) })()
  await new Promise(resolve => setTimeout(resolve, 200))
  await client.publish('acct', { kind: 'question-waiting', sessionId: 's9', eventId: 'e2' })
  await new Promise(resolve => setTimeout(resolve, 200))
  assert.deepEqual(padEvents, [{ kind: 'question-waiting', sessionId: 's9', eventId: 'e2' }])
  padStream.close()
  await padPumping

  // Unknown session id is refused before any decryption happens.
  const refused = await fetch(`${base}/relay/register`, {
    method: 'POST',
    headers: { 'x-relay-session': 'deadbeef' },
    body: Buffer.alloc(0),
  })
  assert.equal(refused.status, 410, 'unknown relay session refuses with 410')
  await refused.arrayBuffer()

  // Tampering with one frame byte must fail loud client-side.
  {
    const handshake = await fetch(`${base}/relay/noise/hello`, {
      method: 'POST',
      body: new NoiseHandshake('initiator').writeMessage1(),
    })
    assert.equal(handshake.status, 200)
    await handshake.arrayBuffer()
    const session = handshake.headers.get('x-relay-session')
    const complete = await fetch(`${base}/relay/noise/complete`, {
      method: 'POST',
      headers: { 'x-relay-session': session },
      body: Buffer.from([0]),
    })
    assert.equal(complete.status, 400, 'a broken message 3 fails the handshake')
    await complete.arrayBuffer()
  }
} finally {
  server.kill()
}

console.log('relay selftest: all assertions hold')
