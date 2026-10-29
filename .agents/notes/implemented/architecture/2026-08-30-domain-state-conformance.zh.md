# Agent Note: 跨语言领域状态一致性

Status: implemented

[English](2026-08-30-domain-state-conformance.md) | 中文

## 问题

方案第 62 章要求黄金 fixture 证明的不止解码：同一批记录必须在 TypeScript、Swift、Kotlin 中折出同一领域状态。link 契约表钉住了 wire 类型，CompanionUI 折叠也渲染了它们，但没有任何东西把 Swift 折叠的行为绑定到 TypeScript 参考——两者可能在摘要文案、面板状态或轨迹配对上静默漂移，且 Swift 测试只回放手写的帧。

## 决策

`dsh-link-contracts` 增加了参考折叠与其场景。`foldCompanionDomain` 是把 follow 记录折入伴侣领域状态的纯 TypeScript 投影——带逐标签中文摘要的时间线行、计划模式布尔、整表待办、当前目标（清除墓碑后为空）、按 callId 配对且容忍孤儿结果的工具轨迹——每个已知标签的载荷都通过真实的 `SessionEventMap` 成员读取。三个黄金场景（`basic-turn`、`plan-todo-goal`、`tool-trajectory`）是由真实载荷类型构建的记录序列；`generateConformanceArtifacts` 把每个场景与参考折叠推导出的状态配对，gen/verify 流水线发射 `generated/conformance/<id>.json` 并为两个 Apple 测试包同步拷贝，走同一逐字节漂移门禁。Swift 侧，折叠从 `RemoteSessionViewModel` 移入纯 `CompanionSessionFold`，持有 `CompanionDomainState`（Codable，JSON 键与 TypeScript 形状一致）；视图模型把每个快照/直播帧委托给它，并从其状态投影面板与轨迹视图。`CompanionUITests` 增加一致性用例：解码每个同步场景、折叠其记录、断言与 fixture 的 expected 状态相等——第 62 章的检查，macOS 车道一存在即可运行。

## 后果

渲染变更（摘要字符串、配对规则、最后写入胜出语义）现在会失败两次：TypeScript 单测在场景上断言行为不变量，漂移门禁在 expected 状态重新生成前失败——随后 Swift 回放必须匹配新字节。折叠的语言耦合是刻意的：两份实现承载相同的中文串，fixture 正是让它们保持一致的东西。视图模型收缩为线缆编排加投影；`ToolCallRecord` 并入 `CompanionDomainState.ToolCall`，轨迹视图直接读取它。Swift 在本机仍是已编写未编译（既有的 macOS 车道告解）；一致性断言所依赖的 fixture 字节由漂移门禁证明与 TypeScript 结果一致。

## 考虑过的替代方案

把折叠本身作为生成 Swift 代码发射被否决——生成器发射数据契约，折叠是原生于一致性约束下拥有的行为，不是要转译的代码。各语言用自己的期望字面量做结构比较被否决——那正是共享 fixture 要防止的静默漂移。折叠保持在视图模型私有被否决——MainActor、线缆耦合的折叠没有假流就无法在测试中回放 fixture 字节，纯化拆分才使一致性用例成为简单的解码-折叠-比较。
