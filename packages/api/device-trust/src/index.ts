/**
 * Device-trust seam on the candidate gateway: pairing issuance with one-time
 * expiring codes, redemption registering the device's Ed25519 public key, the
 * durable grant store over the storage-domain seam, signed admission, and
 * revocation. The audit decision 2026-09-20-link-access-takeover-audit names
 * this seam the single owner of device-facing access; permission execution
 * stays with the section 15 seam, which consumes each admission's section 21
 * permission set, and no non-localhost admission opens here.
 * @module @deepseek-ai/dsh-api-device-trust
 */

import { createHash, createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
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

/** One issued code awaiting redemption. */
interface PendingPairing {
  readonly pairingId: PairingCodeId
  readonly role: DeviceRole
  readonly expiresAt: number
  redeemed: boolean
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
  })

  /**
   * Pending pairing codes stay process-local: a one-time expiring secret must
   * not survive a Host restart, and the ceremony simply reissues after one.
   */
  private readonly pairings = new Map<string, PendingPairing>()
  /**
   * Recently admitted nonces per device, expiring at twice the admission
   * window: outside that horizon an admission can no longer pass the window
   * check, so the ledger entry is dead weight. Process-local on purpose —
   * the durable grant's high-water mark covers cross-restart exact replay.
   */
  private readonly recentNonces = new Map<DeviceId, Map<string, number>>()
  private readonly resolved: { pairingTtlMs: number; defaultRole: DeviceRole; admissionWindowMs: number }
  private grants?: KvTable<DeviceId, DeviceGrantRecord>

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'deviceTrust', { namespace: 'deviceTrust', capabilities: DEVICE_TRUST_REMOTE_CAPABILITIES })
    this.resolved = {
      pairingTtlMs: config.pairingTtlMs ?? 300_000,
      defaultRole: config.defaultRole ?? 'viewer',
      admissionWindowMs: config.admissionWindowMs ?? 300_000,
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
    this.pairings.set(code, { pairingId, role: assigned, expiresAt, redeemed: false })
    return { pairingId, code, role: assigned, expiresAt }
  }

  /**
   * Redeem one pairing code with the device's freshly generated Ed25519 key.
   * The grant is durable before the code is consumed: a failed store write
   * leaves the code redeemable instead of burning it.
   * @param request - the single-use code, a device name, and the base64 SPKI
   * DER public key.
   * @returns the created grant identity.
   * @throws RemoteError `device/pairing-invalid`, `device/pairing-expired`,
   * `device/key-invalid`, or `gateway/bad-request`.
   */
  @Remote('redeemPairing')
  async redeemPairing(request: RedeemPairingRequest): Promise<RedeemPairingResult> {
    const pending = this.pairings.get(request.code)
    if (pending === undefined || pending.redeemed) {
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
    const { fingerprint } = decodeDeviceKey(request.devicePublicKey)
    const pairedAt = Date.now()
    const deviceId = DeviceId(`device-${randomUUID()}`)
    await this.table().put(deviceId, {
      deviceName, role: pending.role,
      devicePublicKey: request.devicePublicKey, keyFingerprint: fingerprint, pairedAt,
    })
    pending.redeemed = true
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
      ...grant.revokedAt === undefined ? {} : { revokedAt: grant.revokedAt },
    }))
  }

  /**
   * Revoke one grant. A revoked grant stays listed with its revocation time;
   * a later role-mapped admission must treat it as refused.
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
    return { deviceId: request.deviceId, revokedAt }
  }

  /**
   * Verify one signed admission and return the device's identity with its
   * section 21 permission set. Checks run cheapest-first: the grant must
   * exist and be active, the signed timestamp must sit inside the admission
   * window, and the Ed25519 signature over `deviceId + "\n" + timestamp +
   * "\n" + nonce` (UTF-8) must verify against the paired key. An admission
   * that replays an already-accepted one — a timestamp older than the grant's
   * durable high-water mark, or a nonce this process or the persisted
   * last-admission pair has already seen — is refused as replay before the
   * grant records the new high-water mark. The Gateway resolves one
   * admission per Remote event stream open and derives the client's reply
   * permissions from the returned set.
   * @param request - the device's signed admission message.
   * @returns the admitted identity, role, and permissions.
   * @throws RemoteError `device/not-found`, `device/already-revoked`,
   * `device/admission-expired`, `device/key-invalid`, `device/replay-detected`,
   * or `gateway/bad-request`.
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
    if (grant.lastAdmittedAt !== undefined && request.timestamp < grant.lastAdmittedAt) {
      throw new RemoteError('device/replay-detected', 'admission timestamp is older than the last accepted admission', {
        deviceId: request.deviceId, reason: 'timestamp-regressed',
      })
    }
    if (this.recentNonce(request.deviceId, request.nonce)) {
      throw new RemoteError('device/replay-detected', 'admission nonce was already used', {
        deviceId: request.deviceId, reason: 'nonce-reuse',
      })
    }
    this.rememberNonce(request.deviceId, request.nonce)
    const recorded = await this.table().update(request.deviceId, (current): DeviceGrantRecord => {
      if (current.lastAdmittedAt !== undefined && request.timestamp < current.lastAdmittedAt) {
        throw new RemoteError('device/replay-detected', 'admission timestamp is older than the last accepted admission', {
          deviceId: request.deviceId, reason: 'timestamp-regressed',
        })
      }
      if (current.lastAdmittedAt === request.timestamp && current.lastAdmittedNonce === request.nonce) {
        throw new RemoteError('device/replay-detected', 'admission nonce was already used', {
          deviceId: request.deviceId, reason: 'nonce-reuse',
        })
      }
      return { ...current, lastAdmittedAt: request.timestamp, lastAdmittedNonce: request.nonce }
    })
    return {
      deviceId: request.deviceId,
      deviceName: recorded.deviceName,
      role: recorded.role,
      permissions: [...DEVICE_ROLE_PERMISSIONS[recorded.role]],
      admittedAt: Date.now(),
    }
  }

  /** Whether this process already admitted `nonce` for the device inside the ledger horizon. */
  private recentNonce(deviceId: DeviceId, nonce: string): boolean {
    const ledger = this.recentNonces.get(deviceId)
    if (ledger === undefined) return false
    const seenAt = ledger.get(nonce)
    if (seenAt === undefined) return false
    if (Date.now() > seenAt) {
      ledger.delete(nonce)
      return false
    }
    return true
  }

  /** Record `nonce` for the device, dropping entries whose horizon has passed. */
  private rememberNonce(deviceId: DeviceId, nonce: string): void {
    const horizon = Date.now() + 2 * this.resolved.admissionWindowMs
    let ledger = this.recentNonces.get(deviceId)
    if (ledger === undefined) {
      ledger = new Map()
      this.recentNonces.set(deviceId, ledger)
    }
    for (const [entry, expiresAt] of ledger) {
      if (Date.now() > expiresAt) ledger.delete(entry)
    }
    ledger.set(nonce, horizon)
  }
}

export default DeviceTrustService
