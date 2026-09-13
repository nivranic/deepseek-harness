# Agent Note: 原生 Link 离线恢复验收

Status: implemented

[English](2026-09-03-native-link-offline-recovery-acceptance.md) | 中文

## 问题

重开一条空闲的原生 Link stream 能证明 replacement generation 与身份行为，却不能证明 Session 仍在前进时的恢复。客户端可能重连到较新的快照，同时静默丢失事件、保留重复的 projection 行，或接受与 Host 权威 Session cut 不一致的快照。

## 决策

共享的 13 步原生 Link corpus 保留一个 reconnect 步骤，并把 streaming loss 预期放在其 `recovery` 下。每个 driver 启动一个确定性的 `slow_success` turn，记录第一条 live `assistant/chunk`，关闭生产 `session/follow` 与 `$events` carrier stream，并阻止其自动 retry 在 Host 完成模型请求前打开。释放测试专用 retry gate 后，每种 stream 必须各产生一代 replacement。在 Host cut 保持不变时再次中断，每种 stream 必须再产生一代 replacement，且 companion projection 不得改变。

通过认证的 loopback control listener 先要求 driver 关闭两条 stream 后 mock provider 仍保持 active，之后只有在 `slow_success` 变为 `completed`，且 Host Session 包含一条更晚的 completed terminal event 后，才报告恢复就绪。它验证 raw journal 的 sequence number 连续且唯一、离线 suffix 非空、replacement opening cursor 等于 Host 最终 cursor、`session/page` 为同一 cut 返回相同 records 与 `hasMore`，并验证这个有界场景为 `hasMore: false`。它用 `foldCompanionDomain(snapshot.records)` 推导预期 companion state。

Swift、Kotlin 与 TypeScript reference 报告 repeated reconnect 前后的两份 projection、各自观察到的 cursor、离线 sequence 数量与精确 replacement 数量。只有当两份已报告 projection 都等于 Host 独立推导的状态，且全部已报告 sequence 事实都等于 Host 观测时，Host 才接受 candidate。生产 follow request 仍只包含 durable Session address 与其 history bound；恢复复用既有权威快照与 `session/page`，不增加 resume cursor 或第二个 Session authority。

## 考虑过的替代方案

**为 `session/follow` 增加客户端所有的 resume cursor。** 否决，因为每代 follow 已先打开完整权威快照，再只发送其 cursor 之后的事件。第二套 resume vocabulary 会复制 Session owner 的恢复语义。

**信任原生端的 `projectionEqual` 布尔值。** 否决，因为被测客户端可能在两次 folding 或 comparison 中重复同一个错误。Host 从自己的快照推导预期状态，并比较完整的已报告值。

**要求每个 raw Session sequence 都对应一条 snapshot record。** 否决，因为 history 可以无损打包连续 assistant chunk，或替换更早的 presentation node。raw journal 连续性证明 durable sequence coverage；snapshot/page 相等与 canonical fold 证明客户端可见状态。

**把重连前模型已完成视为充分的离线证据。** 否决，因为立即自动 retry 可能 live 观察到 turn 的大部分内容。acceptance observer 在切断 active stream 前 arm retry gate，且只在 Host 记录 terminal event 后释放它。

## 后果

恢复车道保持确定性且无密钥，但比空闲重连覆盖更多 lifecycle state：stream cancellation 必须到达真实 URLSession 或 OkHttp call，retry 必须等待且不能泄漏 generation，teardown 必须释放任何已 arm 的 gate。完整窗口断言刻意把本 corpus 限制在 follow history 上限以内；长历史 pagination 仍由既有 `session/page` 负责。TypeScript reference run 验证 Host mechanism，只有所属 Apple 与 Android workflow 能提供跨语言运行时证据。

## 相关

[真实 Host 原生 Link 验收](2026-09-02-real-host-native-link-acceptance.zh.md)拥有共享 carrier harness 与 publication 规则。[Session 快照 projection](2026-08-18-session-snapshot-envelope-projection.zh.md)拥有 opening snapshot 的 projection watermark。
