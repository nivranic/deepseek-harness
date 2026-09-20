import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import DeviceTrustService, { DeviceId } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { DeviceId as DeviceIdType } from '../src/types.ts'

/** Fixed 12-byte Ed25519 SPKI prefix followed by 32 key bytes. */
const spkiB64 = (fill: number): string =>
  Buffer.concat([Buffer.of(0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00), Buffer.alloc(32, fill)])
    .toString('base64')

const codeOf = (error: unknown): string => {
  const remote = remoteErrorOf(error)
  expect(remote).toBeDefined()
  return remote!.code
}

async function boot(config: Partial<Config> = {}): Promise<DeviceTrustService> {
  const ctx = new Context()
  await ctx.plugin(DeviceTrustService, config)
  return ctx.deviceTrust
}

describe('device-trust pairing issuance', () => {
  it('issues single-use codes with the assigned role', async () => {
    const service = await boot({ pairingTtlMs: 5_000 })
    const issuance = service.issuePairing('collaborator')
    expect(issuance.role).toBe('collaborator')
    expect(issuance.code).toMatch(/^dsh-pair-/)
    expect(issuance.expiresAt).toBeGreaterThan(Date.now())
    const grant = service.redeemPairing({ code: issuance.code, deviceName: 'AVD', devicePublicKey: spkiB64(1) })
    expect(grant.role).toBe('collaborator')
    expect(grant.keyFingerprint).toHaveLength(64)
    expect(() => service.redeemPairing({ code: issuance.code, deviceName: 'again', devicePublicKey: spkiB64(3) }))
      .toThrow(expect.objectContaining({ code: 'device/pairing-invalid' }))
  })

  it('assigns the deployment default role when issuance names none', async () => {
    const service = await boot({ defaultRole: 'viewer' })
    const issuance = service.issuePairing()
    expect(issuance.role).toBe('viewer')
    const grant = service.redeemPairing({ code: issuance.code, deviceName: 'phone', devicePublicKey: spkiB64(4) })
    expect(grant.role).toBe('viewer')
  })

  it('rejects an unknown code', async () => {
    const service = await boot()
    expect(() => service.redeemPairing({ code: 'dsh-pair-missing', deviceName: 'phone', devicePublicKey: spkiB64(5) }))
      .toThrow(expect.objectContaining({ code: 'device/pairing-invalid' }))
  })

  it('rejects redemption after expiry with the expiry detail', async () => {
    const service = await boot({ pairingTtlMs: 1 })
    const issuance = service.issuePairing('admin')
    await new Promise(resolve => setTimeout(resolve, 5))
    try {
      service.redeemPairing({ code: issuance.code, deviceName: 'phone', devicePublicKey: spkiB64(6) })
      expect.unreachable()
    } catch (error) {
      expect(codeOf(error)).toBe('device/pairing-expired')
    }
  })
})

describe('device-trust key validation', () => {
  it('rejects a public key that is not an Ed25519 SPKI DER', async () => {
    const service = await boot()
    const issuance = service.issuePairing()
    expect(() => service.redeemPairing({ code: issuance.code, deviceName: 'phone', devicePublicKey: Buffer.alloc(10).toString('base64') }))
      .toThrow(expect.objectContaining({ code: 'device/key-invalid' }))
    expect(() => service.redeemPairing({ code: issuance.code, deviceName: 'phone', devicePublicKey: 'not base64!!!' }))
      .toThrow(expect.objectContaining({ code: 'device/key-invalid' }))
  })

  it('rejects an empty device name', async () => {
    const service = await boot()
    const issuance = service.issuePairing()
    expect(() => service.redeemPairing({ code: issuance.code, deviceName: '  ', devicePublicKey: spkiB64(7) }))
      .toThrow(expect.objectContaining({ code: 'gateway/bad-request' }))
  })
})

describe('device-trust grants and revocation', () => {
  async function paired(): Promise<{ service: DeviceTrustService; deviceId: DeviceIdType }> {
    const service = await boot()
    const issuance = service.issuePairing('admin')
    const grant = service.redeemPairing({ code: issuance.code, deviceName: 'desk phone', devicePublicKey: spkiB64(8) })
    return { service, deviceId: grant.deviceId }
  }

  it('lists grants without key material', async () => {
    const { service } = await paired()
    const views = service.listDevices()
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({ deviceName: 'desk phone', role: 'admin' })
    expect(views[0]).not.toHaveProperty('devicePublicKey')
  })

  it('revokes once and keeps the grant listed with its revocation time', async () => {
    const { service, deviceId } = await paired()
    const revoked = service.revokeDevice({ deviceId })
    expect(revoked.revokedAt).toBeGreaterThan(0)
    const view = service.listDevices().find(entry => entry.deviceId === deviceId)
    expect(view?.revokedAt).toBe(revoked.revokedAt)
    expect(() => service.revokeDevice({ deviceId }))
      .toThrow(expect.objectContaining({ code: 'device/already-revoked' }))
  })

  it('rejects revocation of an unknown device', async () => {
    const { service } = await paired()
    expect(() => service.revokeDevice({ deviceId: DeviceId('device-none') }))
      .toThrow(expect.objectContaining({ code: 'device/not-found' }))
  })
})
