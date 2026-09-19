/** Connection-owned feedback entries discard local pending UI on Host replacement. */
import { useEffect } from 'react'
import { MessageFeedbackActions } from './MessageFeedbackActions.tsx'
import { FeedbackDialog } from './FeedbackDialog.tsx'
import type { MessageFeedbackActionProps, FeedbackDialogProps } from './slots.ts'

/**
 * Render supported message-feedback actions with generation-owned callbacks.
 * @param props - Session feedback view, operation authority and injected verbs.
 * @returns the supported feedback controls, or no entry without read support.
 */
export function CapabilityAwareMessageFeedbackActions({ useFeedbackAccess, ...props }: MessageFeedbackActionProps) {
  const access = useFeedbackAccess(value => value)
  useEffect(() => {
    if (access.read && !access.put && access.current()) void props.ensure()
  }, [access, props.ensure])
  if (!access.read) return null
  return <MessageFeedbackActions key={access.generation} {...props} access={access} />
}

/**
 * Keep dialog callbacks and transient state within their admitted connection.
 * @param props - dialog state, current operation authority and injected verbs.
 * @returns the supported dialog and notices, or no entry for an unsupported target.
 */
export function CapabilityAwareFeedbackDialog({ useFeedbackAccess, ...props }: FeedbackDialogProps) {
  const access = useFeedbackAccess(value => value)
  const target = props.useDialog(value => value.target)
  if (target?.kind === 'session' ? !access.record
    : target?.kind === 'message' ? !access.read || !access.put
      : !access.record && !access.read) return null
  return <FeedbackDialog key={access.generation} {...props}
    edit={(draft) => { if (access.current()) props.edit(draft) }}
    submit={async () => { if (access.current()) await props.submit() }}
    dismiss={() => { if (access.current()) props.dismiss() }}
    dismissFailure={() => { if (access.current()) props.dismissFailure() }}
    dismissToast={(seq) => { if (access.current()) props.dismissToast(seq) }}
  />
}
