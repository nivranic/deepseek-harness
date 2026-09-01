import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createPublicKey, generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DeviceTrustStore, {
  DeviceSessionGrantId,
  DeviceTrustError,
  DeviceWorkspaceGrantId,
  internals,
  type DeviceId,
} from '../src/index.ts'
import { DEVICE_TRUST_SCHEMA_VERSION, openDatabase } from '../src/schema.ts'

const FULL_ACCESS = { sessions: 'all', workspaces: 'all' } as const

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
      FULL_ACCESS,
    )
    expect(device.role).toBe('controller')
    expect(device.revokedAt).toBeUndefined()
    await expect(store.consumePairing(
      pairing.code,
      { name: 'Attacker', publicKeySpki: devicePublicKey() },
      'observer',
      FULL_ACCESS,
    )).rejects.toBeInstanceOf(DeviceTrustError)
    await expect(store.consumePairing(
      pairing.code,
      { name: 'Attacker', publicKeySpki: devicePublicKey() },
      'observer',
      FULL_ACCESS,
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
      FULL_ACCESS,
    )).rejects.toMatchObject({ code: 'pairing-expired' })
    vi.spyOn(internals, 'now').mockReturnValue(1_000)
    await expect(store.consumePairing(
      pairing.code,
      { name: 'iPhone', publicKeySpki: devicePublicKey() },
      'controller',
      FULL_ACCESS,
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
      FULL_ACCESS,
    )).rejects.toThrow(/SubjectPublicKeyInfo/u)
    await expect(store.consumePairing(
      pairing.code,
      { name: '', publicKeySpki: devicePublicKey() },
      'controller',
      FULL_ACCESS,
    )).rejects.toThrow(/1 through 200 characters/u)
    await expect(store.consumePairing(
      pairing.code,
      { name: 'iPhone', publicKeySpki: devicePublicKey() },
      'administrator',
      FULL_ACCESS,
    )).rejects.toThrow(/cannot be granted at pairing/u)
    await ctx.fiber.dispose()
  })

  it('keeps stored public keys usable for verification', async () => {
    const { ctx, store } = await mount(':memory:')
    const publicKeySpki = devicePublicKey()
    const pairing = await store.createPairing(60)
    await store.consumePairing(pairing.code, { name: 'iPad', publicKeySpki }, 'observer', FULL_ACCESS)
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
    const revokedEvent = vi.fn()
    const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.on('device-trust/revoked', revokedEvent)
    ctx.on('device-trust/revoked', async () => { throw new Error('fixture observer failure') })
    const pairing = await store.createPairing(60)
    const device = await store.consumePairing(
      pairing.code,
      { name: 'Phone', publicKeySpki: devicePublicKey() },
      'controller',
      FULL_ACCESS,
    )
    vi.spyOn(internals, 'now').mockReturnValue(3_000)
    const revoked = await store.revoke(device.deviceId)
    expect(revoked?.revokedAt).toBe(3_000)
    expect(revokedEvent).toHaveBeenCalledOnce()
    expect(revokedEvent).toHaveBeenCalledWith(device.deviceId)
    expect(warning).toHaveBeenCalledOnce()
    vi.spyOn(internals, 'now').mockReturnValue(4_000)
    await expect(store.revoke(device.deviceId)).resolves.toMatchObject({ revokedAt: 3_000 })
    await expect(store.revoke('missing-device' as DeviceId)).resolves.toBeUndefined()
    expect(revokedEvent).toHaveBeenCalledOnce()
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
      FULL_ACCESS,
    )
    await store.touch(device.deviceId)
    expect((await store.device(device.deviceId))?.lastSeenAt).toBe(5_000)
    vi.spyOn(internals, 'now').mockReturnValue(6_000)
    await store.revoke(device.deviceId)
    await store.touch(device.deviceId)
    expect((await store.device(device.deviceId))?.lastSeenAt).toBe(5_000)
    await ctx.fiber.dispose()
  })

  it('persists full and selective resource grants with each paired device', async () => {
    const path = join(home, 'access.sqlite')
    const { ctx, store } = await mount(path)
    const fullPairing = await store.createPairing(60)
    const full = await store.consumePairing(
      fullPairing.code,
      { name: 'Full', publicKeySpki: devicePublicKey() },
      'observer',
      FULL_ACCESS,
    )
    expect(full.access).toEqual(FULL_ACCESS)
    await expect(store.device('missing-device' as DeviceId)).resolves.toBeUndefined()

    const scopedPairing = await store.createPairing(60)
    const scoped = await store.consumePairing(
      scopedPairing.code,
      { name: 'Scoped', publicKeySpki: devicePublicKey() },
      'controller',
      {
        sessions: [
          DeviceSessionGrantId('session-b'),
          DeviceSessionGrantId('session-a'),
          DeviceSessionGrantId('session-a'),
        ],
        workspaces: [DeviceWorkspaceGrantId('workspace-a')],
      },
    )
    expect(scoped.access).toEqual({
      sessions: ['session-a', 'session-b'],
      workspaces: ['workspace-a'],
    })
    await ctx.fiber.dispose()

    const remounted = await mount(path)
    await expect(remounted.store.device(scoped.deviceId)).resolves.toMatchObject({
      access: { sessions: ['session-a', 'session-b'], workspaces: ['workspace-a'] },
    })
    await expect(remounted.store.devices()).resolves.toEqual([
      expect.objectContaining({ deviceId: full.deviceId, access: FULL_ACCESS }),
      expect.objectContaining({
        deviceId: scoped.deviceId,
        access: { sessions: ['session-a', 'session-b'], workspaces: ['workspace-a'] },
      }),
    ])
    await remounted.ctx.fiber.dispose()
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

    const old = join(home, 'old.sqlite')
    const oldOpened = await mount(old)
    await oldOpened.ctx.fiber.dispose()
    const oldDb = new DatabaseSync(old)
    oldDb.exec(`PRAGMA user_version = ${DEVICE_TRUST_SCHEMA_VERSION - 1}`)
    oldDb.close()
    const oldRejected = await mount(old)
    await expect(oldRejected.store.hostIdentity()).rejects.toThrow(/incompatible with this build/u)
    await oldRejected.ctx.fiber.dispose()
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
