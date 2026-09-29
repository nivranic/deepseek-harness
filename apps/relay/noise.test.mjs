/** Noise transport nonce boundaries and authentication retries over the real crypto implementation. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { NoiseCipherState, NoiseHandshake, NoiseNonceExhaustedError } from './noise.mjs'

const vectors = JSON.parse(readFileSync(new URL('./vectors/relay-noise-vectors.json', import.meta.url), 'utf8'))
const boundary = vectors.nonceBoundaries
const key = Buffer.from(boundary.key, 'hex')
const ad = Buffer.from(boundary.ad, 'hex')
const payload = Buffer.from(boundary.payload, 'hex')
const exhausted = (1n << 64n) - 1n

test('the shared fixtures use four distinct pinned X25519 scalars', () => {
  assert.equal(new Set(Object.values(vectors.keys)).size, 4)
})

test('the Node handshake reproduces the shared native fixture', () => {
  const pinned = role => {
    const prefix = role === 'initiator' ? 'initiator' : 'responder'
    return new NoiseHandshake(role, Buffer.from(vectors.keys[`${prefix}Static`], 'hex'), Buffer.from(vectors.keys[`${prefix}Ephemeral`], 'hex'))
  }
  const alice = pinned('initiator')
  const bob = pinned('responder')
  const first = alice.writeMessage1()
  assert.equal(first.toString('hex'), vectors.handshake.msg1)
  bob.readMessage1(first)
  const second = bob.writeMessage2()
  assert.equal(second.toString('hex'), vectors.handshake.msg2)
  alice.readMessage2(second)
  const third = alice.writeMessage3()
  assert.equal(third.toString('hex'), vectors.handshake.msg3)
  bob.readMessage3(third)
  assert.equal(alice.transcriptHash.toString('hex'), vectors.handshake.channelBindingAfterMsg3)
  assert.equal(bob.transcriptHash.toString('hex'), vectors.handshake.channelBindingAfterMsg3)
})

for (const vector of boundary.vectors) {
  test(`seals and opens the shared frame at nonce ${vector.counter}`, () => {
    const counter = BigInt(vector.counter)
    const sender = new NoiseCipherState(key)
    const receiver = new NoiseCipherState(key)
    sender.n = counter
    receiver.n = counter
    const frame = sender.encryptWithAd(ad, payload)
    assert.equal(frame.toString('hex'), vector.frame)
    assert.equal(sender.n, counter + 1n)
    const tampered = Buffer.from(frame)
    tampered[0] ^= 1
    assert.throws(() => receiver.decryptWithAd(ad, tampered))
    assert.equal(receiver.n, counter)
    assert.deepEqual(receiver.decryptWithAd(ad, frame), payload)
    assert.equal(receiver.n, counter + 1n)
  })
}

test('successive nonces remain distinct beyond Number integer precision', () => {
  const sender = new NoiseCipherState(key)
  sender.n = 1n << 53n
  const first = sender.encryptWithAd(ad, payload)
  const second = sender.encryptWithAd(ad, payload)
  assert.notDeepEqual(first, second)
  assert.equal(sender.n, (1n << 53n) + 2n)
})

test('the final usable nonce succeeds once and every later call refuses the reserved value', () => {
  const sender = new NoiseCipherState(key)
  const receiver = new NoiseCipherState(key)
  sender.n = exhausted - 1n
  receiver.n = exhausted - 1n
  const frame = sender.encryptWithAd(ad, payload)
  assert.deepEqual(receiver.decryptWithAd(ad, frame), payload)
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.throws(() => sender.encryptWithAd(ad, payload), NoiseNonceExhaustedError)
    assert.throws(() => receiver.decryptWithAd(ad, frame), NoiseNonceExhaustedError)
    assert.equal(sender.n, exhausted)
    assert.equal(receiver.n, exhausted)
  }
})
