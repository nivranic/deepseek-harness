import { useState, type ReactNode } from 'react'
import type { ConnectionHandle, SavedHost } from '@deepseek-ai/dsh-client-connection/client'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './HostsSettingsSection.module.css'

/** The framework binds roster and target observations into selector hooks. */
export interface HostsSettingsSectionInjected {
  readonly hooks: {
    readonly savedHosts: {
      readonly getSnapshot: ConnectionHandle['savedHosts']['list']
      readonly subscribe: ConnectionHandle['savedHosts']['subscribe']
    }
    readonly selectedOrigin: ConnectionHandle['target']
  }
  /** HTTP origin of the containing page, when this is a Web carrier. */
  readonly pageOrigin: string | undefined
  /** Select a saved Host and persist its id after a successful selection. */
  readonly switchTo: (hostId: string) => SavedHost | undefined
  /** Return to the page Host and clear the persisted selection. */
  readonly useLocalHost: () => void
  /** Forget a roster row without stopping its current connection. */
  readonly forget: (hostId: string) => void
  /** Localized wall-clock text in the active locale. */
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
  { row, selected, pageOrigin, formatTime, t, onSwitch, onForget }: {
    readonly row: SavedHost
    readonly selected: boolean
    readonly pageOrigin: string | undefined
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
      {!inProcess && row.origin !== pageOrigin && (
        <p className={css.status}>
          {t('pairingHint')}{' '}
          <a href={row.origin} target="_blank" rel="noopener noreferrer">{t('openHost')}</a>
        </p>
      )}
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
  { t, useSavedHosts, useSelectedOrigin, pageOrigin, switchTo, useLocalHost, forget, formatTime }: HostsSettingsSectionProps,
): ReactNode {
  const [notice, setNotice] = useState<{ origin: string; name: string } | undefined>(undefined)
  const list = useSavedHosts(value => value)
  const selected = useSelectedOrigin(value => value)
  const onSwitch = (hostId: string): void => {
    const row = switchTo(hostId)
    setNotice(row === undefined ? undefined : { origin: row.origin, name: row.displayName ?? row.hostId })
  }

  return (
    <section className={css.section} aria-label={t('title')}>
      <div className={css.heading}>
        <div className={css.headingRow}>
          <h3>{t('title')}</h3>
        </div>
        <p className={css.subtitle}>{t('subtitle')}</p>
      </div>
      {selected === undefined
        ? <p className={css.status} role="status">{t('currentPage')}</p>
        : (
          <div className={css.actions}>
            <p className={css.status} role="status">{selected}</p>
            <button type="button" data-hosts-use-local onClick={() => { useLocalHost(); setNotice(undefined) }}>
              {t('useLocal')}
            </button>
          </div>
        )}
      {notice !== undefined && notice.origin === selected && <p className={css.status} role="status">{t('switchedTo', { name: notice.name })}</p>}
      {list.length === 0 && <p className={css.status}>{t('empty')}</p>}
      {list.length > 0 && (
        <ul className={css.hosts}>
          {list.map(row => (
            <HostRow
              key={row.hostId}
              row={row}
              selected={row.origin === selected}
              pageOrigin={pageOrigin}
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
