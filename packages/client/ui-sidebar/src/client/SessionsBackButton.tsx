/**
 * The phone-tier conversation-page back affordance (specification §10 top
 * bar): one button at the session header's leading edge, shown only by the
 * phone media query. It opens the sidebar drawer that holds the Sessions
 * list, so a phone reader returns to the roster without hunting for the
 * composer-edge drawer button; above the phone tier the sidebar rail is
 * already visible and this affordance hides.
 */
import type { ReactNode } from 'react'
import { IconChevronLeftOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SessionsBackButton.module.css'

/** The button's props: the drawer-open action and the sidebar's copy. */
export type SessionsBackButtonProps = PropsLocale<'sidebar'> & {
  /** Open the phone-tier drawer carrying the Sessions list; scoped here so the occupant carries no store. */
  readonly toggleSidebar: () => void
}

/** The back-to-Sessions button; hidden above the phone tier by its media query. */
export function SessionsBackButton({ toggleSidebar, t }: SessionsBackButtonProps): ReactNode {
  return (
    <button
      type="button"
      className={css.button}
      data-sidebar-sessions-back
      onClick={() => { toggleSidebar() }}
    >
      <IconChevronLeftOutline14 className={css.icon} />
      <span>{t('phone.backToSessions')}</span>
    </button>
  )
}
