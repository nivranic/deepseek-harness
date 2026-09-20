/**
 * Wire types of the device-trust seam: pairing issuance, device grants, and
 * the Remote failure details the service answers with. The audit decision
 * 2026-09-20-link-access-takeover-audit places device-facing access on the
 * candidate gateway; these types are that seam's single vocabulary home.
 * @module @deepseek-ai/dsh-api-device-trust/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one paired device grant. */
export type DeviceId = Branded<'DeviceId'>

/** Identity of one issued pairing code. */
export type PairingCodeId = Branded<'PairingCodeId'>

/**
 * Section 21 role table wire names: Viewer, Collaborator, Controller, Owner.
 * A role names what the Client may ask next; permission execution stays with
 * the section 15 Host-authoritative seam, which reconciles roles onto
 * `requiredPermission` checks.
 */
export type DeviceRole = 'viewer' | 'collaborator' | 'controller' | 'owner'

/**
 * One grantable capability kind from the section 21 table columns. Roles hold
 * these as sets via {@link DEVICE_ROLE_PERMISSIONS}; the section 15 seam checks
 * the two `*.respond` kinds against pending interactions' `requiredPermission`.
 */
export type DevicePermission =
  | 'view'
  | 'prompt.send'
  | 'question.respond'
  | 'approval.respond'
  | 'device.admin'

/** One durable device grant as the store holds it. */
export interface DeviceGrant {
  readonly deviceId: DeviceId
  readonly deviceName: string
  readonly role: DeviceRole
  /** Base64 SPKI DER of the device's Ed25519 key registered at redemption. */
  readonly devicePublicKey: string
  /** Lowercase hex SHA-256 of the SPKI DER — the display fingerprint. */
  readonly keyFingerprint: string
  /** Epoch ms when the pairing was redeemed. */
  readonly pairedAt: number
  /** Epoch ms when the grant was revoked; absent while active. */
  readonly revokedAt?: number
}

/** Grant projection for listing: key material stays in the store. */
export interface DeviceView {
  readonly deviceId: DeviceId
  readonly deviceName: string
  readonly role: DeviceRole
  readonly keyFingerprint: string
  readonly pairedAt: number
  readonly revokedAt?: number
}

/** One issued one-time pairing code with its expiry and assigned role. */
export interface PairingIssuance {
  readonly pairingId: PairingCodeId
  /** The single-use secret the device presents at redemption. */
  readonly code: string
  readonly role: DeviceRole
  /** Epoch ms after which redemption fails with `device/pairing-expired`. */
  readonly expiresAt: number
}

/** Device-side redemption request over the wire. */
export interface RedeemPairingRequest {
  readonly code: string
  readonly deviceName: string
  /** Base64 SPKI DER of the device's freshly generated Ed25519 key. */
  readonly devicePublicKey: string
}

/** Acknowledged grant identity returned once at redemption. */
export interface RedeemPairingResult {
  readonly deviceId: DeviceId
  readonly role: DeviceRole
  readonly keyFingerprint: string
  readonly pairedAt: number
}

/** Revoke request for one grant. */
export interface RevokeDeviceRequest {
  readonly deviceId: DeviceId
}

/** Revoke acknowledgement. */
export interface RevokeDeviceResult {
  readonly deviceId: DeviceId
  readonly revokedAt: number
}

/**
 * Signed admission request a device presents when opening a Gateway Remote
 * event stream. The signature is base64 Ed25519 over the UTF-8 bytes of
 * `deviceId + "\n" + timestamp` (decimal epoch ms) made with the paired key.
 */
export interface AdmitDeviceRequest {
  readonly deviceId: DeviceId
  /** Epoch ms when the device signed; accepted within the admission window. */
  readonly timestamp: number
  /** Base64 Ed25519 signature over the canonical admission message. */
  readonly signature: string
}

/** Admission outcome: the device's identity, role, and its permission set. */
export interface DeviceAdmission {
  readonly deviceId: DeviceId
  readonly deviceName: string
  readonly role: DeviceRole
  readonly permissions: readonly DevicePermission[]
  /** Epoch ms when the Host accepted the admission. */
  readonly admittedAt: number
}

/**
 * Failure details the device-trust surface answers with. Catalog reads and
 * mutations share this vocabulary with the Client Remote result.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The presented code is unknown or was already redeemed. */
    'device/pairing-invalid': { readonly code: string }
    /** The presented code expired before redemption. */
    'device/pairing-expired': { readonly code: string; readonly expiresAt: number }
    /** The addressed device grant does not exist. */
    'device/not-found': { readonly deviceId: string }
    /** The addressed device grant was already revoked. */
    'device/already-revoked': { readonly deviceId: string; readonly revokedAt: number }
    /** The presented public key is not a base64 Ed25519 SPKI DER. */
    'device/key-invalid': { readonly reason: string }
    /** The signed admission timestamp fell outside the acceptance window. */
    'device/admission-expired': {
      readonly deviceId: string
      readonly timestamp: number
      readonly admissionWindowMs: number
    }
  }
}
