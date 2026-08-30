/**
 * Boolean preference row for the `remote` settings namespace: the
 * cross-device access switch and the independent remote-approval switch. The
 * two registrations differ only in their field and copy keys.
 */

import type { RemoteSettings } from '../remote-settings.ts'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopSettingsKey } from './locales.ts'
import css from './CloseActionRow.module.css'

/** The two states, in display order. */
const OPTIONS: readonly boolean[] = [true, false]

/** Registration-side business face for one remote boolean preference. */
export interface RemoteToggleRowInjected {
  hooks: {
    /** Remote namespace snapshot bound by the renderer. */
    remote: ObservableSnapshot<SettingsScopeSnapshot<RemoteSettings>>
  }
  /** Namespace field this row flips. */
  field: 'enabled' | 'allowRemoteApproval'
  /** Copy keys for the title and description lines. */
  titleKey: DesktopSettingsKey
  descriptionKey: DesktopSettingsKey
  /** Persist one switch state. */
  select: (value: boolean) => void
}

/** Full component props. */
export type RemoteToggleRowComponentProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.desktop'>
  & InjectFace<RemoteToggleRowInjected>

/**
 * Render one remote boolean preference as an on/off segmented control.
 * @param props - composed slot props.
 * @returns the row, or null while the namespace is loading or absent.
 */
export function RemoteToggleRow({ t, useRemote, field, titleKey, descriptionKey, select }: RemoteToggleRowComponentProps) {
  const snapshot = useRemote(s => s)
  const { value } = snapshot
  if (snapshot.status !== 'ready' || value === undefined) return null
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t(titleKey)}</div>
        <div className={css.desc}>{t(descriptionKey)}</div>
      </div>
      <div className={css.group} role="radiogroup" aria-label={t(titleKey)}>
        {OPTIONS.map(option => (
          <button
            key={String(option)}
            type="button"
            role="radio"
            aria-checked={option === value[field]}
            className={option === value[field] ? `${css.option} ${css.selected}` : css.option}
            disabled={!snapshot.writable}
            onClick={() => { if (option !== value[field]) select(option) }}
          >
            {option ? t('on') : t('off')}
          </button>
        ))}
      </div>
    </div>
  )
}
