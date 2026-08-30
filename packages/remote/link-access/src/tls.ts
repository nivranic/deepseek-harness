/**
 * Host TLS material for the link carrier: one self-signed ECDSA P-256
 * certificate and key persisted under the Harness home, identified to
 * devices by the SHA-256 fingerprint of the certificate's
 * SubjectPublicKeyInfo. Pairing pins that fingerprint, so certificate
 * validity chains and extensions are irrelevant on the wire — only key
 * continuity between the QR code and every later TLS handshake matters.
 * The certificate is assembled here as the fixed X.509 v3 template below
 * (version, serial, ecdsa-with-SHA256, one CN, validity, the key's own
 * SubjectPublicKeyInfo, no extensions); the maintained-dependency
 * alternatives all carry a global metadata polyfill or a pure-JavaScript
 * RSA keygen into the Host process.
 * @module @deepseek-ai/dsh-link-access/tls
 */

import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  X509Certificate,
} from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Persisted TLS material plus the fingerprint devices pin at pairing. */
export interface HostTlsMaterial {
  readonly keyPem: string
  readonly certPem: string
  readonly spkiFingerprint: string
}

const KEY_FILENAME = 'link-key.pem'
const CERT_FILENAME = 'link-cert.pem'
const CERT_LIFETIME_DAYS = 3650
const SUBJECT_COMMON_NAME = 'DeepSeek Harness Link'

/** DER object identifier for ecdsa-with-SHA256 signatures. */
const OID_ECDSA_WITH_SHA256 = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]
/** DER object identifier for the commonName attribute. */
const OID_COMMON_NAME = [0x55, 0x04, 0x03]

/**
 * Load, or generate and persist, the host's link certificate. A directory
 * holding neither or only one of the two files is regenerated whole (a torn
 * write self-heals); an existing pair is reused so paired devices keep
 * working across restarts.
 * @param stateDir - directory owning the TLS files (created owner-only when missing).
 * @returns the TLS material with its pinned fingerprint.
 */
export async function ensureHostTlsMaterial(stateDir: string): Promise<HostTlsMaterial> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  const [keyPem, certPem] = await Promise.all([
    readFile(join(stateDir, KEY_FILENAME), 'utf8').catch(() => undefined),
    readFile(join(stateDir, CERT_FILENAME), 'utf8').catch(() => undefined),
  ])
  if (keyPem !== undefined && certPem !== undefined) {
    return { keyPem, certPem, spkiFingerprint: spkiFingerprintOfCertificate(certPem) }
  }
  const generated = generateSelfSigned()
  await writeFile(join(stateDir, KEY_FILENAME), generated.keyPem, { mode: 0o600 })
  await writeFile(join(stateDir, CERT_FILENAME), generated.certPem, { mode: 0o600 })
  return { ...generated, spkiFingerprint: spkiFingerprintOfCertificate(generated.certPem) }
}

/**
 * Fingerprint one PEM certificate by its SubjectPublicKeyInfo.
 * @param certPem - PEM-encoded certificate.
 * @returns lowercase hex SHA-256 of the SubjectPublicKeyInfo DER bytes.
 */
export function spkiFingerprintOfCertificate(certPem: string): string {
  return spkiFingerprintOfDer(new X509Certificate(certPem).publicKey.export({ type: 'spki', format: 'der' }))
}

/**
 * Fingerprint raw SubjectPublicKeyInfo DER bytes.
 * @param der - SubjectPublicKeyInfo DER bytes.
 * @returns lowercase hex SHA-256.
 */
export function spkiFingerprintOfDer(der: Buffer): string {
  return createHash('sha256').update(der).digest('hex')
}

function generateSelfSigned(): { readonly keyPem: string; readonly certPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const notAfter = new Date(notBefore.valueOf() + CERT_LIFETIME_DAYS * 24 * 60 * 60 * 1000)
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  const tbs = tbsCertificate(spki, notBefore, notAfter)
  const signature = cryptoSign('sha256', tbs, privateKey)
  const certificate = derSequence(
    tbs,
    algorithmIdentifier(),
    derBitString(signature),
  )
  return {
    keyPem: toPem(privateKey.export({ type: 'pkcs8', format: 'der' }), 'PRIVATE KEY'),
    certPem: toPem(certificate, 'CERTIFICATE'),
  }
}

/** Assemble the to-be-signed certificate body: the fixed template with this key and validity. */
function tbsCertificate(spki: Buffer, notBefore: Date, notAfter: Date): Buffer {
  return derSequence(
    // version [0] EXPLICIT INTEGER 2 — X.509 v3.
    Buffer.from([0xa0, 0x03, 0x02, 0x01, 0x02]),
    tlv(0x02, randomSerial()),
    algorithmIdentifier(),
    distinguishedName(),
    derSequence(derUtcTime(notBefore), derUtcTime(notAfter)),
    distinguishedName(),
    spki,
  )
}

function algorithmIdentifier(): Buffer {
  return derSequence(derObjectIdentifier(OID_ECDSA_WITH_SHA256))
}

function distinguishedName(): Buffer {
  return derSequence(
    derSet(derSequence(
      derObjectIdentifier(OID_COMMON_NAME),
      derUtf8String(SUBJECT_COMMON_NAME),
    )),
  )
}

function randomSerial(): Buffer {
  const serial = randomBytes(8)
  serial.writeUInt8(serial.readUInt8(0) & 0x7f, 0)
  return serial
}

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length])
  const bytes: number[] = []
  let rest = length
  while (rest > 0) {
    bytes.unshift(rest & 0xff)
    rest >>= 8
  }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function tlv(tag: number, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content)
  return Buffer.concat([Buffer.from([tag]), derLength(body.byteLength), body])
}

function derSequence(...content: Buffer[]): Buffer {
  return tlv(0x30, ...content)
}

function derSet(...content: Buffer[]): Buffer {
  return tlv(0x31, ...content)
}

function derObjectIdentifier(oid: readonly number[]): Buffer {
  return tlv(0x06, Buffer.from(oid))
}

function derUtf8String(value: string): Buffer {
  return tlv(0x0c, Buffer.from(value, 'utf8'))
}

function derUtcTime(value: Date): Buffer {
  const two = (part: number): string => String(part).padStart(2, '0')
  return tlv(0x17, Buffer.from(
    `${two(value.getUTCFullYear() % 100)}${two(value.getUTCMonth() + 1)}${two(value.getUTCDate())}`
    + `${two(value.getUTCHours())}${two(value.getUTCMinutes())}${two(value.getUTCSeconds())}Z`,
    'ascii',
  ))
}

function derBitString(value: Buffer): Buffer {
  return tlv(0x03, Buffer.concat([Buffer.from([0x00]), value]))
}

function toPem(der: Buffer, label: string): string {
  return `-----BEGIN ${label}-----\n${der.toString('base64')}\n-----END ${label}-----\n`
}
