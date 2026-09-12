---
description: "Session-telemetry capture seam for deployments and backend authors choosing a reporting backend, mounting redaction rules, or implementing the backend contract."
kind: "package-library"
---

# @deepseek-ai/dsh-session-telemetry

English | [中文](README.zh.md)

## Summary

`dsh-session-telemetry` captures privacy-safe session diagnostics for outbound reporting: it turns Session events into bounded metadata, removes every payload and workspace path, lets a deployment reduce the record further, and hands it to a reporting backend. Deployments load exactly one backend (the shipped OpenTelemetry backend is `dsh-session-telemetry-otel`), which registers `ctx.sessionTelemetry` and composes the capture coordinator. The seam owns capture, the mandatory privacy projection, further redaction, and the sharing disclosure; batching, retry, queueing, and loss policy belong to the backend SDK after `emit()`. Every mounted backend discloses its deployment-selected policy so acknowledgement surfaces can report whether and how diagnostics are shared.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

As a deployment, choose a backend and mode; add a `session-telemetry/record` listener only when the built-in privacy projection must be reduced further. As a backend author, implement the private sink contract and compose the coordinator with a capture mode.

### Choosing and mounting a backend

Load exactly one backend plugin; it registers `ctx.sessionTelemetry` with the capture coordinator and its own delivery pipeline, and a duplicate load throws. The mounted backend discloses its sharing policy through the required [`sharing` member](#the-sharing-disclosure), which the `/feedback` acknowledgement renders; a consumer renders "not configured" only when no telemetry service is mounted.

### The backend contract

The coordinator receives a private `SessionTelemetrySink` with three members: `emit(record)` is a non-blocking enqueue on the session-event path; optional `flush()` is a fire-and-forget turn-end hint; `shutdown()` drains queued records and reaches quiescence. `ctx.sessionTelemetry` exposes only the backend-independent `sharing` disclosure, so other plugins cannot inject arbitrary outbound records or drive provider shutdown.

### What gets captured

Capture runs in one of two modes. `live` capture follows appended events, replays already-live sessions at mount time, and records lifecycle markers; `on-demand` capture reads a canonical-log prefix through `captureSession(session, throughSeq?)`. Ledger records retain event time, type, sequence, bounded enum/numeric diagnostics, and fixed error class; Session content, model-produced tool names, system prompts, tool arguments/results, arbitrary error names/codes/messages, feedback text, and workspace paths are absent. The coordinator pseudonymizes Session ids through the anonymous-identity owner before any extension sees a record. Only the first `assistant/chunk` of each `(turn, step)` ships, so `seq` gaps are routine and never a loss signal.

### The sharing disclosure

<a id="the-sharing-disclosure"></a>

Every backend discloses its deployment-selected sharing policy through the seam's `sharing` vocabulary: `full` (every event is handed over as it happens), `feedback-only` (nothing is handed over until a `feedback/record` event releases the unreleased prefix), or `disabled` (nothing is handed over at all). The acknowledgement of a recorded feedback entry reports this status; the disclosure never claims delivery — handoff is the non-blocking enqueue, and batching, retry, and loss policy stay the backend SDK's.

### Redacting records

<a id="the-redact-waterfall"></a>

Every outbound record passes the `session-telemetry/record` waterfall after mandatory projection and Session-id pseudonymization. The candidate and its attributes are frozen. Listeners stack by transforming `next()`, but the coordinator accepts only original attributes whose keys and values remain unchanged; additions, rewrites, and aliases are discarded. A listener can therefore remove fields or choose a valid severity but cannot introduce outbound data, and a throwing listener withholds that record fail-closed. The canonical session log is never rewritten.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the capture design; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The seam is built on one boundary: the harness's aspect ends at `emit()`. Capture, projection, redaction, and the handoff cursor live here; batching, retry, queueing, and loss policy are the reporting SDK's, deliberately not modelled or wrapped. The design and rejected alternatives are pinned in the [revival Agent Note](../../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md).

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service Definition: `SessionTelemetryBackend`/`SessionTelemetrySink` contract, record vocabulary, `session-telemetry/record` waterfall declaration |
| [`src/coordinator.ts`](src/coordinator.ts) | Capture: live listeners, on-demand replay, chunk projection, redaction, handoff cursor, containment |

### Capture flow

Live capture registers, through the composing fiber's effects: `session/created` adopts the session and replays its log from the handoff cursor; `session/event` projects privacy-safe fields and hands off with zero I/O after the identity was resolved at construction; `session/flush` forwards the optional hint without making the loop wait; `session/disposed` captures the session's `shutdown` marker and retires it; `agent/error` relays only a fixed error class. Disposal captures shutdown markers for still-live sessions, then awaits the sink's `shutdown()`. On-demand capture registers only the disposal effect and reads the canonical log on request. Every synchronous handler contains backend and policy failures.

### The handoff cursor

A module-scope `WeakMap<Session, seq>` records, per session, the highest seq handed off (not delivered). Live capture advances it at append time; on-demand capture advances it only while handing a requested prefix. An uncaptured prefix remains solely in the canonical log, so a coordinator reload adds no telemetry-owned recovery state; a missing cursor safely degrades to re-handing from the session's construction boundary, absorbed by receiver-side dedupe on `(session.id, event.seq)`. This is a narrow, documented exception to the registrations-are-effects discipline: entries die with their sessions, the value is a monotonic watermark, and losing it is never an error. The accepted cost matches at-most-once delivery: a resumed session does not backfill records a previous process failed to deliver.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the seam contract is not enough. They move from the shipped backend to the subsystem reference and the decision evidence.

- [OpenTelemetry telemetry backend](../session-telemetry-otel/README.md) — the shipped backend deployments load, with mode and exporter configuration.
- [Session telemetry subsystem](../../../docs/subsystems/session-telemetry.md) — the capability split and type declarations.
- [Telemetry privacy inventory](../../../docs/subsystems/session-telemetry.md#privacy-inventory) — every DSH-controlled outbound value and excluded sensitive class.
- [Session telemetry revival decision](../../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md) — rationale, trade-offs, and rejected alternatives.
- [Session package map](../README.md) — adjacent persistence, projection, title, and telemetry packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as the seam observes the session stream and hands redacted copies outward; it registers nothing model-facing.

#### KV Cache effect

None; the package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the delivery and data-protection guarantees a deployment gets. They are current package constraints.

- **Best-effort delivery** — the cursor marks handed-off, not delivered; a session torn down inside a reload window cannot be re-adopted, and whatever sits in a backend queue at crash time is lost. A durable outbox (spool, per-sink cursors, at-least-once) is deferred until a deployment states a crash-loss requirement.
- **The privacy projection is deliberately sparse** — plugin-owned events expose only type, sequence, time, severity, and pseudonymous Session correlation until their owner adds an explicit safe diagnostic field.
- **On-demand policy uses current state** — uncaptured events exist only in the canonical session log; a later `captureSession()` applies the current privacy projection and reduction listeners, with no capture-time telemetry snapshot or durable pre-capture spool.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
