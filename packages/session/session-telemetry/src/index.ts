/**
 * SessionTelemetryBackend Service Definition for the DeepSeek Harness.
 *
 * This package owns the CAPTURE side of session-event reporting — which records
 * exist (the chunk projection), what privacy-safe fields they carry, when
 * they are captured (adoption, the per-append firehose, lifecycle
 * forwarding), live versus on-demand canonical-log capture, and the HMR
 * cursor. Everything downstream of
 * {@link SessionTelemetrySink.emit} — batching, retry, queueing, and loss policy — is the
 * reporting SDK's territory and is deliberately not modelled here. The
 * design and its trade-offs are pinned in
 * .agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md.
 *
 * @module @deepseek-ai/dsh-session-telemetry
 */

import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionTelemetry: SessionTelemetryBackend
  }

  interface Events {
    /**
     * Further reduce one frozen privacy-safe record before it reaches the
     * backend. Session identities are already pseudonymous, and the
     * coordinator has removed Session content, prompts, tool names, arguments
     * and results, arbitrary error details, and workspace paths. Listeners
     * stack by transforming `next()`'s return value. After the waterfall, the
     * coordinator keeps only original attributes whose keys and values remain
     * unchanged; additions and rewrites are discarded, while a valid severity
     * change survives. Returning without `next()` can therefore remove fields
     * but cannot inject data or rewrite record identity. Dispatched
     * synchronously on the capture hot path inside containment: a throwing
     * listener withholds that one record and never reaches the agent loop.
     * Live capture dispatches at append time; on-demand capture dispatches
     * while reading the canonical log. The canonical Session log is never
     * rewritten.
     * @param record - the frozen candidate record; listeners return a possibly
     *   stricter copy and must not mutate it.
     * @mode waterfall
     */
    'session-telemetry/record'(record: SessionTelemetryRecord, next: () => SessionTelemetryRecord): SessionTelemetryRecord
  }
}

/**
 * Severity of a telemetry record, pre-mapped at capture so a receiver can
 * alert with zero configuration: `error` for events whose own outcome flag
 * says so (the tool-result block's `isError`, `turn/end` error reasons) and for
 * `agent-error` operational records. Captured events otherwise default to
 * `info`; `warn` remains available to `session-telemetry/record` policies and
 * backends.
 */
export type SessionTelemetrySeverity = 'info' | 'warn' | 'error'

/**
 * One privacy-safe logical record handed to a backend. Ledger records retain
 * session-event timing, type, sequence, outcome, and bounded diagnostic fields;
 * they never contain the event payload or workspace path.
 *
 * Operational records (`channel: 'ops'`) carry the two signals with no log
 * home (`agent-error`, `shutdown`) and deliberately omit `event.seq`-style
 * identity so they can never be mistaken for ledger rows.
 */
export interface SessionTelemetryRecord {
  /** Ledger (session-log mirror) or ops (operational signal) channel; backends keep the two under separate instrumentation scopes. */
  readonly channel: 'ledger' | 'ops'
  /** Unix epoch milliseconds — the source event's append time for ledger records, the emission time for ops records. */
  readonly time: number
  /** Pre-mapped alerting severity; see {@link SessionTelemetrySeverity}. */
  readonly severity: SessionTelemetrySeverity
  /**
   * Bounded diagnostic attributes. Ledger records carry `session.id`,
   * `event.type`, `event.seq`, optional fork correlation, and an allowlisted
   * set of numeric, boolean, enum, and fixed error-class fields. Ops records carry
   * `telemetry.op`, `session.id`, and, for `agent-error`, `turn`, `step`, and
   * `error.class`. The coordinator uses the anonymous-identity owner to
   * pseudonymize Session ids before any reduction listener runs; no attribute
   * contains a workspace path or free-form payload.
   */
  readonly attributes: Readonly<Record<string, string | number | boolean>>
}

/**
 * The minimum backend contract the coordinator requires. {@link SessionTelemetryBackend} is
 * its service-registered form; tests compose the coordinator with a bare
 * implementation of this interface.
 */
export interface SessionTelemetrySink {
  /**
   * Hand one record to the backend's pipeline. MUST be a non-blocking
   * enqueue — the coordinator calls this synchronously from the
   * `session/event` hot path or an explicit canonical-log capture, so anything
   * slower than a queue push would tax the agent loop or feedback handling.
   * Errors thrown here are contained by the coordinator and logged; they
   * never reach the loop.
   * @param record - the logical record to report; owned by the backend after the call.
   */
  emit(record: SessionTelemetryRecord): void
  /**
   * Optional hint that a turn ended. A backend may forward it to its SDK's
   * flush so records are exported after each turn. Called
   * fire-and-forget; implementations must not block and must not throw
   * meaningfully (the coordinator contains exceptions). Most backends should
   * leave this unimplemented and let their SDK's own batching cadence govern
   * export timing: a backend that does implement it owns the interaction
   * between its concurrent flushes and {@link shutdown}'s drain (the OTel
   * backend leaves it unimplemented for exactly that hazard — see the
   * revival Agent Note).
   */
  flush?(): void
  /**
   * Forward the fiber's disposal to the SDK: flush whatever is queued and
   * reach quiescence, per the SDK's own shutdown contract. Everything
   * emitted before this call must still be delivered — including records
   * enqueued while a {@link flush} hint is in flight, so a backend whose SDK
   * guards against concurrent flushes orders behind the outstanding one (the
   * coordinator emits its dispose-time `shutdown` markers immediately before
   * calling this). Awaited by the coordinator's dispose; a rejection is
   * logged as a warning and never fails application teardown.
   * The coordinator captures dispose-time shutdown markers immediately before
   * this call for live capture; on-demand capture creates no ops records.
   * @returns resolves when the backend's pipeline has quiesced.
   */
  shutdown(): Promise<void>
}

/**
 * Deployment-selected session-sharing policy disclosed by a mounted
 * {@link SessionTelemetryBackend} backend to human-facing acknowledgement surfaces (the
 * `/feedback` command's confirmation text). The Service Definition owns the
 * vocabulary so consumers and backends do not depend on a specific provider.
 */
export type SessionTelemetrySharingStatus = 'full' | 'feedback-only' | 'disabled'

/**
 * Loadable form of the backend contract: one implementation per context —
 * the cordis `Service` registration under the `sessionTelemetry` key throws on a
 * duplicate, cordis' standard behavior. A backend composes a
 * {@link SessionTelemetryCoordinator} in its constructor to install the capture side.
 */
export abstract class SessionTelemetryBackend extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessionTelemetry')
  }

  /**
   * Deployment-selected session-sharing policy, disclosed for acknowledgement
   * surfaces that report whether privacy-safe Session diagnostics are eligible
   * for external sharing when feedback is recorded. Every backend must disclose
   * its policy; a consumer renders "not configured" only when no telemetry
   * service is mounted. The seam owns this vocabulary so the disclosure is
   * backend-independent.
   */
  abstract readonly sharing: SessionTelemetrySharingStatus
}

export { SessionTelemetryCoordinator, type SessionTelemetryCapture } from './coordinator.ts'
