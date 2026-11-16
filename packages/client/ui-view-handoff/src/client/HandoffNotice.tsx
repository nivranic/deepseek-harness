/** Root-owned failure report survives a failed Session navigation. */
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { HandoffFailureKind } from './view-location.ts'

/** Receive-side result and dismissal injected by the plugin owner. */
export interface HandoffNoticeInjected {
  readonly hooks: { failure: ObservableSnapshot<HandoffFailureKind | undefined> }
  readonly dismiss: () => void
}

/**
 * Render a localized failed-open notice without hiding the current conversation.
 * @param props - failure source, dismissal, and localized copy.
 * @returns a root toast, or null when no failure is pending.
 */
export function HandoffNotice({ useFailure, dismiss, t }:
  PropsRuntime<'shell.overlay'> & PropsLocale<'view-handoff'> & InjectFace<HandoffNoticeInjected>) {
  const failure = useFailure(value => value)
  return failure === undefined ? null : <Toast text={t(failure)} onDone={dismiss} />
}
