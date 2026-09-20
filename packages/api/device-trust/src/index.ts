/**
 * Device-trust seam on the candidate gateway: pairing issuance with one-time
 * expiring codes, redemption registering the device's Ed25519 public key, the
 * process-local grant store, and revocation. The audit decision
 * 2026-09-20-link-access-takeover-audit names this seam the single owner of
 * device-facing access; permission execution stays with the section 15 seam
 * and no non-localhost admission opens here.
 * @module @deepseek-ai/dsh-api-device-trust
 */

import { createHash, randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { RemoteError, TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { DEVICE_TRUST_REMOTE_CAPABILITIES } from './capabilities.ts'
import type {
  DeviceGrant,
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

/** Config: deployment-varying choices of the pairing ceremony. */
export interface Config {
  /** Lifetime of an issued pairing code in ms (default five minutes). */
  pairingTtlMs?: number
  /** Role assigned at redemption when issuance named none (default viewer). */
  defaultRole?: DeviceRole
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

/** Device-trust service (`ctx.deviceTrust`) over the process-local grant store. */
export class DeviceTrustService extends TypertRemoteService {
  static Config: z<Config> = z.object({
    pairingTtlMs: z.number().step(1).min(1).default(300_000),
    defaultRole: z.union([
      z.const('viewer'),
      z.const('collaborator'),
      z.const('admin'),
    ]).default('viewer'),
  })

  private readonly grants = new Map<DeviceId, DeviceGrant>()
  private readonly pairings = new Map<string, PendingPairing>()
  private readonly resolved: { pairingTtlMs: number; defaultRole: DeviceRole }

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'deviceTrust', { namespace: 'deviceTrust', capabilities: DEVICE_TRUST_REMOTE_CAPABILITIES })
    this.resolved = {
      pairingTtlMs: config.pairingTtlMs ?? 300_000,
      defaultRole: config.defaultRole ?? 'viewer',
    }
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
   * @param request - the single-use code, a device name, and the base64 SPKI
   * DER public key.
   * @returns the created grant identity.
   * @throws RemoteError `device/pairing-invalid`, `device/pairing-expired`,
   * or `device/key-invalid`.
   */
  @Remote('redeemPairing')
  redeemPairing(request: RedeemPairingRequest): RedeemPairingResult {
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
    pending.redeemed = true
    const pairedAt = Date.now()
    const deviceId = DeviceId(`device-${randomUUID()}`)
    this.grants.set(deviceId, {
      deviceId, deviceName, role: pending.role,
      devicePublicKey: request.devicePublicKey, keyFingerprint: fingerprint, pairedAt,
    })
    return { deviceId, role: pending.role, keyFingerprint: fingerprint, pairedAt }
  }

  /**
   * List every grant, active and revoked; key material stays in the store.
   * @returns fresh views in pairing order.
   */
  @Remote('listDevices')
  listDevices(): readonly DeviceView[] {
    return [...this.grants.values()].map(grant => ({
      deviceId: grant.deviceId,
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
  revokeDevice(request: RevokeDeviceRequest): RevokeDeviceResult {
    const grant = this.grants.get(request.deviceId)
    if (grant === undefined) {
      throw new RemoteError('device/not-found', 'no device grant with the addressed id', { deviceId: request.deviceId })
    }
    if (grant.revokedAt !== undefined) {
      throw new RemoteError('device/already-revoked', 'device grant was already revoked', {
        deviceId: request.deviceId, revokedAt: grant.revokedAt,
      })
    }
    const revokedAt = Date.now()
    this.grants.set(request.deviceId, { ...grant, revokedAt })
    return { deviceId: request.deviceId, revokedAt }
  }
}

export default DeviceTrustService
