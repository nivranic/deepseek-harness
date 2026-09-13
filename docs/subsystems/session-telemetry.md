# SessionTelemetryBackend

English | [中文](session-telemetry.zh.md)

Outbound session reporting is a [capability seam](../capability-seams.md): the Service Definition and coordinator ([dsh-session-telemetry](../../packages/session/session-telemetry), `ctx.sessionTelemetry`) own capture, the mandatory privacy projection, chunk projection, further-redaction waterfall, handoff cursor, and private sink contract; the Service Provider ([dsh-session-telemetry-otel](../../packages/session/session-telemetry-otel)) owns the OTel pipeline and network handoff. This optional capability never enters a model request. The reporting SDK owns batching, retry, queueing, and loss after the private sink's `emit()`; the [privacy decision](../../.agents/notes/implemented/architecture/2026-09-02-privacy-safe-session-telemetry.md) owns the consent and data-minimization rationale.

Source: [`packages/session/session-telemetry/src/index.ts`](../../packages/session/session-telemetry/src/index.ts)

## The logical record

```ts type-equiv
/**
 * Severity of a telemetry record, pre-mapped at capture so a receiver can
 * alert with zero configuration: `error` for events whose own outcome flag
 * says so (the tool-result block's `isError`, `turn/end` error reasons) and for
 * `agent-error` operational records. Captured events otherwise default to
 * `info`; `warn` remains available to `session-telemetry/record` policies and
 * backends.
 */
type SessionTelemetrySeverity = 'info' | 'warn' | 'error'
```

```ts type-equiv
/**
 * One privacy-safe logical record handed to a backend. Ledger records retain
 * session-event timing, type, sequence, outcome, and bounded diagnostic fields;
 * they never contain the event payload or workspace path.
 *
 * Operational records (`channel: 'ops'`) carry the two signals with no log
 * home (`agent-error`, `shutdown`) and deliberately omit `event.seq`-style
 * identity so they can never be mistaken for ledger rows.
 */
interface SessionTelemetryRecord {
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
```

Only the first `assistant/chunk` of each `(turn, step)` ships; the rest drop at capture, so `seq` gaps are routine and never a loss signal. Unknown plugin-merged events expose only record time, pseudonymous Session identity, event type, and sequence until their owner adds an explicit safe projection. Delivery is best-effort: records can be lost or duplicated, so receivers dedupe ledger records on the already-pseudonymous `(session.id, event.seq)` pair; ops records tolerate duplicates.

<a id="privacy-inventory"></a>
## Privacy inventory

The shipped base defaults to `DISABLED`; only explicit `FULL` or `FEEDBACK_ONLY` constructs an exporter, and any non-empty `DSH_TELEMETRY_DISABLED` disables the row before load. An enabled record's log body carries no value or content; the OTLP JSON encoder may represent that absence as an empty `body: {}` object. The following inventory is exhaustive for DSH-controlled content-bearing values and Resource or log-record attributes, and it also accounts for static instrumentation-scope metadata. SDK protocol framing, bookkeeping fields such as `droppedAttributesCount`, and deployment-supplied exporter options are outside it:

| Location | Fields |
|---|---|
| OTel Resource attributes | `service.name`, `service.version`, `os.type`, `host.arch`, derived anonymous `user.id` |
| Instrumentation-scope metadata | Ledger name `@deepseek-ai/dsh-session-telemetry-otel`, ops name `@deepseek-ai/dsh-session-telemetry-otel/ops`, and the package-manifest version on both |
| DSH-set record values | Source event or operation time, the same observed time, mapped severity number/text, and a body with no value or content |
| Ledger record attributes | HMAC-pseudonymous `session.id` and optional `session.parent_id`, `event.type`, `event.seq`, optional `session.seed_length` |
| Safe diagnostic record attributes | `turn`, `step`, `turn.outcome`, `message.source`, `assistant.chunk_type`, `assistant.interrupted`, `tool.is_error`, `request.reason`, `request.starts_series`, fixed `error.class` |
| Ops record attributes | `telemetry.op`, pseudonymous `session.id`, optional `turn`, `step`, fixed `error.class` |

The OTel provider binds every SDK log record to `ROOT_CONTEXT`; an active span installed by another in-process instrumentor cannot add `traceId`, `spanId`, or trace flags to this inventory.

Closed diagnostic enums use fixed values and map future extensions to `extension`; error names map to a fixed built-in class set with `CustomError` fallback. The exporter never receives message or reasoning content, system prompts, tool schemas, model-produced tool names, tool arguments/results, feedback text, arbitrary error names/codes/messages, source code, file content, todo or compaction text, workspace paths, raw Session ids, the private anonymous-identity root or Session key, or `agent.id`. The canonical Session log remains complete and local. A `session-telemetry/record` listener receives already-pseudonymous identifiers and none of the excluded payload.

## The sharing disclosure

The seam's acknowledgement contract (owned by the [Service Definition README's sharing-disclosure section](../../packages/session/session-telemetry/README.md#the-sharing-disclosure)): every backend discloses its deployment-selected sharing policy through the required abstract `sharing` member on `ctx.sessionTelemetry`, and consumers render "not configured" only when no telemetry service is mounted. The disclosure states the current policy, never delivery or retention — handoff is the non-blocking enqueue, and batching, retry, and loss policy stay the reporting SDK's.

```ts type-equiv
/**
 * Deployment-selected session-sharing policy disclosed by a mounted
 * {@link SessionTelemetryBackend} backend to human-facing acknowledgement surfaces (the
 * `/feedback` command's confirmation text). The Service Definition owns the
 * vocabulary so consumers and backends do not depend on a specific provider.
 */
type SessionTelemetrySharingStatus = 'full' | 'feedback-only' | 'disabled'
```

## The backend contract

```ts type-equiv
/**
 * The minimum backend contract the coordinator requires. {@link SessionTelemetryBackend} is
 * its service-registered form; tests compose the coordinator with a bare
 * implementation of this interface.
 */
interface SessionTelemetrySink {
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
```

`SessionTelemetryBackend` (`ctx.sessionTelemetry`, [signatures](#ctxsessiontelemetry--sessiontelemetrybackend-abstract-seam)) is the contract's loadable form — one implementation per context, duplicate load throws — and a backend composes the seam's `SessionTelemetryCoordinator` in its constructor to install the capture side.

## The redact waterfall: `session-telemetry/record`

Every record passes the `session-telemetry/record` [waterfall](../cordis-primer.md#cordis-waterfall-semantics) after mandatory privacy projection and Session-id pseudonymization ([event entry](#session-telemetryrecord--waterfall)). The coordinator freezes the candidate before dispatch and then keeps only original attributes whose keys and values remain unchanged; additions, aliases, and rewrites are discarded, while a valid severity change survives. Listeners can therefore delete fields by transforming `next()` or returning a stricter record, and a throwing listener withholds that record fail-closed. The canonical Session log is never rewritten.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessiontelemetry--sessiontelemetrybackend-abstract-seam"></a>

### `ctx.sessionTelemetry` — `SessionTelemetryBackend` (abstract seam)

Loadable form of the backend contract: one implementation per context — the cordis `Service` registration under the `sessionTelemetry` key throws on a duplicate, cordis' standard behavior. A backend composes a SessionTelemetryCoordinator in its constructor to install the capture side.

Source: [`packages/session/session-telemetry/src/index.ts`](../../packages/session/session-telemetry/src/index.ts)

<a id="session-telemetry-events"></a>

### `session-telemetry/*` events

<a id="session-telemetryrecord--waterfall"></a>

#### `session-telemetry/record` — waterfall

Further reduce one frozen privacy-safe record before it reaches the backend. Session identities are already pseudonymous, and the coordinator has removed Session content, prompts, tool names, arguments and results, arbitrary error details, and workspace paths. Listeners stack by transforming `next()`'s return value. After the waterfall, the coordinator keeps only original attributes whose keys and values remain unchanged; additions and rewrites are discarded, while a valid severity change survives. Returning without `next()` can therefore remove fields but cannot inject data or rewrite record identity. Dispatched synchronously on the capture hot path inside containment: a throwing listener withholds that one record and never reaches the agent loop. Live capture dispatches at append time; on-demand capture dispatches while reading the canonical log. The canonical Session log is never rewritten.

```ts cordis-catalog
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
```

Source: [`packages/session/session-telemetry/src/index.ts`](../../packages/session/session-telemetry/src/index.ts)
<!-- END GENERATED cordis-surface -->
