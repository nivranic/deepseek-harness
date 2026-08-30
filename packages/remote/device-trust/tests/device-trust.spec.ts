import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createPublicKey, generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DeviceTrustStore, {
  DeviceTrustError,
  internals,
} from '../src/index.ts'
import { DEVICE_TRUST_SCHEMA_VERSION, openDatabase } from '../src/schema.ts'

function devicePublicKey(): string {
  const { publicKey } = generateKeyPairSync('ed25519')
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
}

async function mount(path: string): Promise<{ ctx: Context; store: DeviceTrustStore }> {
  const ctx = new Context()
  const fiber = ctx.plugin(DeviceTrustStore, { path })
  await fiber
  const store = ctx.get('deviceTrust') as DeviceTrustStore
  return { ctx, store }
}

describe('DeviceTrustStore', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-device-trust-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(home, { recursive: true, force: true })
  })

  it('creates a stable host identity on first use', async () => {
    const { ctx, store } = await mount(':memory:')
    const first = await store.hostIdentity()
    const second = await store.hostIdentity()
    expect(first.hostId).toMatch(/^[0-9a-f-]{36}$/u)
    expect(second).toEqual(first)
    await ctx.fiber.dispose()
  })

  it('consumes a pairing code once and rejects every replay', async () => {
    const { ctx, store } = await mount(':memory:')
    const pairing = await store.createPairing(60)
    const device = await store.consumePairing(
      pairing.code,
      { name: 'iPhone', publicKeySpki: devicePublicKey() },
      'controller',
    )
    expect(device.role).toBe('controller')
    expect(device.revokedAt).toBeUndefined()
    await expect(store.consumePairing(
      pairing.code,
      { name: 'Attacker', publicKeySpki: devicePublicKey() },
      'observer',
    )).rejects.toBeInstanceOf(DeviceTrustError)
    await expect(store.consumePairing(
      pairing.code,
      { name: 'Attacker', publicKeySpki: devicePublicKey() },
      'observer',
    )).rejects.toMatchObject({ code: 'pairing-unknown' })
    await ctx.fiber.dispose()
  })

  it('rejects expired pairing codes and burns them', async () => {
    vi.spyOn(internals, 'now').mockReturnValue(1_000)
    const { ctx, store } = await mount(':memory:')
    const pairing = await store.createPairing(60)
    vi.spyOn(internals, 'now').mockReturnValue(1_000 + 61_000)
    await expect(store.consumePairing(
      pairing.code,
      { name: 'iPhone', publicKeySpki: devicePublicKey() },
      'controller',
    )).rejects.toMatchObject({ code: 'pairing-expired' })
    vi.spyOn(internals, 'now').mockReturnValue(1_000)
    await expect(store.consumePairing(
      pairing.code,
      { name: 'iPhone', publicKeySpki: devicePublicKey() },
      'controller',
    )).rejects.toMatchObject({ code: 'pairing-unknown' })
    await ctx.fiber.dispose()
  })

  it('rejects unusable device material at the pairing boundary', async () => {
    const { ctx, store } = await mount(':memory:')
    const pairing = await store.createPairing(60)
    await expect(store.consumePairing(
      pairing.code,
      { name: 'iPhone', publicKeySpki: 'not-base64-der' },
      'controller',
    )).rejects.toThrow(/SubjectPublicKeyInfo/u)
    await expect(store.consumePairing(
      pairing.code,
      { name: '', publicKeySpki: devicePublicKey() },
      'controller',
    )).rejects.toThrow(/1 through 200 characters/u)
    await expect(store.consumePairing(
      pairing.code,
      { name: 'iPhone', publicKeySpki: devicePublicKey() },
      'administrator',
    )).rejects.toThrow(/cannot be granted at pairing/u)
    await ctx.fiber.dispose()
  })

  it('keeps stored public keys usable for verification', async () => {
    const { ctx, store } = await mount(':memory:')
    const publicKeySpki = devicePublicKey()
    const pairing = await store.createPairing(60)
    await store.consumePairing(pairing.code, { name: 'iPad', publicKeySpki }, 'observer')
    const devices = await store.devices()
    expect(devices).toHaveLength(1)
    const key = createPublicKey({
      key: Buffer.from(devices[0]!.publicKeySpki, 'base64'),
      format: 'der',
      type: 'spki',
    })
    expect(key.asymmetricKeyType).toBe('ed25519')
    const read = await store.device(devices[0]!.deviceId)
    expect(read?.name).toBe('iPad')
    await ctx.fiber.dispose()
  })

  it('revokes a device exactly once and keeps the record for audit', async () => {
    vi.spyOn(internals, 'now').mockReturnValue(2_000)
    const { ctx, store } = await mount(':memory:')
    const pairing = await store.createPairing(60)
    const device = await store.consumePairing(
      pairing.code,
      { name: 'Phone', publicKeySpki: devicePublicKey() },
      'controller',
    )
    vi.spyOn(internals, 'now').mockReturnValue(3_000)
    const revoked = await store.revoke(device.deviceId)
    expect(revoked?.revokedAt).toBe(3_000)
    vi.spyOn(internals, 'now').mockReturnValue(4_000)
    await expect(store.revoke(device.deviceId)).resolves.toMatchObject({ revokedAt: 3_000 })
    await ctx.fiber.dispose()
  })

  it('records last-seen only for trusted devices', async () => {
    vi.spyOn(internals, 'now').mockReturnValue(5_000)
    const { ctx, store } = await mount(':memory:')
    const pairing = await store.createPairing(60)
    const device = await store.consumePairing(
      pairing.code,
      { name: 'Phone', publicKeySpki: devicePublicKey() },
      'controller',
    )
    await store.touch(device.deviceId)
    expect((await store.device(device.deviceId))?.lastSeenAt).toBe(5_000)
    vi.spyOn(internals, 'now').mockReturnValue(6_000)
    await store.revoke(device.deviceId)
    await store.touch(device.deviceId)
    expect((await store.device(device.deviceId))?.lastSeenAt).toBe(5_000)
    await ctx.fiber.dispose()
  })

  it('reuses one persisted database across mounts and rejects foreign versions', async () => {
    const path = join(home, 'trust.sqlite')
    const first = await mount(path)
    const identity = await first.store.hostIdentity()
    await first.ctx.fiber.dispose()

    const second = await mount(path)
    await expect(second.store.hostIdentity()).resolves.toEqual(identity)
    await second.store.close()
    await second.store.close()
    await second.ctx.fiber.dispose()

    const foreign = join(home, 'foreign.sqlite')
    const opened = await mount(foreign)
    await opened.ctx.fiber.dispose()
    const db = new DatabaseSync(foreign)
    db.exec(`PRAGMA user_version = ${DEVICE_TRUST_SCHEMA_VERSION + 1}`)
    db.close()
    const rejected = await mount(foreign)
    await expect(rejected.store.hostIdentity()).rejects.toThrow(/incompatible with this build/u)
    await rejected.ctx.fiber.dispose()
  })

  it('derives its default database path from the harness home', async () => {
    const ctx = new Context()
    await ctx.plugin(DeviceTrustStore, { dshHome: home })
    const store = ctx.get('deviceTrust') as DeviceTrustStore
    await expect(store.hostIdentity()).resolves.toMatchObject({ hostId: expect.any(String) as string })
    await ctx.fiber.dispose()
    await expect((await import('node:fs/promises')).stat(join(home, 'device-trust.sqlite'))).resolves.toBeTruthy()
  })

  it('rejects an open obstructed by a directory at the database path', async () => {
    const obstructed = join(home, 'as-directory')
    await mkdir(obstructed)
    await expect(openDatabase(obstructed)).rejects.toThrow()
  })
})
