/** Transient pairing presentation; codes never enter storage and disappear on expiry or unmount. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import type { DeviceRole, NativePairingPayload } from '@deepseek-ai/dsh-api-remotes/client'
import type { DevicesSettingsSectionProps } from './DevicesSettingsSection.tsx'
import css from './DevicesSettingsSection.module.css'

/** Generation-bound pairing operations supplied by the Settings registration. */
export interface PairingActions {
  /** Issue after validating the reachable HTTPS origin; undefined means the entered address is invalid. */
  create: (endpoint: string, role: DeviceRole) => Promise<NativePairingPayload | undefined>
}

type PairingView =
  | { readonly status: 'editing' | 'working' | 'expired' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly payload: NativePairingPayload }

const ROLES: readonly DeviceRole[] = ['viewer', 'collaborator', 'controller', 'owner']

/**
 * Display a short-lived QR and copyable payload for the chosen Host and role.
 * @param props - connection-bound issuance, localized copy, error presentation, and close action.
 * @returns pairing editor and the current unexpired payload.
 */
export function PairingPanel({ actions, t, formatTime, failureCopy, close }: {
  readonly actions: PairingActions
  readonly t: DevicesSettingsSectionProps['t']
  readonly formatTime: (epochMs: number) => string
  readonly failureCopy: (error: unknown) => string
  readonly close: () => void
}): ReactNode {
  const [endpoint, setEndpoint] = useState('')
  const [role, setRole] = useState<DeviceRole>('viewer')
  const [view, setView] = useState<PairingView>({ status: 'editing' })
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const operation = useRef<AbortController>()
  useEffect(() => () => { operation.current?.abort() }, [])
  const begin = (): AbortController => {
    operation.current?.abort()
    const controller = new AbortController()
    operation.current = controller
    return controller
  }
  const payload = view.status === 'ready' ? view.payload : undefined
  useEffect(() => {
    if (payload === undefined) return
    let timer: ReturnType<typeof setTimeout>
    const expire = (): void => {
      const remaining = payload.expiresAt - Date.now()
      if (remaining <= 0) {
        operation.current?.abort()
        setView({ status: 'expired' })
      }
      else timer = setTimeout(expire, Math.min(remaining, 2_147_483_647))
    }
    expire()
    return () => { clearTimeout(timer) }
  }, [payload])

  const create = async (): Promise<void> => {
    const controller = begin()
    setView({ status: 'working' })
    setCopyStatus('idle')
    try {
      const next = await actions.create(endpoint, role)
      if (controller.signal.aborted) return
      setView(next === undefined ? { status: 'error', message: t('pairing.invalidAddress') }
        : next.expiresAt <= Date.now() ? { status: 'expired' } : { status: 'ready', payload: next })
    } catch (error) {
      if (!controller.signal.aborted) setView({ status: 'error', message: failureCopy(error) })
    }
  }
  const copy = async (payload: NativePairingPayload): Promise<void> => {
    if (payload.expiresAt <= Date.now()) {
      setView({ status: 'expired' })
      return
    }
    const controller = begin()
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload))
      if (!controller.signal.aborted) setCopyStatus('copied')
    } catch {
      // Browsers can deny clipboard access; the read-only payload remains selectable.
      if (!controller.signal.aborted) setCopyStatus('failed')
    }
  }
  const busy = view.status === 'working'
  const edit = (): void => {
    operation.current?.abort()
    setView({ status: 'editing' })
    setCopyStatus('idle')
  }
  return (
    <div className={css.pairing} role="group" aria-label={t('pairing.title')}>
      <h4>{t('pairing.title')}</h4>
      <p className={css.subtitle}>{t('pairing.hint')}</p>
      <label className={css.pairingField}>
        {t('pairing.address')}
        <input type="url" value={endpoint} disabled={busy} autoComplete="off" onChange={(event) => { edit(); setEndpoint(event.target.value) }} />
      </label>
      <label className={css.pairingField}>
        {t('pairing.role')}
        <select aria-label={t('pairing.role')} value={role} disabled={busy} onChange={(event) => {
          edit()
          setRole(event.currentTarget.value as DeviceRole)
        }}>
          {ROLES.map(value => <option key={value} value={value}>{t(`role.${value}`)}</option>)}
        </select>
      </label>
      <p className={css.subtitle}>{t(`pairing.permission.${role}`)}</p>
      <div className={css.actions}>
        <button type="button" disabled={busy || endpoint.trim() === ''} onClick={() => void create()}>
          {t(busy ? 'pairing.working' : 'pairing.generate')}
        </button>
        <button type="button" onClick={close}>{t('pairing.close')}</button>
      </div>
      {view.status === 'error' && <p className={css.failure} role="alert">{view.message}</p>}
      {view.status === 'expired' && <p className={css.status} role="status">{t('pairing.expired')}</p>}
      {payload !== undefined && (
        <div className={css.pairingResult}>
          <QRCodeSVG value={JSON.stringify(payload)} size={200} marginSize={4} title={t('pairing.qr')} />
          <p>{t('pairing.identity', { name: payload.displayName, hostId: payload.hostId })}</p>
          <p>{t('pairing.grantedRole', { role: t(`role.${payload.role}`) })}</p>
          <p className={css.fingerprint}>{t('pairing.pin', { fingerprint: payload.spkiFingerprint })}</p>
          <p>{t('pairing.expiresAt', { time: formatTime(payload.expiresAt) })}</p>
          <p className={css.subtitle}>{t('pairing.secretHint')}</p>
          <textarea readOnly aria-label={t('pairing.payload')} value={JSON.stringify(payload)} spellCheck={false} />
          <button type="button" onClick={() => void copy(payload)}>{t('pairing.copy')}</button>
          {copyStatus !== 'idle' && <p role="status">{t(copyStatus === 'copied' ? 'pairing.copied' : 'pairing.copyFailed')}</p>}
        </div>
      )}
    </div>
  )
}
