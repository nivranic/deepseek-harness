/**
 * Device-name row for the `remote` settings namespace: the host name paired
 * devices see. Commits on blur or Enter; an emptied field resets the name to
 * the computer name on the host side.
 */

import { useEffect, useState } from 'react'
import type { RemoteSettings } from '../remote-settings.ts'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopSettingsKey } from './locales.ts'
import css from './CloseActionRow.module.css'

/** Registration-side business face for the device-name preference. */
export interface DeviceNameRowInjected {
  hooks: {
    /** Remote namespace snapshot bound by the renderer. */
    remote: ObservableSnapshot<SettingsScopeSnapshot<RemoteSettings>>
  }
  /** Copy keys for the title and description lines. */
  titleKey: DesktopSettingsKey
  descriptionKey: DesktopSettingsKey
  /** Placeholder shown while the field is empty. */
  placeholderKey: DesktopSettingsKey
  /** Persist one host name. */
  commit: (value: string) => void
}

/** Full component props. */
export type DeviceNameRowComponentProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.desktop'>
  & InjectFace<DeviceNameRowInjected>

/**
 * Render the device-facing host name editor.
 * @param props - composed slot props.
 * @returns the row, or null while the namespace is loading or absent.
 */
export function DeviceNameRow({ t, useRemote, titleKey, descriptionKey, placeholderKey, commit }: DeviceNameRowComponentProps) {
  const snapshot = useRemote(s => s)
  const { value } = snapshot
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const committed = value?.deviceName ?? ''
  useEffect(() => {
    // An external commit replaces the draft; a local edit survives re-renders.
    setDraft(current => current === committed || current === undefined ? committed : current)
  }, [committed])
  if (snapshot.status !== 'ready' || value === undefined) return null
  const settle = (): void => {
    if (draft !== undefined && draft !== committed) commit(draft)
  }
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t(titleKey)}</div>
        <div className={css.desc}>{t(descriptionKey)}</div>
      </div>
      <input
        className={css.field}
        type="text"
        value={draft ?? committed}
        placeholder={t(placeholderKey)}
        aria-label={t(titleKey)}
        disabled={!snapshot.writable}
        onChange={(event) => { setDraft(event.target.value) }}
        onBlur={settle}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </div>
  )
}
