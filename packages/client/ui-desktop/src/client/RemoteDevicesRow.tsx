/**
 * Cross-device settings block for the `remote` namespace: the live LAN
 * status, the pair-new-device dialog with its QR payload, and the
 * trusted-device list with revocation. All facts arrive through the injected
 * `link` Remote API; the row owns no host state.
 */

import { useCallback, useEffect, useState } from 'react'
import type { LinkDeviceValue, LinkPairingValue, LinkStatusValue } from '@deepseek-ai/dsh-api-link-controller/types'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { renderSVG } from 'uqr'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteSettings } from '../remote-settings.ts'
import css from './RemoteDevicesRow.module.css'

/** The `link` Remote surface this row consumes. */
export interface LinkAdminApi {
  /** Live carrier and identity facts for the status line. */
  readonly status: () => Promise<LinkStatusValue>
  /** Issue the one-time pairing payload for the QR display. */
  readonly createPairing: () => Promise<LinkPairingValue>
  /** List trusted devices, revoked ones included. */
  readonly devices: () => Promise<readonly LinkDeviceValue[]>
  /** Revoke one paired device.
   * @param deviceId - identity of the device to revoke.
   * @returns the row after revocation, or undefined when unknown.
   */
  readonly revokeDevice: (deviceId: string) => Promise<LinkDeviceValue | undefined>
}

/** Registration-side business face for the devices block. */
export interface RemoteDevicesRowInjected {
  hooks: {
    /** Remote namespace snapshot bound by the renderer. */
    remote: ObservableSnapshot<SettingsScopeSnapshot<RemoteSettings>>
  }
  /** The `link` Remote API wired by the renderer. */
  api: LinkAdminApi
}

/** Full component props. */
export type RemoteDevicesRowComponentProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.desktop'>
  & InjectFace<RemoteDevicesRowInjected>

/**
 * Render the cross-device status, pairing dialog, and trusted-device list.
 * @param props - composed slot props.
 * @returns the block, or null while the namespace is loading or absent.
 */
export function RemoteDevicesRow({ t, useRemote, api }: RemoteDevicesRowComponentProps) {
  const snapshot = useRemote(s => s)
  const enabled = snapshot.value?.enabled ?? false
  const [status, setStatus] = useState<LinkStatusValue | undefined>(undefined)
  const [devices, setDevices] = useState<readonly LinkDeviceValue[] | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [pairing, setPairing] = useState<LinkPairingValue | undefined>(undefined)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextStatus, nextDevices] = await Promise.all([api.status(), api.devices()])
      setStatus(nextStatus)
      setDevices(nextDevices)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh, enabled, pairing?.code])

  if (snapshot.status !== 'ready' || snapshot.value === undefined) return null

  const openPairing = (): void => {
    void api.createPairing().then(setPairing, () => { setPairing(undefined) })
  }
  const revoke = (deviceId: string): void => {
    void api.revokeDevice(deviceId).then(() => { void refresh() })
  }

  return (
    <div className={css.block}>
      <div className={css.heading}>
        <div className={css.headingText}>
          <div className={css.title}>{t('devicesTitle')}</div>
          <div className={css.desc}>{t('devicesDescription')}</div>
        </div>
        <Button variant="primary" disabled={!enabled} onClick={openPairing}>{t('pairNewDevice')}</Button>
      </div>
      <div className={css.status}>
        {status === undefined
          ? (failed ? t('loadFailed') : '')
          : status.listening
            ? `${t('lanListening')} — ${status.endpoint ?? ''}`
            : status.bindError === undefined ? t('lanStopped') : `${t('lanBindError')} — ${status.bindError}`}
      </div>
      <ul className={css.list}>
        {devices === undefined || devices.length === 0
          ? <li className={css.empty}>{t('noDevices')}</li>
          : devices.map(device => (
            <li key={device.deviceId} className={css.device}>
              <div className={css.deviceText}>
                <span className={css.deviceName}>
                  {device.name}
                  {device.revokedAt === undefined ? '' : ` — ${t('revoked')}`}
                </span>
                <span className={css.deviceMeta}>
                  {t(device.role)}
                  {' · '}
                  {device.lastSeenAt === undefined ? t('neverSeen') : new Date(device.lastSeenAt).toLocaleString()}
                </span>
              </div>
              {device.revokedAt === undefined
                ? <button type="button" className={css.revoke} onClick={() => { revoke(device.deviceId) }}>{t('revoke')}</button>
                : undefined}
            </li>
          ))}
      </ul>
      <Modal
        open={pairing !== undefined}
        onClose={() => { setPairing(undefined) }}
        title={t('pairTitle')}
        description={enabled ? t('pairDescription') : t('pairUnavailable')}
        closeLabel={t('close')}
      >
        {pairing === undefined ? undefined : (
          <div className={css.pairBody}>
            <div
              className={css.qr}
              role="img"
              aria-label={`${t('pairManualCode')}: ${pairing.code}`}
              dangerouslySetInnerHTML={{ __html: renderSVG(JSON.stringify(pairing)) }}
            />
            <div className={css.manual}>
              <span className={css.manualLabel}>{t('pairManualCode')}</span>
              <code className={css.code}>{pairing.code}</code>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
