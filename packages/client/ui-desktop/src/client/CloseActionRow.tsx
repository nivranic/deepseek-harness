/**
 * Close-button preference row: what clicking the window's close button does —
 * hide to the system tray (the default) or quit the application. The choice
 * applies to the next press; no session state is involved.
 */

import type { DesktopCloseAction, DesktopSettings } from '../desktop-settings.ts'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopSettingsKey } from './locales.ts'
import css from './CloseActionRow.module.css'

/** The two behaviors, in display order. */
const OPTIONS: readonly DesktopCloseAction[] = ['tray', 'quit']

/** Registration-side business face for the host-backed preference. */
export interface CloseActionRowInjected {
  hooks: {
    /** Desktop namespace snapshot bound by the renderer as useDesktopClose. */
    desktopClose: ObservableSnapshot<SettingsScopeSnapshot<DesktopSettings>>
  }
  /** Persist one close-button behavior. */
  select: (value: DesktopCloseAction) => void
}

/** Full component props. */
export type CloseActionRowComponentProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.desktop'>
  & InjectFace<CloseActionRowInjected>

/**
 * Render the close-button behavior selector.
 * @param props - composed slot props.
 * @returns the row, or null while the namespace is loading or absent.
 */
export function CloseActionRow({ t, useDesktopClose, select }: CloseActionRowComponentProps) {
  const snapshot = useDesktopClose(s => s)
  const { value } = snapshot
  if (snapshot.status !== 'ready' || value === undefined) return null
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('title')}</div>
        <div className={css.desc}>{t('description')}</div>
      </div>
      <div className={css.group} role="radiogroup" aria-label={t('title')}>
        {OPTIONS.map(option => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === value.closeAction}
            className={option === value.closeAction ? `${css.option} ${css.selected}` : css.option}
            disabled={!snapshot.writable}
            onClick={() => { if (option !== value.closeAction) select(option) }}
          >
            {t(option)}
          </button>
        ))}
      </div>
    </div>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop close-button row copy. */
    'settings.desktop': DesktopSettingsKey
  }
}
