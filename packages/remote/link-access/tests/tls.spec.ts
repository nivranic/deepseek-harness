import { generateKeyPairSync, X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureHostTlsMaterial,
  spkiFingerprintOfCertificate,
  spkiFingerprintOfDer,
  tlsInternals,
} from '../src/tls.ts'

const serialSamples = vi.hoisted(() => [] as Buffer[])
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return {
    ...actual,
    randomBytes: (size: number) => size === 8 && serialSamples.length > 0
      ? serialSamples.shift()!
      : actual.randomBytes(size),
  }
})

// Reproduce the non-minimal eight-byte serial emitted by the legacy generator.
function withNonMinimalSerial(certPem: string): string {
  const der = Buffer.from(certPem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/gu, ''), 'base64')
  const serialPrefix = Buffer.from([0xa0, 0x03, 0x02, 0x01, 0x02, 0x02, 0x08])
  const serialOffset = der.indexOf(serialPrefix) + serialPrefix.byteLength
  if (serialOffset < serialPrefix.byteLength) throw new Error('certificate serial field not found')
  der.writeUInt8(0, serialOffset)
  der.writeUInt8(1, serialOffset + 1)
  const base64 = der.toString('base64').match(/.{1,64}/gu)?.join('\n')
  if (base64 === undefined) throw new Error('certificate DER is empty')
  return `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`
}

describe('link-access TLS material', () => {
  let stateDir: string

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'dsh-link-tls-'))
  })

  afterEach(async () => {
    serialSamples.length = 0
    await rm(stateDir, { recursive: true, force: true })
  })

  it('resamples a zero-leading serial before persisting a valid certificate', async () => {
    serialSamples.push(Buffer.alloc(8), Buffer.from([0x81, 2, 3, 4, 5, 6, 7, 8]))
    const material = await ensureHostTlsMaterial(stateDir)
    expect(new X509Certificate(material.certPem).serialNumber).toBe('0102030405060708')
    expect(serialSamples).toHaveLength(0)
  })

  it('generates once and reuses the persisted pair with a stable fingerprint', async () => {
    const first = await ensureHostTlsMaterial(stateDir)
    expect(first.certPem).toMatch(/BEGIN CERTIFICATE/u)
    expect(first.keyPem).toMatch(/BEGIN PRIVATE KEY/u)
    expect(first.spkiFingerprint).toMatch(/^[0-9a-f]{64}$/u)

    const persisted = await ensureHostTlsMaterial(stateDir)
    expect(persisted.certPem).toBe(first.certPem)
    expect(persisted.keyPem).toBe(first.keyPem)
    expect(persisted.spkiFingerprint).toBe(first.spkiFingerprint)

    const onDisk = await readFile(join(stateDir, 'link-cert.pem'), 'utf8')
    expect(onDisk).toBe(first.certPem)
  })

  it('rejects serial samples that would encode as zero and clears the positive sign bit', () => {
    expect(tlsInternals.canonicalPositiveSerial(Buffer.from([0x00, 0x01]))).toBeUndefined()
    expect(tlsInternals.canonicalPositiveSerial(Buffer.from([0x80, 0x01]))).toBeUndefined()
    expect(tlsInternals.canonicalPositiveSerial(Buffer.from([0xff, 0x01]))).toEqual(Buffer.from([0x7f, 0x01]))
  })

  it('regenerates a torn pair missing either file', async () => {
    const first = await ensureHostTlsMaterial(stateDir)
    await rm(join(stateDir, 'link-cert.pem'))
    const healed = await ensureHostTlsMaterial(stateDir)
    expect(healed.certPem).not.toBe(first.certPem)
    expect(healed.spkiFingerprint).not.toBe(first.spkiFingerprint)
  })

  it('regenerates a complete pair whose persisted certificate has a non-minimal serial', async () => {
    const first = await ensureHostTlsMaterial(stateDir)
    const malformed = withNonMinimalSerial(first.certPem)
    expect(() => new X509Certificate(malformed)).toThrow()
    await writeFile(join(stateDir, 'link-cert.pem'), malformed)

    const healed = await ensureHostTlsMaterial(stateDir)
    expect(healed.certPem).not.toBe(malformed)
    expect(healed.keyPem).not.toBe(first.keyPem)
    expect(() => new X509Certificate(healed.certPem)).not.toThrow()
    await expect(readFile(join(stateDir, 'link-cert.pem'), 'utf8')).resolves.toBe(healed.certPem)
  })

  it('fingerprints SubjectPublicKeyInfo bytes, not the certificate DER', async () => {
    const { publicKey } = generateKeyPairSync('ed25519')
    const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
    expect(spkiFingerprintOfDer(der)).toMatch(/^[0-9a-f]{64}$/u)
    expect(spkiFingerprintOfDer(der)).toBe(spkiFingerprintOfDer(der))

    const material = await ensureHostTlsMaterial(join(stateDir, 'nested'))
    const cert = new X509Certificate(material.certPem)
    expect(spkiFingerprintOfCertificate(cert.toString())).toBe(
      spkiFingerprintOfDer(cert.publicKey.export({ type: 'spki', format: 'der' }) as Buffer),
    )
  })
})
