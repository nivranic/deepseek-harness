/**
 * Durable Tool event vocabulary and host-only §32 descriptor types shared
 * with type-only consumers.
 *
 * @module @deepseek-ai/dsh-tools/types
 */

import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { RemoteCapabilityPermission } from '@deepseek-ai/dsh-typert-protocol'

/**
 * Host-assessed risk tier of one registered tool (specification §32; the same
 * tiers `CommandRisk` uses for commands in §37): the tool's producer owns the
 * classification from its side-effect surface, and clients only display it.
 */
export type ToolRisk = 'low' | 'moderate' | 'high' | 'critical'

/**
 * Handler-free immutable tool view for Remote catalog consumers
 * (specification §32): the identity plus the host-owned deployment facts a
 * Lite companion or Mobile client needs to decide where a tool may run — the
 * Host declares it, the Client never guesses. Carries no model-face fields
 * (name/description/parameters projections) and no execution callbacks.
 */
export interface ToolDescriptor {
  /** Stable registered tool name; the descriptor identity. */
  readonly id: string
  /** Descriptor schema version of this tool's host-only declaration. */
  readonly version: number
  /** Host-assessed risk tier; clients display it, never re-derive it. */
  readonly risk: ToolRisk
  /** Extra Remote permissions a device-identified caller needs to complete one call; empty claims nothing extra. */
  readonly permissions: readonly RemoteCapabilityPermission[]
  /** Whether a Lite companion may execute this tool locally instead of handing back to the full runtime. */
  readonly supportsLite: boolean
  /** Whether this tool is reachable and Host-executed when a session runs on the Remote face. */
  readonly supportsRemote: boolean
}

/**
 * The live `tools/list` reply document. Schema-identical to the checked-in
 * generated projection `packages/core/tools/tool-descriptors.json`, so a
 * client parses both with one reader.
 */
export interface ToolDescriptorList {
  /** Descriptors of every globally visible tool, sorted by id. */
  readonly tools: readonly ToolDescriptor[]
}

/** Payload recorded when one nested PTC mode Tool dispatch starts. */
export interface PtcDispatchStartEventData {
  rootCallId: ToolCallId
  parentCallId: ToolCallId
  subCallId: ToolCallId
  name: string
  arguments: unknown
}

/** Payload recorded when one nested PTC mode Tool dispatch settles. */
export interface PtcDispatchEventData extends PtcDispatchStartEventData {
  isError: boolean
  content: ContentBlock[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One sub-dispatch STARTING inside a `run_code` program: the parent
     * `run_code` call id, the opaque sub-call id (new calls use
     * `<parent>:ptc:<n>`, numbered in submission order), and the tool `name` with its
     * JSON-normalized `arguments` — the exact value dispatched, normalized
     * BEFORE dispatch, so this append can never fail on payload shape.
     * Appended when the scheduler actually starts the call (not at
     * submission), so a start means the tool body pipeline was entered; a
     * call abandoned in the queue logs nothing. Log-only: `deriveMessages()`
     * ignores it; UIs use it for live per-sub-call running state and pair it
     * with `tool/ptc-dispatch` by `subCallId` (timing = the two events'
     * `time` fields).
     */
    'tool/ptc-dispatch-start': PtcDispatchStartEventData
    /**
     * One bridged sub-dispatch SETTLING: the pairing ids (matching the
     * `tool/ptc-dispatch-start` with the same `subCallId`), the tool `name`
     * with the same JSON-normalized `arguments`, and the sub-call's complete
     * model-facing outcome in `tool/result`'s own vocabulary
     * (`content` + `isError`), so UIs render a sub-call through the exact
     * code path that renders a native call. Every started sub-call settles
     * with exactly one of these (abort included: the aborted pipeline result
     * is an `isError` outcome).
     * Log-only: `deriveMessages()` ignores it, so sub-calls never re-enter
     * model context; persistence and UIs get every call. Appended inside the
     * parent `run_code`'s execution (the bridge drains in-flight dispatches
     * before returning), so its execution-enclosure relation holds by
     * construction.
     */
    'tool/ptc-dispatch': PtcDispatchEventData
  }
}
