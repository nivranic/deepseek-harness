/** Rename dialog shared by Session menus, shortcuts, and title double-clicks. */
import { useEffect, useRef, useState } from 'react'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SessionRenameDialogInjected, SessionRenameDialogProps, SessionRenameTarget,
} from '../contract/slots.ts'
import css from '../rows/WorkspaceBrowser.module.css'

/**
 * The `shell.overlay` entry: nothing while no rename is requested, otherwise
 * one dialog per request (keyed by the Session, so a new request starts a
 * fresh draft). Sessions have no client-side name-conflict rule (the host
 * normalizes), and unlike Workspace rename an unchanged title is NOT
 * blocked. An unnamed Session starts with an empty draft and requires a name.
 * @param props - the request hook, its settlement, the rename hop, and the locale seat.
 * @returns the open dialog, or null.
 */
export function SessionRenameDialog({ useRenameRequest, settleSessionRename, prepareRename, t }: SessionRenameDialogProps) {
  const request = useRenameRequest(pending => pending)
  if (request === null) return null
  return (
    <RenameForm
      key={request.sessionId}
      request={request}
      prepareRename={prepareRename}
      onSettle={settleSessionRename}
      t={t}
    />
  )
}

/** One request's dialog: the draft seeds from the request on mount; in-flight and error state die with it. */
function RenameForm({ request, prepareRename, onSettle, t }: {
  request: SessionRenameTarget
  prepareRename: SessionRenameDialogInjected['prepareRename']
  onSettle: () => void
  t: SessionRenameDialogProps['t']
}) {
  const [draft, setDraft] = useState(request.currentTitle)
  const [renaming, setRenaming] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [operation, setOperation] = useState<{
    submit: (title: string) => Promise<void>
    signal: AbortSignal
  } | null>(null)
  useEffect(() => {
    const control = new AbortController()
    void prepareRename(request.sessionId, control.signal).then((submit) => {
      if (!control.signal.aborted) setOperation({ submit, signal: control.signal })
    }, (reason: unknown) => {
      if (!control.signal.aborted) setError(reason instanceof Error ? reason : new Error(String(reason)))
    })
    return () => { control.abort() }
  }, [prepareRename, request.sessionId])
  // IME composition: Enter that commits a composition must not submit.
  const composingRef = useRef(false)
  const trimmed = draft.trim()
  const blocked = renaming || trimmed === '' || operation === null
  const close = () => {
    if (renaming) return
    onSettle()
  }
  const confirm = () => {
    if (blocked) return
    setRenaming(true)
    setError(null)
    operation.submit(trimmed).then(() => {
      if (operation.signal.aborted) return
      setRenaming(false)
      onSettle()
    }).catch((reason: unknown) => {
      if (operation.signal.aborted) return
      setRenaming(false)
      setError(reason instanceof Error ? reason : new Error(String(reason)))
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('rename.session.title')}
      footer={(
        <>
          <Button variant="outline" disabled={renaming} onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" disabled={blocked} onClick={confirm}>{t('rename')}</Button>
        </>
      )}
    >
      <input
        className={css.renameInput}
        value={draft}
        aria-label={t('field.sessionName')}
        data-modal-autofocus
        disabled={renaming}
        onFocus={(e) => { e.target.select() }}
        onChange={(e) => { setDraft(e.target.value); setError(null) }}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={() => { composingRef.current = false }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !composingRef.current) {
            e.preventDefault()
            confirm()
          }
        }}
      />
      {error !== null && <div className={css.renameError} role="alert">{remoteErrorOf(error)?.code === 'session/revision-conflict'
        ? t('rename.session.conflict')
        : error.message}</div>}
    </Modal>
  )
}
