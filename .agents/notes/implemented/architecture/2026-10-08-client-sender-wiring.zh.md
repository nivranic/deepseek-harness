# Agent Note: fork 与 command execute 发送方按意图铸造 clientMutationId

Status: implemented

[English](2026-10-08-client-sender-wiring.md) | 中文

## 问题

clientMutationId 采纳（前一增量）先行落地了 wire 字段与 Host 收据，纯服务端；没有客户端铸造该 id，生产流量无法使用重传结算。第 17 节语义需要客户端把一个 id 绑定到一个用户意图，并在该意图的重试间复用。

## 决策

两个客户端发送出口各持按意图的运行时记忆。`ui-commands` 的 `execute` 出口按提交铸造 id，同一草稿（同 line、逐项相同附件）重提交时复用；内容变化或已结算执行则清除或替换记忆——结算清除规则覆盖一切返回 `CommandExecution` 的结算（含 handler-error 结算），恰好是 Host 记录收据的那一类。`ClientSessions` 的 `fork` 出口以 `(sessionId, atSeq)` 键控记忆：失败的 fork 保留条目（同锚点重发复用 id）、成功即清除，且条目在 await 之前写入，并发同锚调用共享同一 id。使激进复用 id 成立的安全性质：Host 仅在成功结算上记录收据，因此确实失败的意图其 id 在 Host 全新执行，丢失响应的意图其重发返回首次结算。web 包经 `@deepseek-ai/dsh-util-crypto` 铸造 uuid——仓库 lint 在该处禁用 `crypto.randomUUID`，因为 plain-HTTP 局域网页面（非安全上下文）不提供它。

## 备选方案

无记忆的逐调用铸造会使目的落空——丢失响应后的用户重提交携带新 id，会铸出第二个子会话或第二次执行。命令侧在类型化 manager 层铸造被拒绝：提交意图（草稿内容）活在 composer 服务里，只有它能判定「同一草稿」。客户端耐久 id 存储未被采用——记忆是运行时状态，崩溃重启后的重提交按设计就是新意图。

## 后果

两条 §17 写通道获得端到端重传结算：客户端意图身份、wire 字段、Host 进程收据。生成的客户端投影无需再生成（请求接口直接沿前一增量拓宽的源类型流动）。Android 调用方不直接调用这两条通道（不存在 Kotlin execute 面），无原生镜像变更。

## 开放事项

耐久（重启存活）收据（需要新 SessionEventMap 词汇与完整 SDK 投影流程）仍是 §17 的开放设计裁定；多版本互通矩阵照旧开放。
