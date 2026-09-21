import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DeviceId, DeviceRole, DeviceView } from '@deepseek-ai/dsh-api-remotes/client'
import { classifyRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DevicesSettingsSection.module.css'

/** Registration-side Remote face used by the section. */
export interface DevicesSettingsSectionInjected {
  /** Read the current grant list. */
  list: () => Promise<readonly DeviceView[]>
  /** Rename one grant; a fresh list follows from the caller's refresh. */
  rename: (deviceId: DeviceId, deviceName: string) => Promise<void>
  /** Revoke one grant. */
  revoke: (deviceId: DeviceId) => Promise<void>
  /** Revoke every still-active grant; resolves with how many it revoked. */
  revokeAll: () => Promise<number>
  /** Localized wall-clock text for one epoch-ms value, per the active locale. */
  formatTime: (epochMs: number) => string
}

/** Full component props assembled by the Settings slot renderer. */
export type DevicesSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.devices'>
  & InjectFace<DevicesSettingsSectionInjected>

type Translate = DevicesSettingsSectionProps['t']

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly devices: readonly DeviceView[] }

const ROLE_TONES = {
  viewer: 'neutral',
  collaborator: 'info',
  controller: 'solid',
  owner: 'success',
} as const satisfies Record<DeviceRole, TagTone>

/** One localized copy line for a failed Remote operation. */
function failureCopy(error: unknown, t: Translate): string {
  switch (classifyRemoteFailure(error)) {
    case 'authentication': return t('failure.authentication')
    case 'permission': return t('failure.permission')
    case 'compatibility': return t('failure.compatibility')
    case 'conflict': return t('failure.conflict')
    case 'host-state': return t('failure.host-state')
    case 'carrier-invalid': return t('failure.carrier-invalid')
    case 'transport': return t('failure.transport')
    case 'unavailable': return t('failure.unavailable')
    default: return t('failure.raw', { message: error instanceof Error ? error.message : String(error) })
  }
}

/** One paired device row: identity, role, platform, timing, and its actions. */
function DeviceRow(
  { device, formatTime, t, onRename, onRevoke, onMutated }: {
    readonly device: DeviceView
    readonly formatTime: (epochMs: number) => string
    readonly t: Translate
    readonly onRename: (deviceId: DeviceId, deviceName: string) => Promise<void>
    readonly onRevoke: (deviceId: DeviceId) => Promise<void>
    /** One row mutation settled on the Host; the section re-reads the roster. */
    readonly onMutated: () => void
  },
): ReactNode {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(device.deviceName)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rowError, setRowError] = useState<string | undefined>(undefined)
  const revoked = device.revokedAt !== undefined

  const rename = async (): Promise<void> => {
    const name = draft.trim()
    if (name === '') {
      setRowError(t('renameEmpty'))
      return
    }
    setBusy(true)
    setRowError(undefined)
    try {
      await onRename(device.deviceId, name)
      setRenaming(false)
      onMutated()
    } catch (error) {
      setRowError(failureCopy(error, t))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (): Promise<void> => {
    setBusy(true)
    setRowError(undefined)
    try {
      await onRevoke(device.deviceId)
      setConfirming(false)
      onMutated()
    } catch (error) {
      setRowError(failureCopy(error, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={css.device} data-device-id={device.deviceId}>
      <div className={css.deviceTop}>
        <span className={css.deviceName}>{device.deviceName}</span>
        <Tag tone={ROLE_TONES[device.role]}>{t(`role.${device.role}`)}</Tag>
        {device.platform !== undefined && <Tag tone="neutral">{device.platform}</Tag>}
        {revoked && <Tag tone="warning">{t('revoked')}</Tag>}
      </div>
      <div className={css.meta}>
        <span>{t('pairedAt', { time: formatTime(device.pairedAt) })}</span>
        <span>{device.lastSeenAt === undefined
          ? t('neverSeen')
          : t('lastSeenAt', { time: formatTime(device.lastSeenAt) })}</span>
        <span className={css.fingerprint}>{t('fingerprint', { value: device.keyFingerprint.slice(0, 16) })}</span>
      </div>
      {renaming
        ? (
          <div className={css.renameRow}>
            <input
              value={draft}
              aria-label={t('rename')}
              onChange={(event) => { setDraft(event.target.value); setRowError(undefined) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void rename()
              }}
            />
            <button type="button" disabled={busy} onClick={() => void rename()}>{t('renameSave')}</button>
            <button type="button" disabled={busy} onClick={() => {
              setRenaming(false)
              setDraft(device.deviceName)
              setRowError(undefined)
            }}>{t('renameCancelled')}</button>
          </div>
        )
        : (
          <div className={css.actions}>
            {!revoked && (
              <button type="button" disabled={busy} onClick={() => {
                setRenaming(true)
                setDraft(device.deviceName)
              }}>{t('rename')}</button>
            )}
            {!revoked && (confirming
              ? (
                <span className={css.confirm}>
                  <p>{t('revokeConfirm')}</p>
                  <button type="button" className={css.danger} disabled={busy} onClick={() => void revoke()}>
                    {t('revokeConfirmAction')}
                  </button>
                  <button type="button" disabled={busy} onClick={() => { setConfirming(false) }}>
                    {t('revokeCancelled')}
                  </button>
                </span>
              )
              : (
                <button type="button" className={css.danger} disabled={busy} onClick={() => { setConfirming(true) }}>
                  {t('revoke')}
                </button>
              ))}
          </div>
        )}
      {rowError !== undefined && <p className={css.failure} role="alert">{rowError}</p>}
    </li>
  )
}

/** The Devices settings section: the section 22 management surface. */
export function DevicesSettingsSection({ t, list, rename, revoke, revokeAll, formatTime }: DevicesSettingsSectionProps): ReactNode {
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const [confirmingAll, setConfirmingAll] = useState(false)
  const [busyAll, setBusyAll] = useState(false)
  const [revokedCount, setRevokedCount] = useState<number | undefined>(undefined)

  const load = useMemo(() => async (): Promise<void> => {
    setView({ status: 'loading' })
    try {
      setView({ status: 'ready', devices: await list() })
    } catch (error) {
      setView({ status: 'error', message: failureCopy(error, t) })
    }
  }, [list])

  useEffect(() => { void load() }, [load])

  const activeCount = view.status === 'ready'
    ? view.devices.filter(device => device.revokedAt === undefined).length
    : 0

  const confirmRevokeAll = async (): Promise<void> => {
    setBusyAll(true)
    try {
      setRevokedCount(await revokeAll())
      setConfirmingAll(false)
      await load()
    } catch {
      // The refresh below surfaces the current Host state; the count stays
      // unset because the operation did not settle.
      await load()
    } finally {
      setBusyAll(false)
    }
  }

  return (
    <section className={css.section} aria-label={t('title')}>
      <div className={css.heading}>
        <div className={css.headingRow}>
          <h3>{t('title')}</h3>
          {activeCount > 0 && (confirmingAll
            ? (
              <span className={css.confirm}>
                <p>{t('revokeAllConfirm')}</p>
                <button type="button" className={css.danger} disabled={busyAll} onClick={() => void confirmRevokeAll()}>
                  {t('revokeAllConfirmAction')}
                </button>
                <button type="button" disabled={busyAll} onClick={() => { setConfirmingAll(false) }}>
                  {t('revokeAllCancelled')}
                </button>
              </span>
            )
            : (
              <button type="button" className={css.danger} disabled={busyAll} onClick={() => { setConfirmingAll(true) }}>
                {t('revokeAll')}
              </button>
            ))}
        </div>
        <p className={css.subtitle}>{t('subtitle')}</p>
      </div>
      {revokedCount !== undefined && (
        <p className={css.status} role="status">{t('revokeAllDone', { count: String(revokedCount) })}</p>
      )}
      {view.status === 'loading' && <p className={css.status} role="status">{t('loading')}</p>}
      {view.status === 'error' && <p className={css.failure} role="alert">{view.message}</p>}
      {view.status === 'ready' && view.devices.length === 0 && <p className={css.status}>{t('empty')}</p>}
      {view.status === 'ready' && view.devices.length > 0 && (
        <ul className={css.devices}>
          {view.devices.map(device => (
            <DeviceRow
              key={device.deviceId}
              device={device}
              formatTime={formatTime}
              t={t}
              onRename={rename}
              onRevoke={revoke}
              onMutated={() => { void load() }}
            />
          ))}
        </ul>
      )}
      {view.status === 'ready' && (
        <div className={css.actions}>
          <button type="button" onClick={() => void load()}>{t('refresh')}</button>
        </div>
      )}
    </section>
  )
}
