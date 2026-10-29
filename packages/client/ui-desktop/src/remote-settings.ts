/**
 * Cross-device remote preferences stored in the Host user-settings document.
 * This file mirrors the `link-settings` roster entry's configuration the
 * `dsh-link-settings` host bridge owns; the values commit through the shared
 * config-form service, and the bridge applies them live to the link carrier.
 */

/** Roster entry whose live configuration the host link-settings bridge owns (mirror). */
export const REMOTE_SETTINGS_ENTRY = 'link-settings'

/** Field carrying whether the TLS carrier listens for paired devices. */
export const REMOTE_ENABLED_FIELD = 'enabled'

/** Field carrying whether paired controllers may answer remote interactions. */
export const REMOTE_APPROVAL_FIELD = 'allowRemoteApproval'

/** Field carrying the device-facing host name. */
export const REMOTE_DEVICE_NAME_FIELD = 'deviceName'

/** The `link-settings` entry's section as the browser form validates it. */
export interface RemoteSettings {
  /** Whether the TLS carrier listens for paired devices; off by default. */
  enabled: boolean
  /** Whether paired controllers may answer remote approvals and questions. */
  allowRemoteApproval: boolean
  /** Host name shown to paired devices; empty resets to the OS hostname. */
  deviceName: string
}
