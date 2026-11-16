import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { X509Certificate, createPrivateKey } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { loadTlsIdentity } from '../src/tls-identity.ts'

const cleanup: Array<() => Promise<void>> = []
const config = { certificateLifetimeDays: 7, certificateRenewBeforeDays: 1 }
const key = credentialKey('api-native-remote', 'tls-identity')

afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function provider(path?: string): Promise<{ ctx: Context; path: string }> {
  if (path === undefined) {
    const root = await mkdtemp(join(tmpdir(), 'native-tls-identity-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    path = join(root, 'credentials.yaml')
  }
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(LocalCredentialProvider, { path, watch: false })
  return { ctx, path }
}

describe('native TLS identity', () => {
  it('persists one key under concurrent creation and reopens it after provider restart', async () => {
    const first = await provider()
    const identities = await Promise.all([
      loadTlsIdentity(first.ctx.credentials, config), loadTlsIdentity(first.ctx.credentials, config),
    ])
    expect(identities[0]?.spkiFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(identities[0]?.spkiFingerprint).toBe(identities[1]?.spkiFingerprint)
    await first.ctx.fiber.dispose()
    const second = await provider(first.path)
    const restored = await loadTlsIdentity(second.ctx.credentials, config)
    expect(restored.spkiFingerprint).toBe(identities[0]?.spkiFingerprint)
    const certificate = new X509Certificate(restored.certificatePem)
    expect(certificate.verify(certificate.publicKey)).toBe(true)
    expect(certificate.checkPrivateKey(createPrivateKey(restored.privateKeyPem))).toBe(true)
  })

  it('renews an expiring certificate without changing the paired key', async () => {
    const { ctx } = await provider()
    const first = await loadTlsIdentity(ctx.credentials, config)
    const future = Date.now() + 6.5 * 86_400_000
    vi.spyOn(Date, 'now').mockReturnValue(future)
    const renewed = await loadTlsIdentity(ctx.credentials, config)
    expect(renewed.spkiFingerprint).toBe(first.spkiFingerprint)
    expect(renewed.privateKeyPem === first.privateKeyPem).toBe(true)
    expect(renewed.certificatePem === first.certificatePem).toBe(false)
    expect(Date.parse(new X509Certificate(renewed.certificatePem).validTo)).toBeGreaterThan(future)
  })

  it('leaves valid identity reads independent of record write access', async () => {
    const { ctx } = await provider()
    const first = await loadTlsIdentity(ctx.credentials, config)
    const write = vi.spyOn(ctx.credentials, 'modifyRecord').mockRejectedValue(new Error('read-only medium'))
    expect((await loadTlsIdentity(ctx.credentials, config)).spkiFingerprint).toBe(first.spkiFingerprint)
    expect(write).not.toHaveBeenCalled()
  })

  it('fails malformed stored material instead of silently creating a new pin', async () => {
    const { ctx } = await provider()
    await ctx.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: { version: 99 } }))
    const write = vi.spyOn(ctx.credentials, 'modifyRecord')
    await expect(loadTlsIdentity(ctx.credentials, config)).rejects.toThrow('stored TLS identity is invalid')
    expect(write).not.toHaveBeenCalled()
  })

  it('rejects another credential kind stored at the identity address', async () => {
    const { ctx } = await provider()
    await ctx.credentials.modifyRecord(key, async () => ({ kind: 'api-key' }))
    await expect(loadTlsIdentity(ctx.credentials, config)).rejects.toThrow('TLS identity must be a credential grant')
  })

  it('rejects a certificate paired with another private key', async () => {
    const first = await provider()
    const other = await provider()
    const identity = await loadTlsIdentity(first.ctx.credentials, config)
    const second = await loadTlsIdentity(other.ctx.credentials, config)
    await first.ctx.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: {
      version: 1, certificatePem: identity.certificatePem, privateKeyPem: second.privateKeyPem,
    } }))
    await expect(loadTlsIdentity(first.ctx.credentials, config)).rejects.toThrow('self-signed with its P-256 private key')
  })
})
