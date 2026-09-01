/**
 * Noise_XX_25519_ChaChaPoly_SHA256 for the relay transport (nativization
 * plan chapters 68/69: "Noise 或 TLS 加密"). HTTP is only the courier:
 * handshake messages ride request/response bodies, then every relay body is
 * one or more transport frames (u16 big-endian ciphertext length prefix),
 * AEAD-sealed under the split session keys with empty associated data and a
 * 64-bit little-endian counter nonce. Zero dependencies — node:crypto
 * carries X25519, ChaCha20-Poly1305, and SHA-256. Implements the framework
 * state machines directly: SymmetricState (chaining key + transcript hash),
 * CipherState (key + nonce), and the XX handshake for both roles, with the
 * post-msg2 handshake hash doubling as the HTTP session id and the final
 * handshake hash as the channel binding.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync } from 'node:crypto'

const PROTOCOL_NAME = 'Noise_XX_25519_ChaChaPoly_SHA256'
const TAG = 16
const KEY = 32

/** Wraps one raw X25519 scalar into the PKCS#8 DER node:crypto imports. */
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex')
/** Wraps one raw X25519 public key into the SPKI DER node:crypto imports. */
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex')

const privateKeyFromRaw = (raw) => createPrivateKey({ key: Buffer.concat([X25519_PKCS8_PREFIX, raw]), format: 'der', type: 'pkcs8' })
const publicKeyFromRaw = (raw) => createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' })
const rawFromPublicKey = (publicKey) => publicKey.export({ type: 'spki', format: 'der' }).subarray(-KEY)

/** A fresh X25519 keypair (static or ephemeral), optionally scalar-pinned for vectors. */
function freshKeyPair(rawScalar) {
  if (rawScalar !== undefined) {
    const privateKey = privateKeyFromRaw(rawScalar)
    return { privateKey, publicRaw: rawFromPublicKey(createPublicKey(privateKey)) }
  }
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  return { privateKey, publicRaw: rawFromPublicKey(publicKey) }
}

/** The X25519 shared secret between one private key and one raw peer public key. */
const dh = (privateKey, peerRaw) => diffieHellman({ privateKey, publicKey: publicKeyFromRaw(peerRaw) })

const hmac = (key, data) => createHmac('sha256', key).update(data).digest()

/** Noise §4.3 HKDF with two outputs: temp = HMAC(ck, ikm); o1 = HMAC(temp, 1); o2 = HMAC(temp, o1||2). */
function hkdf2(chainingKey, ikm) {
  const temp = hmac(chainingKey, ikm)
  const one = hmac(temp, Buffer.from([1]))
  return [one, hmac(temp, Buffer.concat([one, Buffer.from([2])]))]
}

/** The 12-byte Noise ChaChaPoly nonce: 4 zero bytes then the counter little-endian. */
function nonce(counter) {
  const buf = Buffer.alloc(12)
  buf.writeBigUInt64LE(BigInt(counter), 4)
  return buf
}

/** AEAD seal with an explicit counter (Noise CipherState.EncryptWithAd). */
function seal(key, counter, ad, plaintext) {
  const cipher = createCipheriv('chacha20-poly1305', key, nonce(counter), { authTagLength: TAG })
  cipher.setAAD(ad)
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
}

/** AEAD open with an explicit counter; throws on tag mismatch. */
function open(key, counter, ad, ciphertext) {
  const decipher = createDecipheriv('chacha20-poly1305', key, nonce(counter), { authTagLength: TAG })
  decipher.setAAD(ad)
  decipher.setAuthTag(ciphertext.subarray(-TAG))
  return Buffer.concat([decipher.update(ciphertext.subarray(0, -TAG)), decipher.final()])
}

/** One direction of a split Noise session: a key and its message counter. */
export class NoiseCipherState {
  constructor(key) {
    this.key = key
    this.n = 0
  }

  get hasKey() {
    return this.key !== undefined
  }

  /** §4.2 EncryptWithAd: AEAD under the current counter, then increment. */
  encryptWithAd(ad, plaintext) {
    const ciphertext = seal(this.key, this.n, ad, plaintext)
    this.n += 1
    return ciphertext
  }

  /** §4.2 DecryptWithAd: open under the current counter, then increment. */
  decryptWithAd(ad, ciphertext) {
    const plaintext = open(this.key, this.n, ad, ciphertext)
    this.n += 1
    return plaintext
  }
}

/**
 * The Noise_XX handshake for either role. Message methods take and return
 * the exact Noise handshake message bytes; payloads are empty in the relay
 * protocol, but the trailing encrypted-payload tags stay in the messages
 * per spec (a keyed handshake message ends in a 16-byte tag even for empty
 * payloads).
 */
export class NoiseHandshake {
  /** @param {'initiator'|'responder'} role - which side this state plays. */
  constructor(role, staticRaw, ephemeralRaw) {
    this.role = role
    this.staticPair = freshKeyPair(staticRaw)
    this.ephemeralPair = freshKeyPair(ephemeralRaw)
    this.s = this.staticPair.publicRaw
    this.e = this.ephemeralPair.publicRaw
    this.rs = undefined
    this.re = undefined
    // SymmetricState over the 32-byte protocol name (no padding needed).
    this.ck = Buffer.from(PROTOCOL_NAME, 'utf8')
    this.h = Buffer.from(PROTOCOL_NAME, 'utf8')
    this.key = undefined
    this.n = 0
  }

  /** §4.1 MixHash: fold one value into the transcript hash. */
  #mixHash(data) {
    this.h = createHash('sha256').update(this.h).update(data).digest()
  }

  /** §4.1/4.3 MixKey: rekey from one DH output, resetting the counter. */
  #mixKey(ikm) {
    const [ck, tempKey] = hkdf2(this.ck, ikm)
    this.ck = ck
    this.key = tempKey
    this.n = 0
  }

  /** §4.6 EncryptAndHash: AEAD under the transcript hash when keyed. */
  #encryptAndHash(plaintext) {
    const ciphertext = this.key === undefined ? plaintext : seal(this.key, this.n, this.h, plaintext)
    if (this.key !== undefined) this.n += 1
    this.#mixHash(ciphertext)
    return ciphertext
  }

  /** §4.6 DecryptAndHash: the receiving mirror of {@link #encryptAndHash}. */
  #decryptAndHash(ciphertext) {
    const plaintext = this.key === undefined ? ciphertext : open(this.key, this.n, this.h, ciphertext)
    if (this.key !== undefined) this.n += 1
    this.#mixHash(ciphertext)
    return plaintext
  }

  /**
   * XX message 1 (initiator → responder): the ephemeral public key, then
   * the (unkeyed, thus plaintext) payload.
   * @returns the message bytes.
   */
  writeMessage1(payload = Buffer.alloc(0)) {
    this.#mixHash(this.e)
    return Buffer.concat([this.e, this.#encryptAndHash(payload)])
  }

  /** Ingest XX message 1 (responder side). */
  readMessage1(message) {
    this.re = message.subarray(0, KEY)
    this.#mixHash(this.re)
    this.#decryptAndHash(message.subarray(KEY))
  }

  /**
   * XX message 2 (responder → initiator): responder e, ee rekey, encrypted
   * responder static, es rekey, then the encrypted payload.
   * @returns the message bytes.
   */
  writeMessage2(payload = Buffer.alloc(0)) {
    this.#mixHash(this.e)
    this.#mixKey(dh(this.ephemeralPair.privateKey, this.re))
    const encryptedStatic = this.#encryptAndHash(this.s)
    this.#mixKey(dh(this.staticPair.privateKey, this.re))
    return Buffer.concat([this.e, encryptedStatic, this.#encryptAndHash(payload)])
  }

  /** Ingest XX message 2 (initiator side). */
  readMessage2(message) {
    let offset = 0
    this.re = message.subarray(offset, offset + KEY)
    offset += KEY
    this.#mixHash(this.re)
    this.#mixKey(dh(this.ephemeralPair.privateKey, this.re))
    this.rs = this.#decryptAndHash(message.subarray(offset, offset + KEY + TAG))
    offset += KEY + TAG
    this.#mixKey(dh(this.ephemeralPair.privateKey, this.rs))
    this.#decryptAndHash(message.subarray(offset))
  }

  /**
   * XX message 3 (initiator → responder): encrypted initiator static, es
   * rekey, then the encrypted payload.
   * @returns the message bytes.
   */
  writeMessage3(payload = Buffer.alloc(0)) {
    const encryptedStatic = this.#encryptAndHash(this.s)
    this.#mixKey(dh(this.ephemeralPair.privateKey, this.rs))
    return Buffer.concat([encryptedStatic, this.#encryptAndHash(payload)])
  }

  /** Ingest XX message 3 (responder side). */
  readMessage3(message) {
    let offset = 0
    this.rs = this.#decryptAndHash(message.subarray(offset, offset + KEY + TAG))
    offset += KEY + TAG
    this.#mixKey(dh(this.staticPair.privateKey, this.re))
    this.#decryptAndHash(message.subarray(offset))
  }

  /** The transcript hash right now — the HTTP session id after message 2. */
  get transcriptHash() {
    return this.h
  }

  /**
   * §4.2 Split: two transport cipher states from the final chaining key.
   * The first state carries initiator → responder traffic.
   * @returns `{ send, recv }` oriented for this state's role.
   */
  split() {
    const [k1, k2] = hkdf2(this.ck, Buffer.alloc(0))
    const c1 = new NoiseCipherState(k1)
    const c2 = new NoiseCipherState(k2)
    return this.role === 'initiator' ? { send: c1, recv: c2 } : { send: c2, recv: c1 }
  }
}

/** Frame one ciphertext for the wire: u16 big-endian length, then bytes. */
export function encodeFrame(ciphertext) {
  if (ciphertext.length > 0xffff) throw new Error('relay noise frame exceeds 65535 bytes')
  const head = Buffer.alloc(2)
  head.writeUInt16BE(ciphertext.length)
  return Buffer.concat([head, ciphertext])
}

/**
 * Split a framed body back into ciphertexts; a truncated or overlong tail
 * throws rather than yielding a partial frame.
 * @returns the ciphertexts, in order.
 */
export function decodeFrames(body) {
  const frames = []
  let offset = 0
  while (offset < body.length) {
    if (offset + 2 > body.length) throw new Error('relay noise frame header truncated')
    const length = body.readUInt16BE(offset)
    offset += 2
    if (offset + length > body.length) throw new Error('relay noise frame truncated')
    frames.push(body.subarray(offset, offset + length))
    offset += length
  }
  return frames
}
