# Agent Note：Lite 工具结果随下一请求回喂模型

Status: implemented

[English](2026-10-18-lite-tool-result-history.md) | 中文

## Problem

gen-62 落了首批真机执行器，但循环只闭环了一半：模型能发起 `calculator` 或 `artifact_create` 调用、驱动器真执行并折叠诚实的 `tool/result`——而下一请求只带 system 行和新 prompt。模型永远看不到自己工具的输出，后续每个回合都在盲答。durable journal 帮不上忙而且是有意的：chapter 64 的回合结局忠实规则把工具行完全挡在 journal 外，这也意味着重启即丢工具上下文（fold 是进程内存）。

## Decision

从活 fold 喂模型。`LiteProviding.stream` 增类型化 `history: List<LiteTurnRecord>` 参数（默认 `emptyList()`，与既有 `system = null` 对称——裸 provider 调用字节不变）；每条 `LiteTurnRecord` 是一个已完成回合——被接受的 prompt、回复文本（回合无回复时为 null）、该回合的工具调用、每个调用 id 的结果文本（失败原因与成功输出同样回喂）。驱动器在 `prompt/accepted` 与流调用之间快照 fold（此时 fold 最后一条会话行正是本回合 user 行、本回合尚无工具行，于是逐回合工具行游标——每个 accepted prompt 时 fold 的计数——把时间序列工具行在精确回合边界切开）。`LiteHTTPProvider` 把每条记录展开为宿主 provider 的 wire 线形（`llm-deepseek` serialize.ts）：user 行 verbatim；带调用的回合发 assistant 行携带 `tool_calls`（无文本回复 content 为 `""`），随后按调用序逐 id 一行 `{"role":"tool","tool_call_id",content}`，空结果文本落 `'(no output)'`；既无回复文本也无调用的回合只留 user 行，对齐宿主的空 assistant 投影规则。journal 记账零改动——chapter 64 原样。

## Alternatives considered

把工具行持久化进 journal 能让回喂跨重启存活，但 chapter 64 是 Behavior-Spec 决策（回合结局忠实），本次改动不重裁——留作已记录的后续项。回合内多步续跑（`finish_reason === "tool_calls"` 分支在 同一回合内再请求）推迟：需要 drive 循环重入与 Behavior-Spec 词汇扩展（一回合多条 assistant 消息），面比它顺带能解的跨回合缺口大。从 journal 而非 fold 导出历史因同样的 chapter-64 理由被否决——fold 已持有导出所需的配对行。

## Consequences

Lite 会话现在能跨回合使用真机工具：第二回合的请求原样携带第一回合的调用与结果，包括失败或被权限拒绝的调用（每个已发起的 tool_call id 都有应答行——OpenAI wire 的要求）。进程重启仍丢工具上下文——fold 是内存——这是 chapter 64 忠实的已记录代价。`role:"tool"`/`tool_call_id` 请求行是 Android 面首例，与宿主序列化器逐字段对齐。core JVM 测试：559 → 564。

## Open follow-ups

回合内多步续跑（finish_reason 分支+多消息回合的 Behavior-Spec 词汇）；工具行 journal 持久化作为 chapter-64 决策；真模型对携历史请求形状的接受度（keyless 测试对内嵌服务器钉 wire 形状；活 API 轮属 e2e 面）；配对宿主目录拉取通道与余下三执行器照 gen-62 台账保持开放。
