/**
 * Login-autostart preference row: whether the OS launches the app hidden to
 * the tray at sign-in, so a later reveal is instant instead of a cold boot.
 * Off by default — the login-time footprint is the user's opt-in.
 */

import type { DesktopSettings } from '../desktop-settings.ts'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// The preference-row layout this package already owns (title/description plus
// a two-option segmented control); shared, not forked.
import css from './CloseActionRow.module.css'

/** The two states, in display order. */
const OPTIONS: readonly boolean[] = [true, false]

/** Registration-side business face for the host-backed preference. */
export interface LaunchAtLoginRowInjected {
  hooks: {
    /** Desktop namespace snapshot bound by the renderer as useDesktopLaunch. */
    desktopLaunch: ObservableSnapshot<SettingsScopeSnapshot<DesktopSettings>>
  }
  /** Persist one autostart choice. */
  select: (value: boolean) => void
}

/** Full component props. */
export type LaunchAtLoginRowComponentProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.desktop'>
  & InjectFace<LaunchAtLoginRowInjected>

/**
 * Render the login-autostart selector.
 * @param props - composed slot props.
 * @returns the row, or null while the namespace is loading or absent.
 */
export function LaunchAtLoginRow({ t, useDesktopLaunch, select }: LaunchAtLoginRowComponentProps) {
  const snapshot = useDesktopLaunch(s => s)
  const { value } = snapshot
  if (snapshot.status !== 'ready' || value === undefined) return null
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('launchTitle')}</div>
        <div className={css.desc}>{t('launchDescription')}</div>
      </div>
      <div className={css.group} role="radiogroup" aria-label={t('launchTitle')}>
        {OPTIONS.map(option => (
          <button
            key={String(option)}
            type="button"
            role="radio"
            aria-checked={option === value.launchAtLogin}
            className={option === value.launchAtLogin ? `${css.option} ${css.selected}` : css.option}
            disabled={!snapshot.writable}
            onClick={() => { if (option !== value.launchAtLogin) select(option) }}
          >
            {t(option ? 'on' : 'off')}
          </button>
        ))}
      </div>
    </div>
  )
}
