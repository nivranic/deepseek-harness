/**
 * Browser-safe value vocabulary of the `link` Remote namespace: the local
 * administration surface over the remote link carrier. Values never carry a
 * device public key or any credential material.
 *
 * @module @deepseek-ai/dsh-api-link-controller/types
 */

/** The QR payload a host issues for one pairing, re-used on the wire unchanged. */
export type LinkPairingValue = {
  readonly v: 1
  readonly kind: 'dsh-link-pairing'
  readonly hostId: string
  readonly hostName: string
  /** Absolute `https://` endpoint the device connects to. */
  readonly endpoint: string
  /** Lowercase hex SHA-256 of the host certificate's SubjectPublicKeyInfo DER. */
  readonly spkiFingerprint: string
  readonly code: string
  readonly expiresAt: number
}

/** Live carrier and identity facts for the cross-device settings page. */
export interface LinkStatusValue {
  /** Whether the TLS carrier is currently listening. */
  readonly listening: boolean
  /** The bound `https://` endpoint, present while listening. */
  readonly endpoint?: string
  /** Certificate fingerprint devices pin, present while listening. */
  readonly spkiFingerprint?: string
  /** Why the last bind attempt failed, present after a failed attempt. */
  readonly bindError?: string
  /** The device-facing host name. */
  readonly hostName: string
  /** Whether paired controllers may currently answer remote interactions. */
  readonly allowRemoteApproval: boolean
  /** Trusted devices, revoked ones included. */
  readonly deviceCount: number
}

/** One trusted-device row for the device manager. */
export interface LinkDeviceValue {
  readonly deviceId: string
  readonly name: string
  readonly role: 'observer' | 'controller' | 'administrator'
  /** Epoch milliseconds. */
  readonly createdAt: number
  /** Epoch milliseconds of the last authorized request, when one occurred. */
  readonly lastSeenAt?: number
  /** Epoch milliseconds of revocation; absent while the device is trusted. */
  readonly revokedAt?: number
}

/** Stable link failure details returned by the `link` namespace. */
export interface LinkErrorDetailsMap {
  /** The composition mounts no link carrier; the settings page cannot administer it. */
  'link-unavailable': Record<string, never>
  /** The carrier is stopped or failed to bind, so pairing cannot be issued. */
  'link-disabled': Record<string, never>
}

/** Link business failure carried by a rejected Remote call. */
export type LinkError = {
  [Code in keyof LinkErrorDetailsMap]: {
    readonly code: Code
    readonly message: string
    readonly details: LinkErrorDetailsMap[Code]
  }
}[keyof LinkErrorDetailsMap]
