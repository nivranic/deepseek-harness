/** §26 capture side: one Session-header action copying the cross-device view-location link. */
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { IconShareOutlineRegular, useAnchoredPosition, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import { QRCodeSVG } from 'qrcode.react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { NS } from './locales.ts'
import css from './HandoffAction.module.css'
import type { HandoffAdmission } from './controller.ts'

/** Handoff operations and state injected into the Session Header contribution. */
export interface HandoffActionInjected {
  hooks: {
    /** Host-admission signal; the action stays hidden until the first admitted generation. */
    admission: ObservableSnapshot<HandoffAdmission>
  }
  /** Encode the §26 payload for the session and anchor. */
  encode: (sessionId: SessionId, anchorSeq: SessionSeq) => string | undefined
  /** Build the cross-device link for one payload. */
  buildLink: (payload: string) => string
  /** Copy text; resolves false when the clipboard refused. */
  copy: (text: string) => Promise<boolean>
}

/** Full props for the Session-header view-handoff action. */
export type HandoffActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>
  & InjectFace<HandoffActionInjected>

/** How long the copied (or failed) dress stays after a click. */
const DRESS_MS = 2000

/** Edge length of the scannable QR, matching the pairing panel's established size. */
const QR_SIZE = 200

/** Off-screen placeholder style while the anchored position takes its first measure. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/**
 * One quiet share action: click captures the connected Host, this Session, and
 * the last Turn's start seq into a §26 payload, wraps it into the page URL's
 * fragment, copies the link, and opens a popover rendering that link as a QR
 * code — the minimal real cross-device delivery channel, since the fragment
 * never leaves the device except through what the user scans. It renders
 * nothing until a Host is admitted and the Chat timeline holds a Turn anchor —
 * a blank session has no position to hand off.
 * @param props - session runtime, injected controller face, and localized copy.
 * @returns the action button with its QR popover, or null while hidden.
 */
export function HandoffAction(props: HandoffActionProps): React.JSX.Element | null {
  const { sessionId, useConversation, useAdmission, encode, buildLink, copy, t } = props
  const admission = useAdmission(value => value)
  // The anchor is the last Turn's turn/start seq — exactly what the receiving
  // side's turn-jump loader reveals through loadThrough.
  const anchorSeq = useConversation((conversation) => {
    const chat = conversation.views.get('chat')
    const order = chat?.timeline.turnOrder
    const last = order?.[order.length - 1]
    const start = last === undefined ? undefined : chat?.timeline.turns.get(last)?.start
    return start === undefined ? undefined : start.seq
  })
  const [dress, setDress] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [link, setLink] = useState<string | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const request = useRef(0)
  useLayoutEffect(() => {
    request.current++
    clearTimeout(timer.current)
    setOpen(false)
    setLink(undefined)
    setDress('idle')
    return () => { request.current++; clearTimeout(timer.current) }
  }, [admission, sessionId])
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

  if (admission.status !== 'ready' || anchorSeq === undefined) return null

  const share = (): void => {
    const payload = encode(sessionId, anchorSeq)
    if (payload === undefined) return
    const url = buildLink(payload)
    const current = ++request.current
    setLink(url)
    setOpen(true)
    void copy(url).then((ok) => {
      if (request.current !== current) return
      setDress(ok ? 'copied' : 'failed')
      clearTimeout(timer.current)
      timer.current = setTimeout(() => { setDress('idle') }, DRESS_MS)
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }

  const panel = open && link !== undefined
    ? createPortal((
      <div ref={panelRef} role="dialog" className={css.panel} style={panelPosition ?? MEASURE_STYLE} aria-label={t('scan')}>
        <QRCodeSVG value={link} size={QR_SIZE} marginSize={4} title={t('scan')} />
      </div>
    ), document.body)
    : null

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.action}
        onClick={share}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={dress === 'idle' ? t('action') : dress === 'copied' ? t('copied') : `${t('copyFailed')}\n${link ?? ''}`}
      >
        <IconShareOutlineRegular size={14} />
        <span className={css.label}>{dress === 'copied' ? t('copied') : t('action')}</span>
      </button>
      {panel}
    </div>
  )
}
