/**
 * Cross-device remote preferences stored in the Host user-settings document.
 * This file mirrors the `remote` namespace the `dsh-link-settings` host plugin
 * owns and registers; the values commit through the shared settings scope, and
 * the bridge applies them live to the link carrier.
 */

/** Settings namespace owned by the host link-settings bridge (mirror). */
export const REMOTE_SETTINGS_NAMESPACE = 'remote'

/** Field carrying whether the TLS carrier listens for paired devices. */
export const REMOTE_ENABLED_FIELD = 'enabled'

/** Field carrying whether paired controllers may answer remote interactions. */
export const REMOTE_APPROVAL_FIELD = 'allowRemoteApproval'

/** Field carrying the device-facing host name. */
export const REMOTE_DEVICE_NAME_FIELD = 'deviceName'

/** The `remote` namespace section as the browser scope validates it. */
export interface RemoteSettings {
  /** Whether the TLS carrier listens for paired devices; off by default. */
  enabled: boolean
  /** Whether paired controllers may answer remote approvals and questions. */
  allowRemoteApproval: boolean
  /** Host name shown to paired devices; empty resets to the OS hostname. */
  deviceName: string
}
