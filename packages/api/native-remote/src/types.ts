/** Public native listener metadata and the short-lived out-of-band pairing payload. */

import type { DeviceRole } from '@deepseek-ai/dsh-api-device-trust/types'
import type { HostId } from '@deepseek-ai/dsh-api-host-description/types'

/** Public listener facts available to an authenticated device administrator. */
export interface NativeRemoteInfo {
  /** Configured literal interface; an all-interface address is not a pairing destination. */
  readonly bindHost: '127.0.0.1' | '0.0.0.0' | '::1' | '::'
  /** Actual TCP port, including an OS-assigned value. */
  readonly port: number
  /** Lowercase SHA-256 of the certificate SPKI, independently of its DNS name or issuing CA. */
  readonly spkiFingerprint: string
}

/** Single-use pairing information displayed by an authenticated Host operator. */
export interface NativePairingPayload {
  /** Distinguishes Gateway pairing from the retired Link fixture format. */
  readonly kind: 'dsh-native-pairing'
  /** Pairing payload format, independent of the Gateway API and Session formats. */
  readonly version: 1
  /** Operator-supplied reachable HTTPS origin of the native listener. */
  readonly endpoint: string
  /** Persistent Host identity to confirm after device admission. */
  readonly hostId: HostId
  /** Operator-visible Host label, never an identity check. */
  readonly displayName: string
  /** Certificate SPKI pin to verify before sending the pairing secret. */
  readonly spkiFingerprint: string
  /** Single-use secret; keep out of storage, diagnostics, and logs. */
  readonly code: string
  /** Host-enforced expiration, in epoch milliseconds. */
  readonly expiresAt: number
  /** Role selected by the operator and fixed by Device Trust issuance. */
  readonly role: DeviceRole
}
