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
  /** Rename a roster row locally; `undefined` returns it to descriptor facts. */
  readonly rename: (hostId: string, customName: string | undefined) => void
  /** Move a roster row one position; the manual arrangement persists. */
  readonly move: (hostId: string, direction: 'up' | 'down') => void
  /** Localized wall-clock text in the active locale. */
  readonly formatTime: (epochMs: number) => string
}

/** Full component props assembled by the Settings slot renderer. */
export type HostsSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.hosts'>
  & InjectFace<HostsSettingsSectionInjected>

type Translate = HostsSettingsSectionProps['t']

/** The name a row presents: the client's choice first, then descriptor facts. */
export function hostDisplayName(row: SavedHost): string {
  return row.customName ?? row.displayName ?? row.hostId
}

/** One saved-Host row: identity, origin, timing, and its actions. */
function HostRow(
  { row, selected, pageOrigin, formatTime, t, onSwitch, onForget, onRename, onMove, first, last }: {
    readonly row: SavedHost
    readonly selected: boolean
    readonly pageOrigin: string | undefined
    readonly formatTime: (epochMs: number) => string
    readonly t: Translate
    readonly onSwitch: (hostId: string) => void
    readonly onForget: (hostId: string) => void
    readonly onRename: (hostId: string, customName: string | undefined) => void
    readonly onMove: (hostId: string, direction: 'up' | 'down') => void
    readonly first: boolean
    readonly last: boolean
  },
): ReactNode {
  const inProcess = row.origin === 'in-process'
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [rowError, setRowError] = useState<string | undefined>(undefined)
  const beginRename = (): void => {
    setRenaming(true)
    setDraft(hostDisplayName(row))
    setRowError(undefined)
  }
  const saveRename = (): void => {
    const name = draft.trim()
    if (name === '') {
      setRowError(t('renameEmpty'))
      return
    }
    setRowError(undefined)
    onRename(row.hostId, name)
    setRenaming(false)
  }
  return (
    <li className={css.host} data-host-id={row.hostId} data-host-selected={selected ? '' : undefined}>
      <div className={css.hostTop}>
        <span className={css.hostName}>{hostDisplayName(row)}</span>
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
      {renaming
        ? (
          <div className={css.renameRow}>
            <input
              value={draft}
              aria-label={t('rename')}
              onChange={(event) => { setDraft(event.target.value); setRowError(undefined) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveRename()
              }}
            />
            <button type="button" data-host-rename-save onClick={saveRename}>{t('renameSave')}</button>
            <button type="button" onClick={() => {
              setRenaming(false)
              setRowError(undefined)
            }}>{t('renameCancelled')}</button>
          </div>
        )
        : (
          <div className={css.actions}>
            {!selected && !inProcess && row.origin === pageOrigin && (
              <button type="button" data-host-switch onClick={() => { onSwitch(row.hostId) }}>{t('switch')}</button>
            )}
            <button type="button" data-host-move-up disabled={first} onClick={() => { onMove(row.hostId, 'up') }}>
              {t('moveUp')}
            </button>
            <button type="button" data-host-move-down disabled={last} onClick={() => { onMove(row.hostId, 'down') }}>
              {t('moveDown')}
            </button>
            <button type="button" data-host-rename onClick={beginRename}>{t('rename')}</button>
            {row.customName !== undefined && (
              <button type="button" data-host-rename-reset onClick={() => { onRename(row.hostId, undefined) }}>
                {t('renameReset')}
              </button>
            )}
            <button type="button" data-host-forget onClick={() => { onForget(row.hostId) }}>{t('forget')}</button>
          </div>
        )}
      {rowError !== undefined && <p className={css.failure} role="alert">{rowError}</p>}
    </li>
  )
}

/** The saved-Host roster settings section: the section 28 switching surface. */
export function HostsSettingsSection(
  { t, useSavedHosts, useSelectedOrigin, pageOrigin, switchTo, useLocalHost, forget, rename, move, formatTime }: HostsSettingsSectionProps,
): ReactNode {
  const [notice, setNotice] = useState<{ origin: string; name: string } | undefined>(undefined)
  const list = useSavedHosts(value => value)
  const selected = useSelectedOrigin(value => value)
  const onSwitch = (hostId: string): void => {
    const row = switchTo(hostId)
    setNotice(row === undefined ? undefined : { origin: row.origin, name: hostDisplayName(row) })
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
          {list.map((row, index) => (
            <HostRow
              key={row.hostId}
              row={row}
              selected={row.origin === selected}
              pageOrigin={pageOrigin}
              formatTime={formatTime}
              t={t}
              onSwitch={onSwitch}
              onForget={forget}
              onRename={rename}
              onMove={move}
              first={index === 0}
              last={index === list.length - 1}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
