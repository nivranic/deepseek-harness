/**
 * The way into the phone-tier drawer (specification §7, frame below
 * SIDEBAR_OVERLAY_MAX): one button at the composer's left edge, shown only by
 * the phone media query. It lives in the composer rather than the frame
 * because the composer is always mounted — the blank hero and an active
 * conversation both keep the affordance reachable, while the collapsed rail
 * the desktop uses is hidden entirely on this tier. Opening the drawer raises
 * the frame's scrim over the composer, so this button only ever opens; the
 * scrim, the sidebar's own collapse toggle, and Escape close it.
 */
import type { ReactNode } from 'react'
import { IconPanelLeftOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PhoneDrawerButton.module.css'

/** The button's props: the drawer-open action and the sidebar's copy. */
export type PhoneDrawerButtonProps = PropsLocale<'sidebar'> & {
  /** Open the phone-tier drawer; scoped here so the occupant carries no store. */
  readonly toggleSidebar: () => void
}

/** The drawer opener; hidden above the phone tier by its media query. */
export function PhoneDrawerButton({ toggleSidebar, t }: PhoneDrawerButtonProps): ReactNode {
  return (
    <Tooltip label={t('toggle.open')} side="bottom" delayMs={500}>
      <button
        type="button"
        className={css.button}
        aria-label={t('toggle.open')}
        data-sidebar-drawer-open
        onClick={() => { toggleSidebar() }}
      >
        <IconPanelLeftOutline16 className={css.icon} />
      </button>
    </Tooltip>
  )
}
