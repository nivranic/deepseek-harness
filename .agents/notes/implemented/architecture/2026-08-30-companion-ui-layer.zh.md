# Agent Note: CompanionUI —— SwiftUI 应用层

Status: implemented

[English](2026-08-30-companion-ui-layer.md) | 中文

## Problem

Phase 2 方案（E:\11585 方案，第 58–59、73 章）要求伴侣端的应用界面——基于 follow 流的会话 UI、审批/提问应答、Plan/Todo/Goal 面板——并按用户钉死的双视觉风格（Apple 上简约拟态 + 液态玻璃）实现，两风格共享同一语义令牌集，玻璃在不支持的系统或无障碍偏好下自动降级。Apple 核心已有线缆状态机，但应用壳还没有可渲染的东西；而本机没有编译车道，这层必须写成可脱离宿主测试。

## Decision

第二个 SwiftPM 库 target `CompanionUI`（iOS 17+/macOS 14+，SwiftUI 与 Observation 宏）让每个屏幕都只是两个 `@Observable` view model 的薄函数，view model 只依赖 `CompanionWireDriving` 协议——一次单次调用、一次流，形状与载体完全一致——真实适配器包装 `LinkClient`。`RemoteSessionViewModel` 以真实端点名跑会话切片（`session/list`、`session/follow` 的先快照后事件折叠与游标跟踪、queue 模式的 `session/prompt`、`session/cancel`），并在丢失后从最后游标重订阅 follow 流——与参考客户端一致，连流的干净结束也按丢失处理。`InteractionViewModel` 监听 `$events`，把审批/提问转发收进收件箱，以网关的精确 outcome 形状（`{kind:'result', value:'allowed-once'|'rejected'|'cancelled'}`）经 `$events/result` 应答，宿主拒绝（通常是独立审批开关关闭）以收件箱状态呈现而非丢卡片。主题是单一 `CompanionTheme` 令牌集：两风格读同名令牌，`resolve` 在系统不支持或开启减少透明度/增强对比度时把液态玻璃换成简约拟态，`CardSurface`/`CompanionButtonStyle` 是仅有的两个风格感知表面——任何组件都不按风格分支。Plan/Todo/Goal 面板在 `PlanTodoGoalSourcing` 协议后渲染，其生产源在会话事件契约模型存在之前保持为空，而不是猜测线缆形状。XCTest 以可编程假线缆覆盖 view model（投影、折叠、游标、prompt/cancel 参数、应答 outcome、拒绝保留）与五个降级规则用例。

## Consequences

伴侣端应用壳现在只是两个库之上的薄 Xcode 宿主，壳以下全部编写并测试完毕——但本机仍无法编译：与核心同样的 macOS 车道注意事项适用，而 view model 断言编码的线缆形状，TS 侧的 fixture 漂移门禁与载体级切片 e2e 已经证明。通用时间线投影展示记录/事件类型与提取文本；精细的逐事件渲染（以及 Plan/Todo/Goal 生产源）等待把会话事件词汇表扩进 `dsh-link-contracts`——那正是下一个契约增量的自然方向。

## Alternatives considered

把 view model 放进应用壳被否：壳必须薄，且这层必须能在任何车道上测试。在 Swift 里手写完整会话事件映射与填 plan 源被否的理由相同——猜测线缆形状正是契约流水线要防的事。按风格分叉组件（玻璃/拟态两棵视图树）违反用户"单一令牌集"的规则；降级完全活在 `resolve` 里。
