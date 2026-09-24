import { useEffect, useState, type ReactNode } from 'react'
import type { SavedHost } from '@deepseek-ai/dsh-client-connection/client'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './HostsSettingsSection.module.css'

/**
 * Registration-side connection face used by the section. Roster and selection
 * are local page state, so every member is a live reader rather than one
 * fetched snapshot; the section re-renders on roster notifications and after
 * its own actions.
 */
export interface HostsSettingsSectionInjected {
  /** Current roster rows, most recent first. */
  readonly rows: () => readonly SavedHost[]
  /** The §28 selection reader; `undefined` means the page Host. */
  readonly selectedOrigin: () => string | undefined
  /** Switch to one saved Host; the row returns on success. */
  readonly switchTo: (hostId: string) => SavedHost | undefined
  /** Return to the page Host and clear the persisted selection. */
  readonly useLocalHost: () => void
  /** Forget one roster row; absent ids leave the roster unchanged. */
  readonly forget: (hostId: string) => void
  /** Roster change notifications for live re-render. */
  readonly subscribe: (listener: () => void) => () => void
  /** Localized wall-clock text for one epoch-ms value, per the active locale. */
  readonly formatTime: (epochMs: number) => string
}

/** Full component props assembled by the Settings slot renderer. */
export type HostsSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.hosts'>
  & InjectFace<HostsSettingsSectionInjected>

type Translate = HostsSettingsSectionProps['t']

/** One saved-Host row: identity, origin, timing, and its actions. */
function HostRow(
  { row, selected, formatTime, t, onSwitch, onForget }: {
    readonly row: SavedHost
    readonly selected: boolean
    readonly formatTime: (epochMs: number) => string
    readonly t: Translate
    readonly onSwitch: (hostId: string) => void
    readonly onForget: (hostId: string) => void
  },
): ReactNode {
  const inProcess = row.origin === 'in-process'
  return (
    <li className={css.host} data-host-id={row.hostId} data-host-selected={selected ? '' : undefined}>
      <div className={css.hostTop}>
        <span className={css.hostName}>{row.displayName ?? row.hostId}</span>
        {selected && <Tag tone="success">{t('current')}</Tag>}
        {row.platform !== undefined && <Tag tone="neutral">{row.platform}</Tag>}
        {inProcess && <Tag tone="neutral">{t('inProcess')}</Tag>}
      </div>
      <div className={css.meta}>
        <span className={css.origin}>{row.origin}</span>
        <span>{t('lastConnectedAt', { time: formatTime(row.lastConnectedAt) })}</span>
      </div>
      <div className={css.actions}>
        {!selected && !inProcess && (
          <button type="button" data-host-switch onClick={() => { onSwitch(row.hostId) }}>{t('switch')}</button>
        )}
        <button type="button" data-host-forget onClick={() => { onForget(row.hostId) }}>{t('forget')}</button>
      </div>
    </li>
  )
}

/** The saved-Host roster settings section: the section 28 switching surface. */
export function HostsSettingsSection(
  { t, rows, selectedOrigin, switchTo, useLocalHost, forget, subscribe, formatTime }: HostsSettingsSectionProps,
): ReactNode {
  const [, setTick] = useState(0)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  useEffect(() => subscribe(() => { setTick(value => value + 1) }), [subscribe])

  const list = rows()
  const selected = selectedOrigin()
  const onSwitch = (hostId: string): void => {
    const row = switchTo(hostId)
    setNotice(row === undefined ? undefined : t('switchedTo', { name: row.displayName ?? row.hostId }))
    setTick(value => value + 1)
  }

  return (
    <section className={css.section} aria-label={t('title')}>
      <div className={css.heading}>
        <div className={css.headingRow}>
          <h3>{t('title')}</h3>
          <button type="button" data-hosts-refresh onClick={() => { setTick(value => value + 1) }}>{t('refresh')}</button>
        </div>
        <p className={css.subtitle}>{t('subtitle')}</p>
      </div>
      {selected === undefined
        ? <p className={css.status} role="status">{t('currentPage')}</p>
        : (
          <div className={css.actions}>
            <p className={css.status} role="status">{selected}</p>
            <button type="button" data-hosts-use-local onClick={() => { useLocalHost(); setNotice(undefined); setTick(value => value + 1) }}>
              {t('useLocal')}
            </button>
          </div>
        )}
      {notice !== undefined && <p className={css.status} role="status">{notice}</p>}
      {list.length === 0 && <p className={css.status}>{t('empty')}</p>}
      {list.length > 0 && (
        <ul className={css.hosts}>
          {list.map(row => (
            <HostRow
              key={row.hostId}
              row={row}
              selected={row.origin === selected}
              formatTime={formatTime}
              t={t}
              onSwitch={onSwitch}
              onForget={forget}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
