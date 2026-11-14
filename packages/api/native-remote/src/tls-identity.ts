/** Persistent native Host TLS identity; certificate renewal preserves the paired SPKI. */

import 'reflect-metadata'
import { createHash, createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto'
import { X509CertificateGenerator } from '@peculiar/x509'
import { credentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'

const IDENTITY_KEY = credentialKey('api-native-remote', 'tls-identity')
const DAY_MS = 86_400_000
const storedIdentity = z.object({
  version: z.literal(1),
  certificatePem: z.string().min(1),
  privateKeyPem: z.string().min(1),
}).strict()

/** Validated TLS material, never exposed through Remote methods or diagnostic logs. */
export interface NativeTlsIdentity {
  /** Self-signed leaf certificate in PEM form. */
  readonly certificatePem: string
  /** Unencrypted PKCS#8 PEM protected at rest by the credential provider. */
  readonly privateKeyPem: string
  /** Lowercase SHA-256 of the certificate's SubjectPublicKeyInfo DER. */
  readonly spkiFingerprint: string
}

/** Certificate lifetime choices; renewal leaves the private key unchanged. */
export interface CertificateConfig {
  /** Validity of each generated certificate, in days. */
  readonly certificateLifetimeDays: number
  /** Renew at listener startup when fewer than this many valid days remain. */
  readonly certificateRenewBeforeDays: number
}

function decode(record: CredentialRecord): NativeTlsIdentity {
  if (record.kind !== 'grant') throw new Error('native-remote: TLS identity must be a credential grant')
  const parsed = storedIdentity.safeParse(record.payload)
  if (!parsed.success) throw new Error('native-remote: stored TLS identity is invalid')
  const { certificatePem, privateKeyPem } = parsed.data
  const certificate = new X509Certificate(certificatePem)
  const key = createPrivateKey(privateKeyPem)
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
    || !certificate.checkPrivateKey(key) || !certificate.verify(certificate.publicKey)) {
    throw new Error('native-remote: stored certificate must be self-signed with its P-256 private key')
  }
  const spkiFingerprint = createHash('sha256')
    .update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
  return { certificatePem, privateKeyPem, spkiFingerprint }
}

function needsRenewal(identity: NativeTlsIdentity, config: CertificateConfig): boolean {
  const certificate = new X509Certificate(identity.certificatePem)
  return Date.parse(certificate.validTo) <= Date.now() + config.certificateRenewBeforeDays * DAY_MS
    || Date.parse(certificate.validFrom) > Date.now()
}

async function certificateRecord(identity: NativeTlsIdentity | undefined, config: CertificateConfig): Promise<CredentialRecord> {
  let keys: CryptoKeyPair
  if (identity === undefined) {
    keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  } else {
    const privateKey = createPrivateKey(identity.privateKeyPem)
    const algorithm = { name: 'ECDSA', namedCurve: 'P-256' }
    keys = {
      privateKey: await crypto.subtle.importKey('pkcs8', privateKey.export({ type: 'pkcs8', format: 'der' }), algorithm, true, ['sign']),
      publicKey: await crypto.subtle.importKey('spki', createPublicKey(privateKey).export({ type: 'spki', format: 'der' }), algorithm, true, ['verify']),
    }
  }
  const now = Date.now()
  const certificate = await X509CertificateGenerator.createSelfSigned({
    name: 'CN=DeepSeek Harness Native Remote', keys,
    notBefore: new Date(now), notAfter: new Date(now + config.certificateLifetimeDays * DAY_MS),
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
  }, crypto)
  const privateKey = createPrivateKey({
    key: Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)), type: 'pkcs8', format: 'der',
  })
  return { kind: 'grant', payload: {
    version: 1, certificatePem: certificate.toString('pem'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  } }
}

/**
 * Read or durably create the Host identity, renewing the certificate under the credential writer's lock.
 * Malformed stored material rejects instead of silently changing a paired identity.
 * @param credentials - composed protected credential-record provider.
 * @param config - validated certificate lifetimes.
 * @returns TLS material whose private key and SPKI survive renewal and Host restart.
 */
export async function loadTlsIdentity(credentials: CredentialProvider, config: CertificateConfig): Promise<NativeTlsIdentity> {
  const current = await credentials.readRecord(IDENTITY_KEY)
  if (current !== undefined) {
    const identity = decode(current)
    if (!needsRenewal(identity, config)) return identity
  }
  const stored = await credentials.modifyRecord(IDENTITY_KEY, async (record) => {
    const identity = record === undefined ? undefined : decode(record)
    if (identity !== undefined && !needsRenewal(identity, config)) return undefined
    return certificateRecord(identity, config)
  })
  // The writer returns its committed value; this mutation always creates or retains a record.
  return decode(stored as CredentialRecord)
}
