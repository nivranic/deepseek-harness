/**
 * Device-trust seam on the candidate gateway: pairing issuance with one-time
 * expiring codes, redemption registering the device's Ed25519 public key, the
 * durable grant store over the storage-domain seam, signed admission, and
 * revocation. A completed revocation leaves as one §44 `deviceTrustMetadata`
 * ops record through the optional session-telemetry owner, carrying the
 * revocation time and revoked count only. The audit decision
 * 2026-09-20-link-access-takeover-audit names this seam the single owner of
 * device-facing access; permission execution stays with Gateway, which
 * consumes each admission's section 21 permission set. The native-remote
 * package owns the separate encrypted listener.
 * @module @deepseek-ai/dsh-api-device-trust
 */

import { createHash, createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionTelemetryRecord, TelemetryConsent } from '@deepseek-ai/dsh-session-telemetry'
import { RemoteError, TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { DomainError, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { DEVICE_TRUST_REMOTE_CAPABILITIES } from './capabilities.ts'
import { DEVICE_ROLE_PERMISSIONS } from './permissions.ts'
import { deviceTrustDomainSpec } from './spec.ts'
import type { DeviceGrantRecord } from './spec.ts'
import type {
  AdmitDeviceRequest,
  DeviceAdmission,
  DeviceId,
  DeviceRole,
  DeviceView,
  PairingCodeId,
  PairingIssuance,
  RedeemPairingRequest,
  RedeemPairingResult,
  RenameDeviceRequest,
  RevokeAllDevicesResult,
  RevokeDeviceRequest,
  RevokeDeviceResult,
} from './types.ts'

export type * from './types.ts'
export { DEVICE_TRUST_REMOTE_CAPABILITIES } from './capabilities.ts'
export { DEVICE_ROLE_PERMISSIONS } from './permissions.ts'
export { deviceTrustDomainSpec, deviceGrantRecord } from './spec.ts'
export type { DeviceGrantRecord } from './spec.ts'

/**
 * Runtime constructor for the branded device identity.
 * @param id - wire id string from the store or a request.
 * @returns the branded identity.
 */
export function DeviceId(id: string): DeviceId {
  return id as DeviceId
}

function PairingCodeId(id: string): PairingCodeId {
  return id as PairingCodeId
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    deviceTrust: DeviceTrustService
  }
  interface Events {
    /**
     * Grants became revoked — by one revocation or revoke-all — so holders of
     * still-open admitted streams must terminate them immediately.
     * @param revocation - the shared revocation time and the revoked identities.
     * @mode emit
     */
    'deviceTrust/grantsRevoked'(revocation: { readonly revokedAt: number; readonly deviceIds: readonly DeviceId[] }): void
  }
}

/** Config: deployment-varying choices of the pairing ceremony and admission. */
export interface Config {
  /** Lifetime of an issued pairing code in ms (default five minutes). */
  pairingTtlMs?: number
  /** Role assigned at redemption when issuance named none (default viewer). */
  defaultRole?: DeviceRole
  /**
   * Acceptance window around the signed admission timestamp in ms (default
   * five minutes); an admission signed further from now fails with
   * `device/admission-expired`.
   */
  admissionWindowMs?: number
  /** Maximum retained nonce hashes per device inside the admission window (default 4096); full ledgers refuse admission. */
  maxAdmissionNonces?: number
}

/** Fixed 12-byte SubjectPublicKeyInfo header before one raw Ed25519 key. */
const ED25519_SPKI_PREFIX = Buffer.of(0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00)

/** Lowercase hex SHA-256 digest of the exact bytes. */
const sha256Hex = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/**
 * Validate a base64 Ed25519 SPKI DER device key and return it with its
 * display fingerprint.
 * @param devicePublicKey - wire field from a redemption request.
 * @returns the decoded 44-byte SPKI and its hex digest.
 * @throws RemoteError `device/key-invalid` when the value is not a base64
 * Ed25519 SPKI DER.
 */
function decodeDeviceKey(devicePublicKey: string): { spki: Buffer; fingerprint: string } {
  let spki: Buffer
  try {
    spki = Buffer.from(devicePublicKey, 'base64')
  } catch {
    throw new RemoteError('device/key-invalid', 'device public key is not base64', { reason: 'not-base64' })
  }
  if (spki.length !== 44 || !spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    throw new RemoteError('device/key-invalid', 'device public key is not an Ed25519 SPKI DER', { reason: 'not-ed25519-spki' })
  }
  return { spki, fingerprint: sha256Hex(spki) }
}

/** Optional session-telemetry owner shape the service pushes revocation records through. */
interface TelemetryOwner {
  readonly consent: TelemetryConsent
  emit(record: SessionTelemetryRecord): void
}

/**
 * §44 gate for the one telemetry kind this seam emits. Local specialization of
 * `telemetryKindAllowed` (the authority, in dsh-session-telemetry) so this
 * package keeps a type-only dependency face: for a single kind the general
 * form reduces to the same `=== true` check.
 */
function deviceTrustMetadataAllowed(consent: Partial<TelemetryConsent>): boolean {
  return consent.deviceTrustMetadata === true
}

/** One issued code awaiting redemption. */
interface PendingPairing {
  readonly pairingId: PairingCodeId
  readonly role: DeviceRole
  readonly expiresAt: number
  claimed: boolean
}

/** Device-trust service (`ctx.deviceTrust`) over the durable device_trust domain. */
export class DeviceTrustService extends TypertRemoteService {
  static inject = ['storageDomain']

  static Config: z<Config> = z.object({
    pairingTtlMs: z.number().step(1).min(1).default(300_000),
    defaultRole: z.union([
      z.const('viewer'),
      z.const('collaborator'),
      z.const('controller'),
      z.const('owner'),
    ]).default('viewer'),
    admissionWindowMs: z.number().step(1).min(1).default(300_000),
    maxAdmissionNonces: z.number().step(1).min(1).default(4096),
  })

  /**
   * Pending pairing codes stay process-local: a one-time expiring secret must
   * not survive a Host restart, and the ceremony simply reissues after one.
   */
  private readonly pairings = new Map<string, PendingPairing>()
  private readonly resolved: {
    pairingTtlMs: number
    defaultRole: DeviceRole
    admissionWindowMs: number
    maxAdmissionNonces: number
  }
  private grants?: KvTable<DeviceId, DeviceGrantRecord>

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'deviceTrust', { namespace: 'deviceTrust', capabilities: DEVICE_TRUST_REMOTE_CAPABILITIES })
    this.resolved = {
      pairingTtlMs: config.pairingTtlMs ?? 300_000,
      defaultRole: config.defaultRole ?? 'viewer',
      admissionWindowMs: config.admissionWindowMs ?? 300_000,
      maxAdmissionNonces: config.maxAdmissionNonces ?? 4096,
    }
  }

  /** Open the durable grants table; an invalid stored record rejects here. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(deviceTrustDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'deviceTrust.domainClose')
    this.grants = domain.table('grants')
  }

  /** The opened grants table; the service starts only after [Service.init]. */
  private table(): KvTable<DeviceId, DeviceGrantRecord> {
    if (this.grants === undefined) throw new Error('device-trust domain is not open')
    return this.grants
  }

  /**
   * Issue one one-time pairing code. The code is a single-use secret: a
   * second redemption fails with `device/pairing-invalid`, and redemption
   * after the expiry fails with `device/pairing-expired`.
   * @param role - role assigned to the redeeming device; omission uses the
   * deployment default.
   * @returns the issuance the operator shows the device (for example as QR
   * content).
   */
  @Remote('issuePairing')
  issuePairing(role?: DeviceRole): PairingIssuance {
    const pairingId = PairingCodeId(`pair-${randomUUID()}`)
    const code = `dsh-pair-${randomUUID()}${randomUUID().slice(0, 8)}`
    const assigned = role ?? this.resolved.defaultRole
    const expiresAt = Date.now() + this.resolved.pairingTtlMs
    this.pairings.set(code, { pairingId, role: assigned, expiresAt, claimed: false })
    return { pairingId, code, role: assigned, expiresAt }
  }

  /**
   * Redeem one pairing code with the device's freshly generated Ed25519 key.
   * A code admits one redemption at a time. The claim becomes permanent
   * after durability; a failed store write releases it for a later retry.
   * @param request - the single-use code, a device name, and the base64 SPKI
   * DER public key.
   * @returns the created grant identity.
   * @throws RemoteError `device/pairing-invalid`, `device/pairing-expired`,
   * `device/key-invalid`, or `gateway/bad-request`.
   */
  @Remote('redeemPairing')
  async redeemPairing(request: RedeemPairingRequest): Promise<RedeemPairingResult> {
    const pending = this.pairings.get(request.code)
    if (pending === undefined || pending.claimed) {
      throw new RemoteError('device/pairing-invalid', 'pairing code is unknown or already redeemed', { code: request.code })
    }
    if (Date.now() > pending.expiresAt) {
      throw new RemoteError('device/pairing-expired', 'pairing code expired before redemption', {
        code: request.code, expiresAt: pending.expiresAt,
      })
    }
    const deviceName = request.deviceName.trim()
    if (deviceName === '') {
      throw new RemoteError('gateway/bad-request', 'deviceName must be non-empty', {})
    }
    const platform = request.platform?.trim()
    if (platform !== undefined && platform === '') {
      throw new RemoteError('gateway/bad-request', 'platform must be non-empty when present', {})
    }
    const { fingerprint } = decodeDeviceKey(request.devicePublicKey)
    const pairedAt = Date.now()
    const deviceId = DeviceId(`device-${randomUUID()}`)
    const record: DeviceGrantRecord = {
      deviceName, role: pending.role,
      devicePublicKey: request.devicePublicKey, keyFingerprint: fingerprint, pairedAt,
      admissionFloor: 0, admissionNonces: [],
      ...platform === undefined ? {} : { platform },
    }
    pending.claimed = true
    try {
      await this.table().put(deviceId, record)
    } catch (error) {
      pending.claimed = false
      throw error
    }
    return { deviceId, role: pending.role, keyFingerprint: fingerprint, pairedAt }
  }

  /**
   * List every grant, active and revoked; key material stays in the store.
   * Reads come from the domain's in-memory state — the same state every
   * write mutated only after durability — so a read can never go around the
   * write chain to the medium.
   * @returns fresh views in iteration order.
   */
  @Remote('listDevices')
  listDevices(): readonly DeviceView[] {
    return [...this.table().entries()].map(([deviceId, grant]) => ({
      deviceId,
      deviceName: grant.deviceName,
      role: grant.role,
      keyFingerprint: grant.keyFingerprint,
      pairedAt: grant.pairedAt,
      ...grant.platform === undefined ? {} : { platform: grant.platform },
      ...grant.lastAdmittedAt === undefined ? {} : { lastSeenAt: grant.lastAdmittedAt },
      ...grant.revokedAt === undefined ? {} : { revokedAt: grant.revokedAt },
    }))
  }

  /**
   * Revoke one grant. A revoked grant stays listed with its revocation time;
   * a later role-mapped admission must treat it as refused. A completed
   * revocation also leaves as one §44 `deviceTrustMetadata` ops record when
   * the optional session-telemetry owner is composed and consenting.
   * @param request - the addressed grant.
   * @returns the revoke acknowledgement.
   * @throws RemoteError `device/not-found` or `device/already-revoked`.
   */
  @Remote('revokeDevice')
  async revokeDevice(request: RevokeDeviceRequest): Promise<RevokeDeviceResult> {
    if (this.table().get(request.deviceId) === undefined) {
      throw new RemoteError('device/not-found', 'no device grant with the addressed id', { deviceId: request.deviceId })
    }
    const revokedAt = Date.now()
    try {
      await this.table().update(request.deviceId, (current): DeviceGrantRecord => {
        if (current.revokedAt !== undefined) {
          throw new RemoteError('device/already-revoked', 'device grant was already revoked', {
            deviceId: request.deviceId, revokedAt: current.revokedAt,
          })
        }
        return { ...current, revokedAt }
      })
    } catch (error) {
      if (error instanceof DomainError && error.code === 'missing-key') {
        throw new RemoteError('device/not-found', 'no device grant with the addressed id', { deviceId: request.deviceId })
      }
      throw error
    }
    this.ctx.emit('deviceTrust/grantsRevoked', { revokedAt, deviceIds: [request.deviceId] })
    this.reportRevocation(revokedAt, 1)
    return { deviceId: request.deviceId, revokedAt }
  }

  /**
   * Revoke every still-active grant — the lost-device panic path. Already
   * revoked grants keep their original revocation time; the event carries
   * exactly the identities this call revoked. A call that revoked at least
   * one grant also leaves one §44 `deviceTrustMetadata` ops record through
   * the optional session-telemetry owner; a no-op revoke-all records
   * nothing, mirroring the event condition.
   * @returns the shared revocation time and how many grants it revoked.
   */
  @Remote('revokeAllDevices')
  async revokeAllDevices(): Promise<RevokeAllDevicesResult> {
    const revokedAt = Date.now()
    const deviceIds: DeviceId[] = []
    for (const [deviceId, grant] of this.table().entries()) {
      if (grant.revokedAt !== undefined) continue
      deviceIds.push(deviceId)
    }
    await Promise.all(deviceIds.map(deviceId =>
      this.table().update(deviceId, (current): DeviceGrantRecord =>
        current.revokedAt === undefined ? { ...current, revokedAt } : current),
    ))
    if (deviceIds.length > 0) {
      this.ctx.emit('deviceTrust/grantsRevoked', { revokedAt, deviceIds })
      this.reportRevocation(revokedAt, deviceIds.length)
    }
    return { revokedAt, count: deviceIds.length }
  }

  /**
   * Push one completed revocation through the optional session-telemetry
   * owner as a §44 ops record. The payload carries the shared revocation
   * time and the revoked count only: device ids, key fingerprints, roles,
   * and key material never leave, and severity is `info` — an operator
   * security action, not a fault. The owner is probed here, not snapshotted
   * at construction, because revocation is a runtime event: consent is
   * frozen at the owner's own construction, so every revocation reads the
   * same resolved record without composition-order coupling. An absent owner
   * or a closed gate stays silent; the durable revocation is unchanged.
   * @param revokedAt - the shared revocation time of the completed revocation.
   * @param deviceCount - how many grants this revocation revoked.
   */
  private reportRevocation(revokedAt: number, deviceCount: number): void {
    const owner = this.ctx.get('sessionTelemetry') as TelemetryOwner | undefined
    if (owner === undefined || !deviceTrustMetadataAllowed(owner.consent)) return
    owner.emit({
      channel: 'ops',
      time: Date.now(),
      severity: 'info',
      attributes: { 'telemetry.op': 'device-trust-revocation' },
      body: { op: 'device-trust-revocation', revokedAt, deviceCount },
    })
  }

  /**
   * Rename one grant's display name; the identity, key, and role are
   * untouched, so an operator reconciling a re-paired device can relabel the
   * stale and current identities without touching access.
   * @param request - the addressed grant and its replacement name.
   * @returns the renamed grant's fresh view.
   * @throws RemoteError `device/not-found` or `gateway/bad-request`.
   */
  @Remote('renameDevice')
  async renameDevice(request: RenameDeviceRequest): Promise<DeviceView> {
    const deviceName = request.deviceName.trim()
    if (deviceName === '') {
      throw new RemoteError('gateway/bad-request', 'deviceName must be non-empty', {})
    }
    if (this.table().get(request.deviceId) === undefined) {
      throw new RemoteError('device/not-found', 'no device grant with the addressed id', { deviceId: request.deviceId })
    }
    let updated: DeviceGrantRecord
    try {
      updated = await this.table().update(request.deviceId, current => ({ ...current, deviceName }))
    } catch (error) {
      if (error instanceof DomainError && error.code === 'missing-key') {
        throw new RemoteError('device/not-found', 'no device grant with the addressed id', { deviceId: request.deviceId })
      }
      throw error
    }
    return {
      deviceId: request.deviceId,
      deviceName: updated.deviceName,
      role: updated.role,
      keyFingerprint: updated.keyFingerprint,
      pairedAt: updated.pairedAt,
      ...updated.platform === undefined ? {} : { platform: updated.platform },
      ...updated.lastAdmittedAt === undefined ? {} : { lastSeenAt: updated.lastAdmittedAt },
      ...updated.revokedAt === undefined ? {} : { revokedAt: updated.revokedAt },
    }
  }

  /**
   * Verify one signed admission and return the device's identity with its
   * section 21 permission set. Checks run cheapest-first: the grant must
   * exist and be active, the signed timestamp must sit inside the admission
   * window, and the Ed25519 signature over `deviceId + "\n" + timestamp +
   * "\n" + nonce` (UTF-8) must verify against the paired key. An admission
   * with a consumed nonce or a timestamp below the durable replay floor is
   * refused. Fresh proofs may arrive out of timestamp order. The storage
   * update rechecks revocation, expiry, nonce consumption, and capacity
   * against earlier queued writes before recording the nonce hash. The Gateway
   * resolves one admission per Remote event stream open and derives the client's reply
   * permissions from the returned set.
   * @param request - the device's signed admission message.
   * @returns the admitted identity, role, and permissions.
   * @throws RemoteError `device/not-found`, `device/already-revoked`,
   * `device/admission-expired`, `device/key-invalid`, `device/replay-detected`,
   * `device/admission-capacity`, or `gateway/bad-request`.
   */
  @Remote('admitDevice')
  async admitDevice(request: AdmitDeviceRequest): Promise<DeviceAdmission> {
    if (typeof request.signature !== 'string' || request.signature === '') {
      throw new RemoteError('gateway/bad-request', 'signature must be a non-empty string', {})
    }
    if (typeof request.nonce !== 'string' || request.nonce === '') {
      throw new RemoteError('gateway/bad-request', 'nonce must be a non-empty string', {})
    }
    const grant = this.table().get(request.deviceId)
    if (grant === undefined) {
      throw new RemoteError('device/not-found', 'no device grant with the addressed id', { deviceId: request.deviceId })
    }
    if (grant.revokedAt !== undefined) {
      throw new RemoteError('device/already-revoked', 'device grant was already revoked', {
        deviceId: request.deviceId, revokedAt: grant.revokedAt,
      })
    }
    if (Math.abs(Date.now() - request.timestamp) > this.resolved.admissionWindowMs) {
      throw new RemoteError('device/admission-expired', 'signed admission timestamp fell outside the acceptance window', {
        deviceId: request.deviceId, timestamp: request.timestamp, admissionWindowMs: this.resolved.admissionWindowMs,
      })
    }
    const message = Buffer.from(`${request.deviceId}\n${request.timestamp}\n${request.nonce}`, 'utf8')
    let signature: Buffer
    try {
      signature = Buffer.from(request.signature, 'base64')
    } catch {
      throw new RemoteError('device/key-invalid', 'admission signature is not base64', { reason: 'not-base64' })
    }
    const publicKey = createPublicKey({ key: decodeDeviceKey(grant.devicePublicKey).spki, format: 'der', type: 'spki' })
    let valid = false
    try {
      valid = verifySignature(null, message, publicKey, signature)
    } catch {
      // Node throws (instead of returning false) only for a malformed signature
      // buffer or key encoding; both are the caller's invalid-signature case.
      valid = false
    }
    if (!valid) {
      throw new RemoteError('device/key-invalid', 'admission signature does not verify against the paired key', {
        reason: 'signature-mismatch',
      })
    }
    const nonceHash = sha256Hex(Buffer.from(request.nonce, 'utf8'))
    const recorded = await this.table().update(request.deviceId, (current): DeviceGrantRecord => {
      if (current.revokedAt !== undefined) {
        throw new RemoteError('device/already-revoked', 'device grant was revoked before admission committed', {
          deviceId: request.deviceId, revokedAt: current.revokedAt,
        })
      }
      const now = Date.now()
      if (Math.abs(now - request.timestamp) > this.resolved.admissionWindowMs) {
        throw new RemoteError('device/admission-expired', 'signed admission expired before its storage commit', {
          deviceId: request.deviceId, timestamp: request.timestamp, admissionWindowMs: this.resolved.admissionWindowMs,
        })
      }
      const admissionFloor = Math.max(current.admissionFloor, now - this.resolved.admissionWindowMs)
      if (request.timestamp < admissionFloor) {
        throw new RemoteError('device/replay-detected', 'admission timestamp is below the persisted replay floor', {
          deviceId: request.deviceId, reason: 'timestamp-regressed',
        })
      }
      const admissionNonces = current.admissionNonces.filter(entry => entry.timestamp >= admissionFloor)
      if (admissionNonces.some(entry => entry.nonceHash === nonceHash)) {
        throw new RemoteError('device/replay-detected', 'admission nonce was already used', {
          deviceId: request.deviceId, reason: 'nonce-reuse',
        })
      }
      if (admissionNonces.length >= this.resolved.maxAdmissionNonces) {
        throw new RemoteError('device/admission-capacity', 'device admission nonce ledger is full', {
          deviceId: request.deviceId, limit: this.resolved.maxAdmissionNonces,
          retryAt: admissionNonces.reduce((earliest, entry) => Math.min(earliest, entry.timestamp), Infinity)
            + this.resolved.admissionWindowMs + 1,
        })
      }
      return {
        ...current, lastAdmittedAt: Math.max(current.lastAdmittedAt ?? 0, request.timestamp), admissionFloor,
        admissionNonces: [...admissionNonces, { nonceHash, timestamp: request.timestamp }],
      }
    })
    return {
      deviceId: request.deviceId,
      deviceName: recorded.deviceName,
      role: recorded.role,
      permissions: [...DEVICE_ROLE_PERMISSIONS[recorded.role]],
      admittedAt: Date.now(),
    }
  }
}

export default DeviceTrustService
