import { generateKeyPairSync, X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureHostTlsMaterial, spkiFingerprintOfCertificate, spkiFingerprintOfDer } from '../src/tls.ts'

describe('link-access TLS material', () => {
  let stateDir: string

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'dsh-link-tls-'))
  })

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true })
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

  it('regenerates a torn pair missing either file', async () => {
    const first = await ensureHostTlsMaterial(stateDir)
    await rm(join(stateDir, 'link-cert.pem'))
    const healed = await ensureHostTlsMaterial(stateDir)
    expect(healed.certPem).not.toBe(first.certPem)
    expect(healed.spkiFingerprint).not.toBe(first.spkiFingerprint)
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
