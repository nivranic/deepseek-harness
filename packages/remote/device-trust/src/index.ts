/**
 * Paired-device trust store for the remote link carrier: one SQLite database
 * owns the stable Host identity, one-time pairing codes, and the device
 * records (public key, role, timestamps, revocation) that the link carrier
 * authorizes requests against. Device credentials never enter LLM-provider
 * credential storage.
 * @module @deepseek-ai/dsh-device-trust
 */

import { createHash, createPublicKey, randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'
import { openDatabase } from './schema.ts'

export { DEVICE_TRUST_SCHEMA_VERSION } from './schema.ts'

/** Opaque identity of one paired device. */
export type DeviceId = Branded<'DeviceId'>

/** Authorization role of one paired device; `administrator` reserves future host administration. */
export type DeviceRole = 'observer' | 'controller' | 'administrator'

/** Device roles this build may grant at pairing time. */
export const PAIRABLE_ROLES: readonly DeviceRole[] = ['observer', 'controller']

/** Session identity persisted as one paired-device grant. */
export type DeviceSessionGrantId = Branded<'DeviceSessionGrantId'>

/** Workspace identity persisted as one paired-device grant. */
export type DeviceWorkspaceGrantId = Branded<'DeviceWorkspaceGrantId'>

/** Resource ids one paired device may reach, or every id of that resource kind. */
export type DeviceResourceAccess<ResourceId extends string> = 'all' | readonly ResourceId[]

/** Session and Workspace grants persisted with one paired device. */
export interface DeviceAccess {
  readonly sessions: DeviceResourceAccess<DeviceSessionGrantId>
  readonly workspaces: DeviceResourceAccess<DeviceWorkspaceGrantId>
}

/**
 * Brand one validated Session identity for durable device access.
 * @param value - non-empty Session identity accepted at the configuration or wire boundary.
 * @returns the compile-time-distinct Session grant identity.
 */
export function DeviceSessionGrantId(value: string): DeviceSessionGrantId {
  return value as DeviceSessionGrantId
}

/**
 * Brand one validated Workspace identity for durable device access.
 * @param value - non-empty Workspace identity accepted at the configuration or wire boundary.
 * @returns the compile-time-distinct Workspace grant identity.
 */
export function DeviceWorkspaceGrantId(value: string): DeviceWorkspaceGrantId {
  return value as DeviceWorkspaceGrantId
}

/** One durable device record in the trust store. */
export interface PairedDevice {
  readonly deviceId: DeviceId
  readonly name: string
  /** Base64 DER SubjectPublicKeyInfo of the device's Ed25519 signing key. */
  readonly publicKeySpki: string
  readonly role: DeviceRole
  /** Epoch milliseconds. */
  readonly createdAt: number
  /** Epoch milliseconds of the last authorized request, when one occurred. */
  readonly lastSeenAt: number | undefined
  /** Epoch milliseconds of revocation; absent while the device is trusted. */
  readonly revokedAt: number | undefined
  /** Host resources this device may reach after endpoint and role checks. */
  readonly access: DeviceAccess
}

/** One issued, not-yet-consumed pairing code. */
export interface PendingPairing {
  /** High-entropy one-time code carried by the pairing QR payload. */
  readonly code: string
  readonly expiresAt: number
}

/** Stable identity of the Host that owns this store. */
export interface HostIdentity {
  readonly hostId: string
}

/** Failure raised when a pairing code cannot be consumed. */
export class DeviceTrustError extends Error {
  /** Machine-readable failure category. */
  readonly code: 'pairing-unknown' | 'pairing-expired'

  /**
   * Construct a pairing failure.
   * @param code - stable failure category.
   * @param message - correction-oriented diagnostic.
   */
  constructor(code: 'pairing-unknown' | 'pairing-expired', message: string) {
    super(message)
    this.name = 'DeviceTrustError'
    this.code = code
  }
}

/** Plugin configuration. */
export interface DeviceTrustConfig {
  /**
   * Filesystem path to the SQLite database file. The special value `:memory:`
   * opens an in-process database (tests). Defaults to
   * `<dshHome>/device-trust.sqlite`.
   */
  path?: string
  /** Harness home used when `path` is omitted; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
}

/** Schemastery validator for {@link DeviceTrustConfig}. */
export const Config: z<DeviceTrustConfig> = z.object({
  path: z.string(),
  dshHome: z.string(),
})

/** Test seam for the trust store's clock; production reads the wall clock. */
export const internals = {
  now: (): number => Date.now(),
}

interface DeviceRow {
  device_id: string
  name: string
  public_key_spki: string
  role: string
  created_at: number
  last_seen_at: number | null
  revoked_at: number | null
  all_sessions: number
  all_workspaces: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Host's paired-device trust store. */
    deviceTrust: DeviceTrustStore
  }

  interface Events {
    /**
     * A device's first revocation has committed. Every listener runs so active
     * carriers can close that device even when another observer fails.
     * @param deviceId - durable identity whose trust was just revoked.
     * @mode parallel
     */
    'device-trust/revoked'(deviceId: DeviceId): Promise<void> | void
  }
}

/**
 * The Host's device trust store: stable Host identity, one-time pairing
 * codes consumed atomically, and device records with role, resource grants,
 * timestamps, and revocation that the link carrier authorizes against.
 * @typert service deviceTrust
 */
export class DeviceTrustStore extends Service {
  static inject = []
  static Config: z<DeviceTrustConfig> = Config

  private readonly ready: Promise<DatabaseSync>
  private closed = false

  /**
   * Open the trust database.
   * @param ctx - owning plugin context.
   * @param config - validated plugin configuration (schema defaults applied).
   */
  constructor(ctx: Context, config: DeviceTrustConfig) {
    super(ctx, 'deviceTrust')
    const path = config.path ?? join(resolveDshHome(config.dshHome), 'device-trust.sqlite')
    this.ready = openDatabase(path)
    // Mark the rejection handled: every primitive re-awaits `ready`, so an
    // open failure still surfaces to each caller; this guard only prevents an
    // unhandled-rejection crash when the failure precedes the first use.
    this.ready.catch(() => {})
    ctx.effect(() => async () => {
      await this.close()
    }, 'device-trust.close')
  }

  /** Resolve this store's stable Host identity, creating it on first use.
   * @returns the Host identity record.
   */
  async hostIdentity(): Promise<HostIdentity> {
    const db = await this.ready
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('host_id') as
      | { value: string }
      | undefined
    if (row !== undefined) return { hostId: row.value }
    const hostId = randomUUID()
    db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('host_id', hostId)
    const stored = db.prepare('SELECT value FROM meta WHERE key = ?').get('host_id') as { value: string }
    return { hostId: stored.value }
  }

  /**
   * Issue one pairing code. The code is 256 random bits shown once (QR) and
   * stored only as its SHA-256 digest, so a database read cannot mint credentials.
   * @param ttlSeconds - lifetime of the code, from issue to expiry.
   * @returns the pending pairing to display to the device being paired.
   */
  async createPairing(ttlSeconds: number): Promise<PendingPairing> {
    const db = await this.ready
    const code = randomBytes(32).toString('base64url')
    const expiresAt = internals.now() + ttlSeconds * 1000
    db.prepare('INSERT INTO pending_pairings (code_hash, expires_at) VALUES (?, ?)')
      .run(hashPairingCode(code), expiresAt)
    return { code, expiresAt }
  }

  /**
   * Consume one pairing code and register the device. Consumption is atomic:
   * the code row is deleted first and a second consumer of the same code
   * fails, whether the two calls race or follow one another.
   * @param code - pairing code from {@link DeviceTrustStore.createPairing}.
   * @param device - user-chosen name and verified public key of the pairing device.
   * @param role - authorization role granted to the device.
   * @param access - Session and Workspace grants fixed by the Host at pairing.
   * @returns the durable device record just created.
   * @throws {@link DeviceTrustError} when the code is unknown or expired.
   */
  async consumePairing(
    code: string,
    device: { readonly name: string; readonly publicKeySpki: string },
    role: DeviceRole,
    access: DeviceAccess,
  ): Promise<PairedDevice> {
    if (!PAIRABLE_ROLES.includes(role)) {
      throw new Error(`device trust: role ${JSON.stringify(role)} cannot be granted at pairing`)
    }
    if (device.name.length === 0 || device.name.length > 200) {
      throw new Error('device trust: device name must be 1 through 200 characters')
    }
    assertUsablePublicKey(device.publicKeySpki)
    const db = await this.ready
    const normalizedAccess = normalizeAccess(access)
    const record: PairedDevice = {
      deviceId: DeviceId(randomUUID()),
      name: device.name,
      publicKeySpki: device.publicKeySpki,
      role,
      createdAt: internals.now(),
      lastSeenAt: undefined,
      revokedAt: undefined,
      access: normalizedAccess,
    }
    const codeHash = hashPairingCode(code)
    let expired = false
    db.exec('BEGIN IMMEDIATE')
    try {
      const pending = db.prepare('SELECT expires_at FROM pending_pairings WHERE code_hash = ?')
        .get(codeHash) as { expires_at: number } | undefined
      if (pending === undefined) {
        throw new DeviceTrustError('pairing-unknown', 'pairing code is unknown or already used')
      }
      const consumed = db.prepare('DELETE FROM pending_pairings WHERE code_hash = ?').run(codeHash)
      /* v8 ignore next 3 -- the immediate transaction excludes another writer; this guard contains store corruption. */
      if (consumed.changes !== 1) {
        throw new DeviceTrustError('pairing-unknown', 'pairing code is unknown or already used')
      }
      expired = pending.expires_at <= internals.now()
      if (!expired) insertDevice(db, record)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    if (expired) {
      throw new DeviceTrustError('pairing-expired', 'pairing code has expired; start a new pairing')
    }
    return record
  }

  /**
   * Read one device record, including revoked ones.
   * @param deviceId - identity of the device to read.
   * @returns the record, or `undefined` when no such device exists.
   */
  async device(deviceId: DeviceId): Promise<PairedDevice | undefined> {
    const db = await this.ready
    const row = db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId) as DeviceRow | undefined
    return row === undefined ? undefined : deviceOf(db, row)
  }

  /**
   * List every device record, revoked ones included, oldest first.
   * @returns every device record in the store.
   */
  async devices(): Promise<readonly PairedDevice[]> {
    const db = await this.ready
    const rows = db.prepare('SELECT * FROM devices ORDER BY created_at, device_id').all() as unknown as DeviceRow[]
    return rows.map(row => deviceOf(db, row))
  }

  /**
   * Revoke one device. A revoked device keeps its record (audit) and loses
   * authorization immediately; revoking twice is a no-op.
   * @param deviceId - identity of the device to revoke.
   * @returns the device record after revocation, or `undefined` when unknown.
   */
  async revoke(deviceId: DeviceId): Promise<PairedDevice | undefined> {
    const db = await this.ready
    const changed = db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL')
      .run(internals.now(), deviceId)
    if (changed.changes === 1) {
      try {
        await this.ctx.parallel('device-trust/revoked', deviceId)
      } catch (error) {
        this.ctx.logger.warn('device trust: a post-commit revocation listener failed: %o', error)
      }
    }
    return this.device(deviceId)
  }

  /**
   * Record that a trusted device just made an authorized request. Revoked
   * devices are never touched, so re-pairing cannot resurrect `lastSeenAt`.
   * @param deviceId - identity of the device that was just authorized.
   * @returns resolution after the write settles.
   */
  async touch(deviceId: DeviceId): Promise<void> {
    const db = await this.ready
    db.prepare('UPDATE devices SET last_seen_at = ? WHERE device_id = ? AND revoked_at IS NULL')
      .run(internals.now(), deviceId)
  }

  /** Close the database; every later primitive rejects. Idempotent.
   * @returns resolution after the medium is released.
   */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const db = await this.ready.catch(() => undefined)
    if (db !== undefined) db.close()
  }
}

function DeviceId(value: string): DeviceId {
  return value as DeviceId
}

function hashPairingCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

function deviceOf(db: DatabaseSync, row: DeviceRow): PairedDevice {
  return {
    deviceId: DeviceId(row.device_id),
    name: row.name,
    publicKeySpki: row.public_key_spki,
    role: row.role as DeviceRole,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    access: {
      sessions: row.all_sessions === 1
        ? 'all'
        : grantIds<DeviceSessionGrantId>(db, 'device_session_grants', 'session_id', row.device_id),
      workspaces: row.all_workspaces === 1
        ? 'all'
        : grantIds<DeviceWorkspaceGrantId>(db, 'device_workspace_grants', 'workspace_id', row.device_id),
    },
  }
}

function normalizeAccess(access: DeviceAccess): DeviceAccess {
  return {
    sessions: normalizeResourceAccess(access.sessions),
    workspaces: normalizeResourceAccess(access.workspaces),
  }
}

function normalizeResourceAccess<ResourceId extends string>(
  access: DeviceResourceAccess<ResourceId>,
): DeviceResourceAccess<ResourceId> {
  return access === 'all' ? access : [...new Set(access)].sort()
}

function insertDevice(db: DatabaseSync, record: PairedDevice): void {
  db.prepare(`
    INSERT INTO devices (
      device_id, name, public_key_spki, role, created_at, all_sessions, all_workspaces
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.deviceId,
    record.name,
    record.publicKeySpki,
    record.role,
    record.createdAt,
    record.access.sessions === 'all' ? 1 : 0,
    record.access.workspaces === 'all' ? 1 : 0,
  )
  if (record.access.sessions !== 'all') {
    const insert = db.prepare('INSERT INTO device_session_grants (device_id, session_id) VALUES (?, ?)')
    for (const sessionId of record.access.sessions) insert.run(record.deviceId, sessionId)
  }
  if (record.access.workspaces !== 'all') {
    const insert = db.prepare('INSERT INTO device_workspace_grants (device_id, workspace_id) VALUES (?, ?)')
    for (const workspaceId of record.access.workspaces) insert.run(record.deviceId, workspaceId)
  }
}

function grantIds<ResourceId extends string>(
  db: DatabaseSync,
  table: 'device_session_grants' | 'device_workspace_grants',
  column: 'session_id' | 'workspace_id',
  deviceId: string,
): ResourceId[] {
  const rows = db.prepare(`SELECT ${column} AS id FROM ${table} WHERE device_id = ? ORDER BY ${column}`)
    .all(deviceId) as unknown as Array<{ readonly id: string }>
  return rows.map(row => row.id as ResourceId)
}

function assertUsablePublicKey(publicKeySpki: string): void {
  try {
    createPublicKey({ key: Buffer.from(publicKeySpki, 'base64'), format: 'der', type: 'spki' })
  } catch (cause) {
    throw new Error('device trust: device public key is not a base64 DER SubjectPublicKeyInfo', { cause })
  }
}

export default DeviceTrustStore
