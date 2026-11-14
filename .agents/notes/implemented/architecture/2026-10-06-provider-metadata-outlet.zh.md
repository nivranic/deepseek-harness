# Agent Note: 提供方调用以逐次调用元数据经 ops 遥测出口在自身同意类门下外发

Status: implemented

[English](2026-10-06-provider-metadata-outlet.md) | 中文

## Problem

第 44 节五类遥测中 providerMetadata 是最后一个「本地接缝已在、出口缺失」的类。一次 provider 调用的元数据——响应 `x-request-id`、HTTP 状态、retry-after、耗时——只有 DeepSeek 适配器内部读得到，且适配器只在失败路径读 request id。attribution headers（harness 发往 provider 的出站 `User-Agent` 与身份头）积累了一项悬置的语义问题：它们算遥测吗？另外 usage 已经走会话台账出口（sessionTelemetry 类下的 `assistant/message` 事件），provider 类若再携带 tokens 就会双重导出同一事实。

## Decision

1. **Attribution headers 裁定：不是遥测。** `attributionHeaders()`/`APP_IDENTITY` 与 `x-deepseek-harness-user-id` 是发往 provider 的请求路径静态产品事实——它们从不前往 collector、不是观测数据，不计入任何遥测类。裁定记录于本 note 与 §44 remaining。
2. **usage 不相交裁定。** `TokenUsage` 随 `assistant/message` 事件走 sessionTelemetry 台账出口（`agent-loop/src/agent.ts` 中断与正常两条 append 路径）。providerMetadata 记录因此绝不携带 usage/tokens；两类导出同一调用的不相交事实——会话类导出对话，提供方类导出调用本身。
3. **生产者**（`packages/llm/llm-deepseek/src/adapter.ts`）：适配器是唯一同时看到响应头、结构化失败字段与调用起止的位置——`llm/llm` 核心看到的是已归一化的失败（响应头已丢），agent loop 看不见 HTTP 细节且会漏掉 compaction/title 直连调用。`DeepSeekAdapterOptions` 新增 `resolveTelemetry?: () => TelemetryOwner | undefined` thunk（`index.ts` 里接 `ctx.get('sessionTelemetry')`，照 `resolveAttachments` 形态），发射点解析 owner——cordis 行序无装载语义、后端 consent 在其自身构造时冻结，restart 语义保持。每次调用完成在 `streamWithConnection` 收口一条 ops 记录：`{op:'llm-provider-call', provider, model, purpose?, ok, status?, requestId?, retryAfterMs?, durationMs?}`，severity 成功 info 失败 warn，`attributes['telemetry.op']='llm-provider-call'`、已知时带 `session.id`。绝不携带 usage、消息内容、baseURL、密钥材料。成功路径新增一次 `requestId(response.headers)` 读取（此前仅失败分支）；传输层失败无响应头、相应字段缺省。thunk 缺席或门关：静默零调用零异常、适配器行为零变化。
4. **出口**（`packages/session/session-telemetry-otel`）：构造门放宽为四 kind 析取；ops 发射在任一 ops 生产类开启时创建；自排空 fiber 覆盖一切非 session 组合；`mode: DISABLED` 仍是总闸。
5. **零运行时依赖**：`dsh-session-telemetry` 是 type-only dev dependency；owner 接口是适配器模块本地物、类检查是本地 `providerMetadata === true` 特化并点名权威 `telemetryKindAllowed`，循 crash 与 device-trust 先例。

## Alternatives considered

- **生产者放 `llm/llm` 核心**：拒绝——其 peer 面设计上仅 cordis，且 adapter 失败归一化点上响应头已丢。
- **生产者放 agent loop**：拒绝——看不见 HTTP 细节，且把出口绑死在 loop 上会漏掉 `ctx.llm.stream()` 直连调用方（compaction、会话标题、web search）。
- **仅失败发射**：拒绝——成功调用的 request id 与耗时没有其他出口，传输层失败甚至无 provider 事实可发；逐次调用是最小诚实面，量级由 §44 默认关的同意兜底。
- **构造时 owner 快照**：拒绝——bundle 行序无装载语义；发射点探查免费且无顺序耦合（device-trust 代的成文论据）。
- **携带 usage 汇总**：依裁定 2 拒绝——同一事实在两类下双重导出。

## Consequences

选择开启 provider 类的部署现在经 ops scope 把每次 provider 调用的一条元数据记录上报出进程，加载校验与会话类同等生效；base bundle 注释现在点名 relayMetadata 是仅存无生产者的类。频度由默认关的同意兜底：开启即部署方显式选择导出逐调用量。锁文件顺带把一条 importer 条目规范化到排序位（pnpm 重排、无依赖变化）。loader-composition e2e 既有基线红仍钉为开放通道。

## Open follow-ups

- relayMetadata 出口（阻塞于 §23）。
- loader-composition e2e 的 `DSH_TELEMETRY_CONSENT` 设置点（上文开放通道）。
- §56 构建修订标识注入接线。
