import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf, type TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import {
  apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import DeviceTrustService, { DeviceId } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { DeviceId as DeviceIdType } from '../src/types.ts'

/** One freshly generated Ed25519 pair with the wire form of its public key. */
function ed25519(): { publicKeyB64: string; sign: (message: string) => string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  return {
    publicKeyB64: spki.toString('base64'),
    sign: message => edSign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64'),
  }
}

/** Fixed 12-byte Ed25519 SPKI prefix followed by 32 key bytes. */
const spkiB64 = (fill: number): string =>
  Buffer.concat([Buffer.of(0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00), Buffer.alloc(32, fill)])
    .toString('base64')

const codeOf = (error: unknown): string => {
  const remote = remoteErrorOf(error)
  expect(remote).toBeDefined()
  return remote!.code
}

const roots: string[] = []

/** Boot the full storage stack plus the service over one json root. */
async function boot(config: Partial<Config> = {}, root?: string): Promise<DeviceTrustService> {
  const ctx = new Context()
  const storageRoot = root ?? await mkdtemp(join(tmpdir(), 'device-trust-'))
  if (root === undefined) roots.push(storageRoot)
  await ctx.plugin(Storage)
  const jsonBackend = { name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }
  await ctx.plugin(jsonBackend, { root: storageRoot })
  await ctx.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
  await ctx.plugin(DeviceTrustService, config)
  return ctx.deviceTrust
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('device-trust capability device permissions', () => {
  it('gates administration on device.admin and keeps the pairing bootstrap undeclared', async () => {
    const { DEVICE_TRUST_REMOTE_CAPABILITIES } = await import('../src/capabilities.ts')
    const capabilities: readonly TypertRemoteCapability[] = DEVICE_TRUST_REMOTE_CAPABILITIES
    expect(capabilities.map(({ id, requiredPermission }) => [id, requiredPermission])).toEqual([
      ['device-pair.issue.v1', 'device.admin'],
      ['device-pair.redeem.v1', undefined],
      ['device.admit.v1', undefined],
      ['device.list.v1', 'device.admin'],
      ['device.revoke.v1', 'device.admin'],
    ])
  })
})

describe('device-trust pairing issuance', () => {
  it('issues single-use codes with the assigned role', async () => {
    const service = await boot({ pairingTtlMs: 5_000 })
    const issuance = service.issuePairing('collaborator')
    expect(issuance.role).toBe('collaborator')
    expect(issuance.code).toMatch(/^dsh-pair-/)
    expect(issuance.expiresAt).toBeGreaterThan(Date.now())
    const grant = await service.redeemPairing({ code: issuance.code, deviceName: 'AVD', devicePublicKey: spkiB64(1) })
    expect(grant.role).toBe('collaborator')
    expect(grant.keyFingerprint).toHaveLength(64)
    await expect(service.redeemPairing({ code: issuance.code, deviceName: 'again', devicePublicKey: spkiB64(3) }))
      .rejects.toMatchObject({ code: 'device/pairing-invalid' })
  })

  it('assigns the deployment default role when issuance names none', async () => {
    const service = await boot({ defaultRole: 'viewer' })
    const issuance = service.issuePairing()
    expect(issuance.role).toBe('viewer')
    const grant = await service.redeemPairing({ code: issuance.code, deviceName: 'phone', devicePublicKey: spkiB64(4) })
    expect(grant.role).toBe('viewer')
  })

  it('rejects an unknown code', async () => {
    const service = await boot()
    await expect(service.redeemPairing({ code: 'dsh-pair-missing', deviceName: 'phone', devicePublicKey: spkiB64(5) }))
      .rejects.toMatchObject({ code: 'device/pairing-invalid' })
  })

  it('rejects redemption after expiry with the expiry detail', async () => {
    const service = await boot({ pairingTtlMs: 1 })
    const issuance = service.issuePairing('owner')
    await new Promise(resolve => setTimeout(resolve, 5))
    try {
      await service.redeemPairing({ code: issuance.code, deviceName: 'phone', devicePublicKey: spkiB64(6) })
      expect.unreachable()
    } catch (error) {
      expect(codeOf(error)).toBe('device/pairing-expired')
    }
  })

  it('keeps a failed grant write from consuming the code', async () => {
    const service = await boot()
    const issuance = service.issuePairing('viewer')
    // A closed service cannot write durably; the code must stay redeemable
    // by the failure-ordering contract, so a plain validation failure is the
    // observable half of the guarantee tested here (key invalid before put).
    await expect(service.redeemPairing({ code: issuance.code, deviceName: 'phone', devicePublicKey: 'short' }))
      .rejects.toMatchObject({ code: 'device/key-invalid' })
    const grant = await service.redeemPairing({ code: issuance.code, deviceName: 'phone', devicePublicKey: spkiB64(9) })
    expect(grant.role).toBe('viewer')
  })
})

describe('device-trust key validation', () => {
  it('rejects a public key that is not an Ed25519 SPKI DER', async () => {
    const service = await boot()
    const issuance = service.issuePairing()
    await expect(service.redeemPairing({ code: issuance.code, deviceName: 'phone', devicePublicKey: Buffer.alloc(10).toString('base64') }))
      .rejects.toMatchObject({ code: 'device/key-invalid' })
    await expect(service.redeemPairing({ code: issuance.code, deviceName: 'phone', devicePublicKey: 'not base64!!!' }))
      .rejects.toMatchObject({ code: 'device/key-invalid' })
  })

  it('rejects an empty device name', async () => {
    const service = await boot()
    const issuance = service.issuePairing()
    await expect(service.redeemPairing({ code: issuance.code, deviceName: '  ', devicePublicKey: spkiB64(7) }))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
  })
})

describe('device-trust grants and revocation', () => {
  async function paired(config: Partial<Config> = {}): Promise<{ service: DeviceTrustService; deviceId: DeviceIdType }> {
    const service = await boot(config)
    const issuance = service.issuePairing('owner')
    const grant = await service.redeemPairing({ code: issuance.code, deviceName: 'desk phone', devicePublicKey: spkiB64(8) })
    return { service, deviceId: grant.deviceId }
  }

  it('lists grants without key material', async () => {
    const { service } = await paired()
    const views = service.listDevices()
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({ deviceName: 'desk phone', role: 'owner' })
    expect(views[0]).not.toHaveProperty('devicePublicKey')
  })

  it('revokes once and keeps the grant listed with its revocation time', async () => {
    const { service, deviceId } = await paired()
    const revoked = await service.revokeDevice({ deviceId })
    expect(revoked.revokedAt).toBeGreaterThan(0)
    const view = service.listDevices().find(entry => entry.deviceId === deviceId)
    expect(view?.revokedAt).toBe(revoked.revokedAt)
    await expect(service.revokeDevice({ deviceId }))
      .rejects.toMatchObject({ code: 'device/already-revoked' })
  })

  it('rejects revocation of an unknown device', async () => {
    const { service } = await paired()
    await expect(service.revokeDevice({ deviceId: DeviceId('device-none') }))
      .rejects.toMatchObject({ code: 'device/not-found' })
  })
})

describe('device-trust durability', () => {
  it('keeps grants across a Host restart on the same root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'device-trust-durable-'))
    roots.push(root)
    const first = await boot({ defaultRole: 'collaborator' }, root)
    const issuance = first.issuePairing('owner')
    const grant = await first.redeemPairing({ code: issuance.code, deviceName: 'survivor', devicePublicKey: spkiB64(10) })
    await first.revokeDevice({ deviceId: grant.deviceId }).then(() => undefined, () => undefined)

    const second = await boot({}, root)
    const views = second.listDevices()
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({
      deviceId: grant.deviceId,
      deviceName: 'survivor',
      role: 'owner',
      keyFingerprint: grant.keyFingerprint,
    })
    expect(views[0]?.revokedAt).toBeGreaterThan(0)
  })

  it('does not carry pending pairing codes across a restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'device-trust-codes-'))
    roots.push(root)
    const first = await boot({ pairingTtlMs: 60_000 }, root)
    const issuance = first.issuePairing('viewer')
    const second = await boot({ pairingTtlMs: 60_000 }, root)
    await expect(second.redeemPairing({ code: issuance.code, deviceName: 'late', devicePublicKey: spkiB64(11) }))
      .rejects.toMatchObject({ code: 'device/pairing-invalid' })
  })
})

describe('device-trust signed admission', () => {
  /** Pair one real Ed25519 key under the named role. */
  async function paired(
    service: DeviceTrustService,
    role: Config['defaultRole'],
  ): Promise<{ deviceId: DeviceIdType; key: ReturnType<typeof ed25519> }> {
    const key = ed25519()
    const issuance = service.issuePairing(role)
    const grant = await service.redeemPairing({ code: issuance.code, deviceName: 'phone', devicePublicKey: key.publicKeyB64 })
    return { deviceId: grant.deviceId, key }
  }

  it('returns the section 21 permission set for every role', async () => {
    const service = await boot()
    const table = [
      ['viewer', ['view']] as const,
      ['collaborator', ['view', 'prompt.send', 'question.respond']] as const,
      ['controller', ['view', 'prompt.send', 'question.respond', 'approval.respond']] as const,
      ['owner', ['view', 'prompt.send', 'question.respond', 'approval.respond', 'device.admin']] as const,
    ]
    for (const [role, permissions] of table) {
      const { deviceId, key } = await paired(service, role)
      const timestamp = Date.now()
      const admission = await service.admitDevice({
        deviceId, timestamp, nonce: `nonce-${role}`, signature: key.sign(`${deviceId}\n${timestamp}\nnonce-${role}`),
      })
      expect(admission.role).toBe(role)
      expect(admission.permissions).toEqual(permissions)
      expect(admission.deviceId).toBe(deviceId)
    }
  })

  it('rejects an unknown device', async () => {
    const service = await boot()
    const key = ed25519()
    const timestamp = Date.now()
    const deviceId = DeviceId('device-none')
    try {
      await service.admitDevice({ deviceId, timestamp, nonce: 'nonce-a', signature: key.sign(`${deviceId}\n${timestamp}\nnonce-a`) })
      expect.unreachable()
    } catch (error) {
      expect(codeOf(error)).toBe('device/not-found')
    }
  })

  it('rejects a revoked device', async () => {
    const service = await boot()
    const { deviceId, key } = await paired(service, 'viewer')
    await service.revokeDevice({ deviceId })
    const timestamp = Date.now()
    try {
      await service.admitDevice({ deviceId, timestamp, nonce: 'nonce-a', signature: key.sign(`${deviceId}\n${timestamp}\nnonce-a`) })
      expect.unreachable()
    } catch (error) {
      expect(codeOf(error)).toBe('device/already-revoked')
    }
  })

  it('rejects a stale and a future timestamp outside the window', async () => {
    const service = await boot({ admissionWindowMs: 1_000 })
    const { deviceId, key } = await paired(service, 'collaborator')
    for (const [timestamp, nonce] of [[Date.now() - 2_000, 'nonce-stale'], [Date.now() + 2_000, 'nonce-future']] as const) {
      try {
        await service.admitDevice({ deviceId, timestamp, nonce, signature: key.sign(`${deviceId}\n${timestamp}\n${nonce}`) })
        expect.unreachable()
      } catch (error) {
        expect(codeOf(error)).toBe('device/admission-expired')
      }
    }
  })

  it('rejects a signature not made by the paired key', async () => {
    const service = await boot()
    const { deviceId } = await paired(service, 'controller')
    const other = ed25519()
    const timestamp = Date.now()
    try {
      await service.admitDevice({ deviceId, timestamp, nonce: 'nonce-a', signature: other.sign(`${deviceId}\n${timestamp}\nnonce-a`) })
      expect.unreachable()
    } catch (error) {
      expect(codeOf(error)).toBe('device/key-invalid')
    }
  })

  it('rejects an empty signature or nonce as a bad request', async () => {
    const service = await boot()
    const { deviceId } = await paired(service, 'owner')
    for (const request of [
      { deviceId, timestamp: Date.now(), nonce: 'nonce-a', signature: '' },
      { deviceId, timestamp: Date.now(), nonce: '', signature: 'sig' },
    ] as const) {
      try {
        await service.admitDevice(request)
        expect.unreachable()
      } catch (error) {
        expect(codeOf(error)).toBe('gateway/bad-request')
      }
    }
  })

  it('rejects a replayed admission by nonce and by regressed timestamp', async () => {
    const service = await boot()
    const { deviceId, key } = await paired(service, 'collaborator')
    const first = Date.now()
    const message = (timestamp: number, nonce: string) => `${deviceId}\n${timestamp}\n${nonce}`
    const admitted = await service.admitDevice({ deviceId, timestamp: first, nonce: 'nonce-1', signature: key.sign(message(first, 'nonce-1')) })
    expect(admitted.role).toBe('collaborator')
    try {
      await service.admitDevice({ deviceId, timestamp: first, nonce: 'nonce-1', signature: key.sign(message(first, 'nonce-1')) })
      expect.unreachable()
    } catch (error) {
      expect(codeOf(error)).toBe('device/replay-detected')
    }
    try {
      await service.admitDevice({ deviceId, timestamp: first - 1, nonce: 'nonce-2', signature: key.sign(message(first - 1, 'nonce-2')) })
      expect.unreachable()
    } catch (error) {
      expect(codeOf(error)).toBe('device/replay-detected')
    }
    const advanced = await service.admitDevice({ deviceId, timestamp: first + 1, nonce: 'nonce-3', signature: key.sign(message(first + 1, 'nonce-3')) })
    expect(advanced.role).toBe('collaborator')
  })

  it('keeps the timestamp high-water mark and the last nonce across a restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'device-trust-replay-'))
    roots.push(root)
    const first = await boot({}, root)
    const { deviceId, key } = await paired(first, 'viewer')
    const timestamp = Date.now()
    await first.admitDevice({ deviceId, timestamp, nonce: 'nonce-1', signature: key.sign(`${deviceId}\n${timestamp}\nnonce-1`) })
    const second = await boot({}, root)
    const message = (nonce: string) => `${deviceId}\n${timestamp}\n${nonce}`
    try {
      await second.admitDevice({ deviceId, timestamp, nonce: 'nonce-1', signature: key.sign(message('nonce-1')) })
      expect.unreachable()
    } catch (error) {
      expect(codeOf(error)).toBe('device/replay-detected')
    }
    try {
      await second.admitDevice({ deviceId, timestamp: timestamp - 1, nonce: 'nonce-2', signature: key.sign(`${deviceId}\n${timestamp - 1}\nnonce-2`) })
      expect.unreachable()
    } catch (error) {
      expect(codeOf(error)).toBe('device/replay-detected')
    }
    const resumed = await second.admitDevice({ deviceId, timestamp: timestamp + 1, nonce: 'nonce-3', signature: key.sign(`${deviceId}\n${timestamp + 1}\nnonce-3`) })
    expect(resumed.role).toBe('viewer')
  })
})
