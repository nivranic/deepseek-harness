/**
 * The fixture Host's device-admission tracker, mirroring the gateway's
 * per-request admission semantics for the Android emulator lane: the
 * four-key wire shape, the Ed25519 signature over the three-line form
 * `deviceId\ntimestamp\nnonce`, the acceptance window, and the replay
 * ledger (per-device seen nonces with a two-window horizon plus the
 * last-admitted timestamp/nonce pair). Process-local by design — the lane
 * instrument needs no durable grants; the product gateway owns durability.
 * @module apps/android/support/link-admission.mjs
 */
import { createPublicKey, verify } from 'node:crypto'

export const ADMISSION_WINDOW_MS = 300_000

/**
 * Build one verifier over the pairing-registered device keys.
 * @param lookupKey - deviceId → base64 SPKI DER registered at pair, or undefined.
 * @param options - `windowMs` acceptance window, `now` injectable clock.
 * @returns `verify(deviceValue)` admitting a valid admission or refusing
 * with the gateway's device codes in the Link error-envelope form.
 */
export function createAdmissionTracker(lookupKey, { windowMs = ADMISSION_WINDOW_MS, now = () => Date.now() } = {}) {
  /** deviceId → { lastAdmittedAt, lastAdmittedNonce, nonces: Map<nonce, expiresAt> } */
  const ledgers = new Map()

  const ledgerOf = deviceId => {
    let ledger = ledgers.get(deviceId)
    if (ledger === undefined) {
      ledger = { lastAdmittedAt: undefined, lastAdmittedNonce: undefined, nonces: new Map() }
      ledgers.set(deviceId, ledger)
    }
    return ledger
  }

  /**
   * Verify one admission's wire object.
   * @param deviceValue - the envelope's `device` field.
   * @returns `{ ok: true, deviceId, nonce }` or
   * `{ ok: false, code, message, details }` with the gateway's device codes.
   */
  function verifyAdmission(deviceValue) {
    if (typeof deviceValue !== 'object' || deviceValue === null || Array.isArray(deviceValue)) {
      return refusal('gateway/arguments-invalid', 'device admission requires deviceId, an integer timestamp, a nonce, and a signature', {})
    }
    const keys = Object.keys(deviceValue).sort()
    if (keys.length !== 4 || !keys.includes('deviceId') || !keys.includes('timestamp') || !keys.includes('nonce') || !keys.includes('signature')) {
      return refusal('gateway/arguments-invalid', 'device admission requires deviceId, an integer timestamp, a nonce, and a signature', {})
    }
    const { deviceId, timestamp, nonce, signature } = deviceValue
    if (typeof deviceId !== 'string' || deviceId === ''
      || typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp)
      || typeof nonce !== 'string' || nonce === ''
      || typeof signature !== 'string' || signature === '') {
      return refusal('gateway/arguments-invalid', 'device admission requires deviceId, an integer timestamp, a nonce, and a signature', {})
    }
    const spkiB64 = lookupKey(deviceId)
    if (spkiB64 === undefined) {
      return refusal('device/not-found', 'no device grant with the addressed id', { deviceId })
    }
    if (Math.abs(now() - timestamp) > windowMs) {
      return refusal('device/admission-expired', 'signed admission timestamp fell outside the acceptance window', {
        deviceId, timestamp, admissionWindowMs: windowMs,
      })
    }
    const message = Buffer.from(`${deviceId}\n${timestamp}\n${nonce}`, 'utf8')
    let valid = false
    try {
      const key = createPublicKey({ key: Buffer.from(spkiB64, 'base64'), format: 'der', type: 'spki' })
      valid = verify(null, message, key, Buffer.from(signature, 'base64'))
    } catch {
      valid = false
    }
    if (!valid) {
      return refusal('device/key-invalid', 'admission signature does not verify against the paired key', { reason: 'signature-mismatch' })
    }
    const ledger = ledgerOf(deviceId)
    if (ledger.lastAdmittedAt !== undefined && timestamp < ledger.lastAdmittedAt) {
      return refusal('device/replay-detected', 'admission timestamp is older than the last accepted admission', {
        deviceId, reason: 'timestamp-regressed',
      })
    }
    const seenAt = ledger.nonces.get(nonce)
    if (seenAt !== undefined) {
      if (now() > seenAt) ledger.nonces.delete(nonce)
      else {
        return refusal('device/replay-detected', 'admission nonce was already used', { deviceId, reason: 'nonce-reuse' })
      }
    }
    if (ledger.lastAdmittedAt === timestamp && ledger.lastAdmittedNonce === nonce) {
      return refusal('device/replay-detected', 'admission nonce was already used', { deviceId, reason: 'nonce-reuse' })
    }
    for (const [entry, expiresAt] of ledger.nonces) {
      if (now() > expiresAt) ledger.nonces.delete(entry)
    }
    ledger.nonces.set(nonce, now() + 2 * windowMs)
    ledger.lastAdmittedAt = timestamp
    ledger.lastAdmittedNonce = nonce
    return { ok: true, deviceId, nonce }
  }

  return { verify: verifyAdmission }
}

const refusal = (code, message, details) => ({ ok: false, code, message, details })
