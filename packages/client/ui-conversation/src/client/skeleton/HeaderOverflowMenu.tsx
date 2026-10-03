/** §10 phone-tier header overflow: the header's secondary controls behind one ⋮ affordance. */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconOverflowVertical16, useAnchoredPosition, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './HeaderOverflowMenu.module.css'
import type { ConversationSessionHeaderSlotProps } from '../contract/slots.ts'

/** The phone tier every phone-only affordance in the shell already uses. */
const PHONE_TIER_QUERY = '(max-width: 599.5px)'

/**
 * Whether the viewport sits in the phone tier. Non-browser runs (node e2e
 * booting the client tree) have no matchMedia and stay on the wide tier.
 * @returns true while the viewport matches the phone-tier media query.
 */
export function usePhoneTier(): boolean {
  const [phoneTier, setPhoneTier] = useState(false)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const query = matchMedia(PHONE_TIER_QUERY)
    const apply = (): void => { setPhoneTier(query.matches) }
    apply()
    query.addEventListener('change', apply)
    return () => { query.removeEventListener('change', apply) }
  }, [])
  return phoneTier
}

interface HeaderOverflowMenuProps {
  /** The header actions list as the wide tier renders it inline. */
  readonly actions: ReactNode
  /** The header utilities list (beyond the running-location chip) as the wide tier renders it. */
  readonly utilities: ReactNode
  /** Locale translator for the trigger and the empty panel line. */
  readonly t: ConversationSessionHeaderSlotProps['t']
}

/** One ⋮ trigger whose portaled panel stacks the header's secondary controls (phone tier only). */
export function HeaderOverflowMenu({ actions, utilities, t }: HeaderOverflowMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelPosition = useAnchoredPosition({
    open,
    anchorRef: triggerRef,
    panelRef,
    side: 'bottom',
    gap: 5,
    margin: 16,
  })
  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }
  const empty = actions == null && utilities == null
  const panel = open
    ? createPortal((
      <div
        ref={panelRef}
        className={css.panel}
        style={panelPosition ?? { visibility: 'hidden' }}
        aria-label={t('session.overflow.aria')}
      >
        {actions != null && <div className={css.group}>{actions}</div>}
        {utilities != null && <div className={css.group}>{utilities}</div>}
        {empty && <div className={css.empty}>{t('session.overflow.empty')}</div>}
      </div>
    ), document.body)
    : null

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('session.overflow.aria')}
        onClick={() => { setOpen(current => !current) }}
      >
        <IconOverflowVertical16 size={16} />
      </button>
      {panel}
    </div>
  )
}
