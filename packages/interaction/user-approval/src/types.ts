/**
 * Wire-safe approval identifiers and outcome vocabulary, free of
 * cordis/service imports so browser type chains can
 * consume them without loading this package's Context augmentation.
 * @module @deepseek-ai/dsh-user-approval/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent/types'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'

/**
 * Pairs one `approval/asked` audit event with its `approval/decided`.
 * Service-issued (one fresh id per {@link ApprovalService.request} call).
 */
export type ApprovalRequestId = Branded<'ApprovalRequestId'>

/**
 * Brand a string as an {@link ApprovalRequestId}.
 * @param id - the raw id string to brand.
 * @returns the same string carrying the brand.
 */
export function ApprovalRequestId(id: string): ApprovalRequestId {
  return id as ApprovalRequestId
}

/**
 * Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn
 * request, or unavailable answerer. Callers fail closed on `unavailable`.
 */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/**
 * Host-assessed risk tier of the action under approval (specification §38,
 * same four-tier vocabulary as §37 command risk): the asking Host layer owns
 * the classification — for example a sandbox escalation derives it from the
 * requested mode — and the presenting client only displays it.
 */
export type ApprovalRisk = 'low' | 'moderate' | 'high' | 'critical'

/**
 * Sandbox mode names, mirroring `SandboxMode` in `@deepseek-ai/dsh-sandbox`
 * (kept closed so the wire fact cannot carry a made-up mode) — structurally
 * identical so the sandbox's own values assign without either package
 * importing the other, the same seam idiom `EscalationOutcome` uses.
 */
export type ApprovalSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/**
 * Structured sandbox-escalation facts for asks that ARE escalations: the
 * requested target mode and the call's effective mode it must strictly widen.
 * Approval-intrinsic metadata of the ask itself — it does not duplicate tool
 * arguments (the correlated Tool call remains the source for those).
 */
export interface ApprovalEscalationFact {
  /** Sandbox mode the ask requests, already schema-pinned to the closed target vocabulary. */
  readonly requestedMode: ApprovalSandboxMode
  /** Sandbox mode the correlated call runs under before any grant. */
  readonly effectiveMode: ApprovalSandboxMode
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * An approval question was put to the answerer chain — log-only audit
     * (like `hook/*`; NOT a surface event, carries no `surfaceOp`). `id` pairs
     * it with the `approval/decided` that always follows; `toolName` is the
     * tool the question is about, `callId` the exact tool call when the asker
     * had one, `reason` the asker's human-readable explanation (e.g. a hook's
     * permission-decision reason), `risk` the asker's Host-assessed tier when
     * it classified one, `escalation` the structured sandbox facts when the
     * ask is a sandbox escalation.
     */
    'approval/asked': {
      id: ApprovalRequestId
      toolName: string
      callId?: ToolCallId
      reason?: string
      risk?: ApprovalRisk
      escalation?: ApprovalEscalationFact
    }
    /**
     * The outcome of a prior `approval/asked` (same `id`) — log-only audit.
     * Exactly one per ask, appended when the outcome is known: a decision, a
     * cancellation, or the fail-closed `'unavailable'`.
     */
    'approval/decided': {
      id: ApprovalRequestId
      outcome: ApprovalOutcome
    }
  }
}

/** Client-safe payload declared for the approval answerer waterfall. */
export interface ApprovalRequestEvent {
  /** Agent identity projected to the corresponding Client Context in transit. */
  readonly agent: Agent
  /** Tool whose operation requires a decision. */
  readonly toolName: string
  /** Exact tool call being decided, when available. */
  readonly callId?: ToolCallId
  /** Human-readable reason supplied by the asker. */
  readonly reason?: string
  /** Host-assessed risk tier of the action under approval, when the asker classified one. */
  readonly risk?: ApprovalRisk
  /** Structured sandbox-escalation facts, when the ask is a sandbox escalation. */
  readonly escalation?: ApprovalEscalationFact
  /** Cancellation lifetime of the pending request. */
  readonly signal?: AbortSignal
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Ask composed answerers for one decision. Return an outcome to claim the
     * request or call `next()` to delegate. Scope-filtered dispatch
     * (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @param req - pending approval request.
     * @mode waterfall
     */
    'approval/request'(
      this: Scoped<Agent>,
      req: ApprovalRequestEvent,
      next: () => Promise<ApprovalOutcome>,
    ): Promise<ApprovalOutcome>
  }
}
