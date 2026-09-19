/**
 * One Session's feedback surface: the message-feedback object layer and the
 * dialog controller, plus the routing between them. A message target puts a
 * selected judgment through the message controller; the Session target records
 * through the `sessionFeedback` Remote.
 * @module @deepseek-ai/dsh-client-ui-message-feedback/client/surface
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FeedbackRecord } from '@deepseek-ai/dsh-command-feedback/types'
import { MessageFeedbackController, describe, type MessageFeedbackActionResult } from './controller.ts'
import { FeedbackDialogController, type FeedbackDialogTarget } from './dialog.ts'

/** The per-session pair behind every entry of one Session. */
export class FeedbackSurface {
  private disposed = false
  /** The Session's message-feedback object layer, shared by every message control. */
  readonly feedback: MessageFeedbackController
  /** The Session's dialog and toast state, shared by the overlay entry and the message controls. */
  readonly dialog: FeedbackDialogController

  /**
   * @param ctx - the browser plugin context carrying both feedback Remotes.
   * @param sessionId - Session owning the transcript and the remark.
   */
  constructor(private readonly ctx: ClientContext, private readonly sessionId: SessionId) {
    this.feedback = new MessageFeedbackController(ctx, sessionId)
    this.dialog = new FeedbackDialogController((target, entry) => target.kind === 'message'
      ? this.feedback.rate(target.messageId, target.rating, entry)
      : this.recordSession(entry))
  }

  /** Record one Session-level remark through the sessionFeedback Remote. */
  private async recordSession(entry: FeedbackRecord): Promise<MessageFeedbackActionResult> {
    if (this.disposed) return { ok: false, error: { code: 'disposed', message: 'Feedback surface is disposed' } }
    const host = this.ctx.remote.$host
    const current = (): boolean => !this.disposed && this.ctx.remote.$host === host
    if (host.capabilities?.includes('feedback.session.record.v1') !== true) {
      return { ok: false, error: { code: 'capability-unavailable', message: 'Session feedback is unavailable' } }
    }
    const carried = await this.ctx.remote.sessionFeedback.record({ sessionId: this.sessionId, ...entry })
    if (!current()) {
      return { ok: false, error: { code: 'connection-changed', message: 'Feedback connection changed' } }
    }
    if (!carried.ok) return { ok: false, error: { code: carried.error.code, message: carried.error.message } }
    if (carried.value.ok) return { ok: true }
    return { ok: false, error: { code: carried.value.error.code, message: describe(carried.value.error.code) } }
  }

  /**
   * Open only a currently supported feedback target.
   * @param target - Session remark or message rating to submit.
   */
  open(target: FeedbackDialogTarget): void {
    if (this.disposed) return
    const capabilities = this.ctx.remote.$host.capabilities ?? []
    if (!(target.kind === 'session'
      ? capabilities.includes('feedback.session.record.v1')
      : capabilities.includes('feedback.message.read.v1') && capabilities.includes('feedback.message.put.v1'))) return
    this.dialog.open(target)
  }

  /** Clear Host-owned feedback and dialog state immediately on connection withdrawal. */
  handleGenerationChanged(): void {
    this.feedback.handleGenerationChanged()
    this.dialog.reset()
  }

  /** Drop both controllers when the owning fiber unloads. */
  dispose(): void {
    this.disposed = true
    this.feedback.dispose()
    this.dialog.dispose()
  }
}
