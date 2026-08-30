/**
 * Host Remote owner for the local link-administration surface. The `link`
 * namespace serves the cross-device settings page: carrier status with the
 * LAN endpoint and bind diagnostics, one-time pairing issuance, and
 * trusted-device listing and revocation. It dispatches only through local
 * carriers — the remote allowlist carries none of these endpoints, so a
 * paired device can never mint pairings or revoke its peers.
 *
 * @module @deepseek-ai/dsh-api-link-controller
 */

import { Context } from '@deepseek-ai/cordis'
import type { DeviceId, PairedDevice } from '@deepseek-ai/dsh-device-trust'
import type { LinkAccessService } from '@deepseek-ai/dsh-link-access'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { LinkDeviceValue, LinkPairingValue, LinkStatusValue } from './types.ts'

export type { LinkDeviceValue, LinkError, LinkPairingValue, LinkStatusValue } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `link` Remote namespace. */
    linkController: LinkController
  }
}

/**
 * Host service backing the generated `ctx.remote.link` namespace. Every
 * method reads the link-access carrier; a composition without the carrier
 * fails each call with `link-unavailable` instead of failing at load.
 */
export class LinkController extends TypertRemoteService {
  /**
   * Provide the Host service face for the `link` namespace.
   * @param ctx - Host context whose composition may mount the link carrier.
   */
  constructor(ctx: Context) {
    super(ctx, 'linkController', { namespace: 'link' })
  }

  /** The mounted link carrier, or the `link-unavailable` refusal. */
  private link(): LinkAccessService {
    const link = this.ctx.get('linkAccess')
    if (link === undefined) {
      throw new TypertRemoteFailure({
        code: 'link-unavailable',
        message: 'this deployment composes no link carrier',
        details: {},
      })
    }
    return link
  }

  /**
   * Report the live carrier and identity facts the settings page renders:
   * listening state, LAN endpoint, certificate fingerprint, bind diagnostics,
   * device-facing name, the approval switch, and the trusted-device count.
   * @returns the cross-device status row.
   * @throws TypertRemoteFailure when no link carrier is mounted.
   */
  @Remote
  async status(): Promise<LinkStatusValue> {
    const link = this.link()
    const [carrier, devices] = await Promise.all([link.carrierStatus(), link.trustedDevices()])
    return {
      listening: carrier.listening,
      ...carrier.endpoint === undefined ? {} : { endpoint: carrier.endpoint },
      ...carrier.spkiFingerprint === undefined ? {} : { spkiFingerprint: carrier.spkiFingerprint },
      ...carrier.bindError === undefined ? {} : { bindError: carrier.bindError },
      hostName: link.deviceName(),
      allowRemoteApproval: link.isRemoteApprovalAllowed(),
      deviceCount: devices.length,
    }
  }

  /**
   * Issue one pairing payload for the QR display: host identity, endpoint,
   * certificate fingerprint, and a one-time short-lived code.
   * @returns the payload rendered into the pairing QR code.
   * @throws TypertRemoteFailure when no carrier is mounted or its carrier is stopped or failed to bind.
   */
  @Remote
  async createPairing(): Promise<LinkPairingValue> {
    const link = this.link()
    try {
      return await link.createPairing()
    } catch {
      throw new TypertRemoteFailure({
        code: 'link-disabled',
        message: 'the link carrier is stopped or failed to bind; enable cross-device access first',
        details: {},
      })
    }
  }

  /**
   * List every trusted device, revoked ones included, for the device manager.
   * @returns one row per device record; the device public key never rides the wire.
   * @throws TypertRemoteFailure when no link carrier is mounted.
   */
  @Remote
  async devices(): Promise<LinkDeviceValue[]> {
    return (await this.link().trustedDevices()).map(deviceView)
  }

  /**
   * Revoke one paired device; its next request is refused.
   * @param deviceId - identity of the device to revoke.
   * @returns the device row after revocation, or `undefined` when unknown.
   * @throws TypertRemoteFailure when the id is empty or no link carrier is mounted.
   */
  @Remote
  async revokeDevice(deviceId: string): Promise<LinkDeviceValue | undefined> {
    if (deviceId.length === 0) {
      throw new TypertRemoteFailure({
        code: 'bad-request',
        message: 'device id must not be empty',
        details: {},
      })
    }
    const revoked = await this.link().revokeDevice(deviceId as DeviceId)
    return revoked === undefined ? undefined : deviceView(revoked)
  }
}

/** Project one trust-store record onto its wire row; the public key stays behind. */
function deviceView(device: PairedDevice): LinkDeviceValue {
  return {
    deviceId: device.deviceId,
    name: device.name,
    role: device.role,
    createdAt: device.createdAt,
    ...device.lastSeenAt === undefined ? {} : { lastSeenAt: device.lastSeenAt },
    ...device.revokedAt === undefined ? {} : { revokedAt: device.revokedAt },
  }
}

export default LinkController
