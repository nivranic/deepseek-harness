/**
 * @deepseek-ai/dsh-link-settings — the settings bridge for the native remote
 * access carrier. It owns the `remote` user-settings namespace — enable
 * cross-device access, allow remote approval, and the device-facing host
 * name — and applies every commit live to `ctx.linkAccess`: flipping the TLS
 * listener, the independent approval switch, and the advertised name. A
 * composition that mounts this bridge makes the namespace the owner of those
 * three fields; headless deployments keep configuring the carrier plugin
 * itself.
 * @module @deepseek-ai/dsh-link-settings
 */

import { hostname } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
// Activates the linkAccess Context merge the bridge drives.
import type {} from '@deepseek-ai/dsh-link-access'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by this bridge. */
export const REMOTE_SETTINGS_NAMESPACE = 'remote'

/** Field carrying whether the TLS carrier listens for paired devices. */
export const REMOTE_ENABLED_FIELD = 'enabled'

/** Field carrying whether paired controllers may answer remote interactions. */
export const REMOTE_APPROVAL_FIELD = 'allowRemoteApproval'

/** Field carrying the device-facing host name. */
export const REMOTE_DEVICE_NAME_FIELD = 'deviceName'

/** The `remote` namespace section. */
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

/** Durable remote section shared by the Host schema and the browser scope. */
export const RemoteSettingsSchema: z<RemoteSettings> = z.object({
  [REMOTE_ENABLED_FIELD]: z.boolean().default(false),
  [REMOTE_APPROVAL_FIELD]: z.boolean().default(false),
  [REMOTE_DEVICE_NAME_FIELD]: z.string().default(hostname()),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Applies the `remote` settings namespace to the link carrier. */
    linkSettings: LinkSettingsService
  }
}

/**
 * The remote settings bridge: registers the `remote` namespace on mount and
 * pushes every resolved value into the link-access carrier.
 * @typert service linkSettings
 */
export class LinkSettingsService extends Service {
  static inject = ['settings', 'linkAccess']

  /**
   * Register the namespace, apply its current value once, and follow every
   * commit for the bridge's lifetime.
   * @param ctx - Host context with the settings service and the link carrier.
   */
  constructor(ctx: Context) {
    super(ctx, 'linkSettings')
    const scope = ctx.settings.register(settingsNamespace(REMOTE_SETTINGS_NAMESPACE), RemoteSettingsSchema)
    const follow = (value: RemoteSettings): void => {
      void this.apply(value)
    }
    follow(scope.get())
    const unwatch = scope.watch(follow)
    ctx.effect(() => () => { unwatch() }, 'link-settings.watch')
  }

  /**
   * Push one resolved section into the carrier: name and approval switch
   * first, then the listener, so a newly enabled carrier advertises the
   * committed identity. A bind failure is contained here — the carrier
   * reports it through its status and the namespace keeps the user's intent.
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
