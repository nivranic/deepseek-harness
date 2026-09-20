/**
 * The admission tracker's behavior contract: the four-key shape, the
 * three-line signature, the window, and both replay refusals. Run with
 * `node --test apps/android/support/link-admission.test.mjs`.
 * @module apps/android/support/link-admission.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { createAdmissionTracker } from './link-admission.mjs'

const device = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const raw = privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32)
  return {
    spkiB64: spki.toString('base64'),
    sign: message => edSign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64'),
    raw,
  }
}

const admission = (id, key, timestamp, nonce, signWith = key.sign) => ({
  deviceId: id, timestamp, nonce, signature: signWith(`${id}\n${timestamp}\n${nonce}`),
})

test('admits a fresh signed admission and records its nonce', () => {
  const key = device()
  let clock = 1_000_000
  const tracker = createAdmissionTracker(id => (id === 'd-1' ? key.spkiB64 : undefined), { now: () => clock })
  const verdict = tracker.verify(admission('d-1', key, clock, 'nonce-1'))
  assert.deepEqual(verdict, { ok: true, deviceId: 'd-1', nonce: 'nonce-1' })
})

test('refuses the malformed and unknown shapes with arguments-invalid', () => {
  const key = device()
  const tracker = createAdmissionTracker(() => key.spkiB64)
  for (const value of [null, 'x', [], {}, { deviceId: 'd-1', timestamp: 1, signature: 's' }]) {
    assert.equal(tracker.verify(value).code, 'gateway/arguments-invalid')
  }
})

test('refuses an unknown device, an out-of-window timestamp, and a foreign key', () => {
  const key = device()
  let clock = 1_000_000
  const tracker = createAdmissionTracker(id => (id === 'd-1' ? key.spkiB64 : undefined), { now: () => clock })
  assert.equal(tracker.verify(admission('d-none', key, clock, 'n')).code, 'device/not-found')
  assert.equal(tracker.verify(admission('d-1', key, clock - 300_001, 'n')).code, 'device/admission-expired')
  const other = device()
  assert.equal(tracker.verify(admission('d-1', key, clock, 'n', other.sign)).code, 'device/key-invalid')
})

test('refuses a replayed admission by nonce and a regressed timestamp', () => {
  const key = device()
  let clock = 1_000_000
  const tracker = createAdmissionTracker(() => key.spkiB64, { now: () => clock })
  assert.equal(tracker.verify(admission('d-1', key, clock, 'nonce-1')).ok, true)
  const replay = tracker.verify(admission('d-1', key, clock, 'nonce-1'))
  assert.equal(replay.code, 'device/replay-detected')
  assert.equal(replay.details.reason, 'nonce-reuse')
  const regressed = tracker.verify(admission('d-1', key, clock - 1, 'nonce-2'))
  assert.equal(regressed.code, 'device/replay-detected')
  assert.equal(regressed.details.reason, 'timestamp-regressed')
  clock += 1
  assert.equal(tracker.verify(admission('d-1', key, clock, 'nonce-1')).ok, false)
  assert.equal(tracker.verify(admission('d-1', key, clock, 'nonce-3')).ok, true)
})

test('expires ledger entries once two windows have passed', () => {
  const key = device()
  let clock = 1_000_000
  const tracker = createAdmissionTracker(() => key.spkiB64, { now: () => clock })
  assert.equal(tracker.verify(admission('d-1', key, clock, 'nonce-1')).ok, true)
  assert.equal(tracker.verify(admission('d-1', key, clock, 'nonce-1')).ok, false)
  clock += 601_000
  const verdict = tracker.verify(admission('d-1', key, clock, 'nonce-1'))
  assert.equal(verdict.ok, true, 'a nonce older than the horizon is dead weight, not a replay')
})
