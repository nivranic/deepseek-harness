# 遥测（telemetry）

[English](session-telemetry.md) | 中文

对外会话上报是一项[能力 seam](../capability-seams.zh.md)：Service Definition 与协调器（[dsh-session-telemetry](../../packages/session/session-telemetry)，`ctx.sessionTelemetry`）拥有捕获、强制隐私投影、分片投影、进一步脱敏 waterfall（瀑布式事件）、handoff 游标与私有 sink 约定；Service Provider（[dsh-session-telemetry-otel](../../packages/session/session-telemetry-otel)）拥有 OTel 流水线与网络交接。这项可选能力绝不会进入模型请求。私有 sink 的 `emit()` 之后，批处理、重试、排队与丢失归上报 SDK；[隐私决定](../../.agents/notes/implemented/architecture/2026-09-02-privacy-safe-session-telemetry.zh.md)拥有授权与数据最小化理由。

源码：[`packages/session/session-telemetry/src/index.ts`](../../packages/session/session-telemetry/src/index.ts)

## 逻辑记录

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

每个 `(turn, step)` 只发出第一条 `assistant/chunk`；其余分片在捕获时丢弃，因此 `seq` 缺口是常态，绝不是数据丢失信号。未知的插件合并事件只暴露记录时间、假名化 Session 身份、事件类型与序号，直到其 owner 添加显式安全投影。投递是尽力而为的：记录可能丢失或重复，因此接收端基于已假名化的 `(session.id, event.seq)` 对 ledger 记录去重；ops 记录容忍重复。

<a id="privacy-inventory"></a>
## 隐私清单

随附 base 默认 `DISABLED`；只有显式 `FULL` 或 `FEEDBACK_ONLY` 才会构造导出器，任何非空 `DSH_TELEMETRY_DISABLED` 都会在加载前禁用该配置项。已启用记录的日志 body 不携带值或内容；OTLP JSON 编码器可能把这种缺省表示为空的 `body: {}` 对象。下表穷尽列出 DSH 控制的内容值及 Resource 或日志记录 attributes，并明确计入静态插桩作用域元数据。SDK 协议封装、`droppedAttributesCount` 等簿记字段和部署方提供的导出器选项不在清单范围内：

| 位置 | 字段 |
|---|---|
| OTel Resource attributes | `service.name`、`service.version`、`os.type`、`host.arch`、派生的匿名 `user.id` |
| 插桩作用域元数据 | Ledger 名称 `@deepseek-ai/dsh-session-telemetry-otel`、ops 名称 `@deepseek-ai/dsh-session-telemetry-otel/ops`，以及两者都携带的包清单版本 |
| DSH 设置的记录值 | 源事件或操作时间、相同的观测时间、映射后的严重级别数字／文本，以及不携带值或内容的 body |
| Ledger 记录 attributes | HMAC 假名化的 `session.id` 与可选 `session.parent_id`、`event.type`、`event.seq`、可选 `session.seed_length` |
| 安全诊断记录 attributes | `turn`、`step`、`turn.outcome`、`message.source`、`assistant.chunk_type`、`assistant.interrupted`、`tool.is_error`、`request.reason`、`request.starts_series`、固定的 `error.class` |
| Ops 记录 attributes | `telemetry.op`、假名化的 `session.id`、可选 `turn`、`step`、固定的 `error.class` |

OTel 提供方会把每条 SDK 日志记录显式绑定到 `ROOT_CONTEXT`；同一进程中其他插桩工具安装的活动 span 无法把 `traceId`、`spanId` 或 trace flags 添加到这份清单。

封闭诊断枚举使用固定值，并把未来扩展映射为 `extension`；错误名称映射为固定的内置类别集合，并以 `CustomError` 兜底。导出器绝不会收到消息或推理内容、系统提示词、工具 schema、模型产生的工具名、工具参数／结果、反馈文本、任意错误名／代码／消息、源代码、文件内容、todo 或压缩文本、workspace 路径、原始 Session id、私有匿名 identity 根种子或 Session 密钥，以及 `agent.id`。权威 Session 日志保持完整并留在本地。`session-telemetry/record` 监听器收到的标识符已经假名化，也不会收到任何被排除的载荷。

## 共享披露

该 seam 的确认契约（归属 [Service Definition README 的共享披露段](../../packages/session/session-telemetry/README.zh.md#the-sharing-disclosure)）：每个后端都通过 `ctx.sessionTelemetry` 上必需的抽象 `sharing` 成员披露其部署级共享策略，消费方只有在未挂载任何遥测服务时才渲染「未配置」。披露只陈述当前策略，绝不承诺投递或留存——交接是非阻塞入队，批处理、重试与丢失策略仍归上报 SDK。

```ts type-equiv
/**
 * Deployment-selected session-sharing policy disclosed by a mounted
 * {@link SessionTelemetryBackend} backend to human-facing acknowledgement surfaces (the
 * `/feedback` command's confirmation text). The Service Definition owns the
 * vocabulary so consumers and backends do not depend on a specific provider.
 */
type SessionTelemetrySharingStatus = 'full' | 'feedback-only' | 'disabled'
```

## 后端约定

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

`SessionTelemetryBackend`（`ctx.sessionTelemetry`，[签名](#ctxsessiontelemetry--sessiontelemetrybackend-abstract-seam)）是该约定的可加载形态：每个上下文只允许一个实现，重复加载会抛出异常；后端在其构造函数中组合 seam 的 `SessionTelemetryCoordinator`，以此装配捕获侧。

## 脱敏 waterfall：`session-telemetry/record`

每条记录都在强制隐私投影和 Session id 假名化之后经过 `session-telemetry/record` [waterfall](../cordis-primer.zh.md#cordis-waterfall-semantics)（[事件条目](#session-telemetryrecord--waterfall)）。协调器会在分发前冻结候选记录，返回后只保留键和值均未改变的原始属性；新增、别名复制与改写会被丢弃，有效的 severity 改动可以保留。监听器因此只能通过变换 `next()` 或返回更严格的记录来删除字段；监听器抛出异常时，该记录会以 fail-closed 方式被扣下。权威 Session 日志永不改写。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
