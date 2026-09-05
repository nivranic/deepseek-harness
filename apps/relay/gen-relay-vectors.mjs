#!/usr/bin/env node
/**
 * Regenerates the fixed-key Noise_XX test vectors every port replays:
 * four pinned X25519 scalars drive one full handshake, and the split
 * cipher states seal a spread of payloads in both directions. The Kotlin
 * and Apple Noise ports must reproduce these bytes exactly (handshake
 * messages, session id, channel binding, split keys, and frames) — that
 * byte-level agreement complements the real HTTP corpus in the repository
 * test gate. Run: `node gen-relay-vectors.mjs`,
 * then copy the JSON into the two native test bundles (paths in the
 * footer it prints).
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCipheriv } from 'node:crypto'
import { NoiseHandshake, NoiseCipherState, encodeFrame } from './noise.mjs'

const EMPTY = Buffer.alloc(0)
const hex = buf => Buffer.from(buf).toString('hex')

// Deterministic scalars (any 32 bytes is a clamped-valid X25519 scalar).
const INITIATOR_STATIC = Buffer.from(range(32).map(i => i + 1))
const RESPONDER_STATIC = Buffer.from(range(32).map(i => i + 101))
const INITIATOR_EPHEMERAL = Buffer.from(range(32).map(i => i + 201))
const RESPONDER_EPHEMERAL = Buffer.from(range(32).map(i => i + 251))

function range(n) { return Array.from({ length: n }, (_, i) => i) }

const initiator = new NoiseHandshake('initiator', INITIATOR_STATIC, INITIATOR_EPHEMERAL)
const responder = new NoiseHandshake('responder', RESPONDER_STATIC, RESPONDER_EPHEMERAL)

const msg1 = initiator.writeMessage1()
responder.readMessage1(msg1)
const msg2 = responder.writeMessage2()
initiator.readMessage2(msg2)
const sessionId = initiator.transcriptHash.toString('hex')
const msg3 = initiator.writeMessage3()
responder.readMessage3(msg3)
const channelBinding = initiator.transcriptHash.toString('hex')

const initiatorSide = initiator.split()
const responderSide = responder.split()

const C1_PAYLOADS = [
  EMPTY,
  Buffer.from('{"token":"rt-acct-phone"}', 'utf8'),
  Buffer.from('{"kind":"task-completed","sessionId":"会话-1","turn":3}', 'utf8'),
]
const C2_PAYLOADS = [
  Buffer.from('{"ok":true}', 'utf8'),
  Buffer.from('{"delivered":2}', 'utf8'),
  EMPTY,
]

// The vectors pin the raw AEAD frames (ciphertext || tag), not the u16
// wire prefix — the ports frame separately and the prefix is trivial.
const seal = (state, payloads) => payloads.map(payload =>
  ({ payload: hex(payload), frame: hex(state.encryptWithAd(EMPTY, payload)) }))

const boundaryKey = initiatorSide.send.key
const boundaryAd = Buffer.from('Noise nonce boundary', 'utf8')
const boundaryPayload = Buffer.from('same plaintext at distinct nonces', 'utf8')
const boundaryNonces = [0n, 1n, (1n << 53n) - 1n, 1n << 53n, (1n << 53n) + 1n, (1n << 63n) - 1n, 1n << 63n, (1n << 64n) - 2n]
const nonceBoundaries = boundaryNonces.map(counter => {
  // Independent byte-wise nonce construction checks the reference state's UInt64 encoding.
  const nonce = Buffer.from([0, 0, 0, 0, ...range(8).map(index => Number((counter >> BigInt(8 * index)) & 0xffn))])
  const cipher = createCipheriv('chacha20-poly1305', boundaryKey, nonce, { authTagLength: 16 })
  cipher.setAAD(boundaryAd)
  const frame = Buffer.concat([cipher.update(boundaryPayload), cipher.final(), cipher.getAuthTag()])
  const sender = new NoiseCipherState(boundaryKey)
  const receiver = new NoiseCipherState(boundaryKey)
  sender.n = counter
  receiver.n = counter
  if (!sender.encryptWithAd(boundaryAd, boundaryPayload).equals(frame)
    || !receiver.decryptWithAd(boundaryAd, frame).equals(boundaryPayload)) {
    throw new Error('nonce boundary vector failed its independent round trip')
  }
  return { counter: counter.toString(), nonce: hex(nonce), frame: hex(frame) }
})

const vectors = {
  protocolName: 'Noise_XX_25519_ChaChaPoly_SHA256',
  note: 'Fixed-key vectors from the node reference implementation (apps/relay/noise.mjs); every port reproduces these bytes exactly.',
  keys: {
    initiatorStatic: hex(INITIATOR_STATIC),
    responderStatic: hex(RESPONDER_STATIC),
    initiatorEphemeral: hex(INITIATOR_EPHEMERAL),
    responderEphemeral: hex(RESPONDER_EPHEMERAL),
  },
  handshake: {
    msg1: hex(msg1),
    msg2: hex(msg2),
    msg3: hex(msg3),
    sessionIdAfterMsg2: sessionId,
    channelBindingAfterMsg3: channelBinding,
  },
  transport: {
    // Initiator → responder traffic key and frames (nonce counters 0..).
    c1Key: hex(initiatorSide.send.key),
    c1Frames: seal(initiatorSide.send, C1_PAYLOADS),
    // Responder → initiator traffic key and frames (nonce counters 0..).
    c2Key: hex(initiatorSide.recv.key),
    c2Frames: seal(responderSide.send, C2_PAYLOADS),
  },
  framing: {
    single: hex(encodeFrame(Buffer.from(range(16)))),
    doubled: hex(Buffer.concat([encodeFrame(EMPTY), encodeFrame(Buffer.from([9, 8, 7]))])),
  },
  nonceBoundaries: {
    key: hex(boundaryKey),
    ad: hex(boundaryAd),
    payload: hex(boundaryPayload),
    vectors: nonceBoundaries,
  },
}

// The responder must decrypt exactly what the initiator sealed and vice
// versa before the file is written — the generator never ships vectors
// its own state machines have not round-tripped.
for (const { payload, frame } of vectors.transport.c1Frames) {
  if (!responderSide.recv.decryptWithAd(EMPTY, Buffer.from(frame, 'hex')).equals(Buffer.from(payload, 'hex'))) {
    throw new Error('c1 vector failed the responder round trip')
  }
}
for (const { payload, frame } of vectors.transport.c2Frames) {
  if (!initiatorSide.recv.decryptWithAd(EMPTY, Buffer.from(frame, 'hex')).equals(Buffer.from(payload, 'hex'))) {
    throw new Error('c2 vector failed the initiator round trip')
  }
}

const out = join(import.meta.dirname, 'vectors', 'relay-noise-vectors.json')
mkdirSync(join(import.meta.dirname, 'vectors'), { recursive: true })
writeFileSync(out, `${JSON.stringify(vectors, null, 2)}\n`)
console.log(`gen-relay-vectors: wrote ${out}`)
console.log('sync copies:')
console.log('  apps/android/core/src/test/resources/fixtures/relay-noise-vectors.json')
console.log('  apps/apple/Tests/SharedAppleRemoteCoreTests/Fixtures/relay-noise-vectors.json')
