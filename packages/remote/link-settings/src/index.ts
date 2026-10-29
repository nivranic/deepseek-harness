/**
 * @deepseek-ai/dsh-link-settings — the settings bridge for the native remote
 * access carrier. The `remote` fields — enable cross-device access, allow
 * remote approval, and the device-facing host name — are this entry's volatile
 * plugin configuration, editable through the shared settings forms and applied
 * live to `ctx.linkAccess`: flipping the TLS listener, the independent
 * approval switch, and the advertised name. A composition that mounts this
 * bridge makes its entry the owner of those three fields; headless
 * deployments keep configuring the carrier plugin itself.
 * @module @deepseek-ai/dsh-link-settings
 */

import { hostname } from 'node:os'
import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
// Activates the linkAccess Context merge the bridge drives.
import type {} from '@deepseek-ai/dsh-link-access'
// Type-only: the settings Context merge and the `settings/document-updated`
// event that follows every settings-form write.
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** The `remote` section as the bridge resolves it. */
export interface RemoteSettings {
  /** Whether the TLS carrier listens for paired devices; off by default. */
  enabled: boolean
  /**
   * Whether paired controllers may answer remote approvals and questions;
   * off by default — the ability to prompt never implies the ability to approve.
   */
  allowRemoteApproval: boolean
  /** Host name shown to paired devices; empty resets to the OS hostname. */
  deviceName: string
}

/** The bridge's live configuration: the `remote` fields as volatile plugin config. */
export interface LinkSettingsConfig {
  /** Live listener switch. */
  enabled: Volatile<boolean>
  /** Live approval switch. */
  allowRemoteApproval: Volatile<boolean>
  /** Live device-facing host name. */
  deviceName: Volatile<string>
}

/** The `remote` section of this entry's configuration. */
export const Config = z.object({
  enabled: z.boolean().default(false).volatile(),
  allowRemoteApproval: z.boolean().default(false).volatile(),
  deviceName: z.string().default(hostname()).volatile(),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Applies the `remote` settings to the link carrier. */
    linkSettings: LinkSettingsService
  }
}

/**
 * The remote settings bridge: applies the entry's live configuration to the
 * link-access carrier on mount and after every settings-form write.
 * @typert service linkSettings
 */
export class LinkSettingsService extends Service {
  static inject = ['linkAccess']
  static Config = Config

  /**
   * Apply the current configuration once and follow every settings-form
   * write for the bridge's lifetime.
   * @param ctx - Host context with the link carrier.
   * @param config - the entry's live volatile configuration.
   */
  constructor(ctx: Context, config: LinkSettingsConfig) {
    super(ctx, 'linkSettings')
    const apply = (): void => {
      void this.apply({
        enabled: config.enabled.get(),
        allowRemoteApproval: config.allowRemoteApproval.get(),
        deviceName: config.deviceName.get(),
      })
    }
    apply()
    // Volatile fields update in place without remounting the entry, so a
    // settings write lands here as an event, not as a new instance.
    ctx.on('settings/document-updated', () => { apply() })
  }

  /**
   * Push one resolved section into the carrier: name and approval switch
   * first, then the listener, so a newly enabled carrier advertises the
   * committed identity. A bind failure is contained here — the carrier
   * reports it through its status and the entry keeps the user's intent.
   * @param value - resolved `remote` section.
   */
  private async apply(value: RemoteSettings): Promise<void> {
    const link = this.ctx.linkAccess
    link.setDeviceName(value.deviceName === '' ? hostname() : value.deviceName)
    link.setAllowRemoteApproval(value.allowRemoteApproval)
    await link.setCarrierEnabled(value.enabled).catch((error: unknown) => {
      this.ctx.logger.warn('link-settings: applying the remote settings failed: %s', messageOf(error))
    })
  }
}

function messageOf(error: unknown): string {
  /* v8 ignore next -- every thrown boundary value in this package is an Error; the String arm contains a foreign throw. */
  return error instanceof Error ? error.message : String(error)
}

export default LinkSettingsService
