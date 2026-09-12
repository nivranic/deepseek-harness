# Agent Note: Buffer-free feedback telemetry

Status: implemented

English | [中文](2026-08-06-buffer-free-feedback-telemetry.zh.md)

## Problem

Feedback-only telemetry must hand over privacy-safe diagnostics derived from the session-log prefix only after recorded feedback. Retaining one reduced projection for every event until that trigger duplicates the canonical session log and grows without a bound for a long-lived session that never records feedback.

## Decision

The telemetry coordinator provides `live` and `on-demand` capture. On-demand capture registers no session, flush, or operational-event listeners and retains no projected records. `captureSession(session, throughSeq?)` reads the canonical session log after the handoff cursor through an optional inclusive sequence boundary, constructs the mandatory payload-free projection directly from each accepted event, pseudonymizes Session ids, runs the current `session-telemetry/record` waterfall over a frozen candidate, and hands the reduced result to the backend.

`FEEDBACK_ONLY` invokes that method with the `feedback/record` event's sequence. The append is already committed when `session/event` listeners run, so the replay contains the feedback event and cannot include a later suffix. The existing handoff cursor distinguishes later replays without another pending-record index.

Because on-demand capture reads only the canonical log, it emits no `agent-error` or `shutdown` operational records. Redaction is evaluated at feedback time rather than append time. The [feedback mode decision](../feature/2026-08-05-feedback-gated-session-telemetry.md) owns the public sharing behavior; this note owns its buffer-free realization.

## Alternatives considered

**Retain capture-time reduced records.** This preserves the exact reduction policy and operational records observed when each event occurs, but duplicates the unbounded session prefix. The mode provides feedback-triggered handoff of bounded diagnostics derived at that time, not capture-time policy snapshots or pre-feedback operational telemetry.

**Retain session event references or sequence numbers.** Rejected because the canonical log already supplies both order and identity. A second index saves payload copies but adds lifecycle state without enabling any required behavior.

**Write a durable pre-feedback spool.** Deferred until a deployment requires crash recovery before feedback. It adds storage, cleanup, and confidentiality policy to a mode whose intended behavior is to hand over nothing when the process exits before feedback.

## Consequences

A no-feedback session consumes no telemetry-owned memory proportional to its event count; the canonical session log remains the only pre-feedback copy. Feedback handling performs projection, Session-id pseudonymization, and reduction synchronously before the backend's non-blocking enqueue, so its cost scales with the unreleased prefix. A reduction-policy change before feedback affects that replay, and a crash before feedback hands over nothing. Later feedback processes only events beyond the handoff cursor.
