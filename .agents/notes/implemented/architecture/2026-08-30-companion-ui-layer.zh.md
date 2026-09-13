# Agent Note: CompanionUI —— SwiftUI 应用层

Status: implemented

[English](2026-08-30-companion-ui-layer.md) | 中文

## Problem

Phase 2 方案（E:\11585 方案，第 58–59、73 章）要求伴侣端的应用界面——基于 follow 流的会话 UI、审批/提问应答、Plan/Todo/Goal 面板——并按用户钉死的双视觉风格（Apple 上简约拟态 + 液态玻璃）实现，两风格共享同一语义令牌集，玻璃在不支持的系统或无障碍偏好下自动降级。Apple 核心已有线缆状态机，但应用壳还没有可渲染的东西；而本机没有编译车道，这层必须写成可脱离宿主测试。

## Decision

第二个 SwiftPM 库 target `CompanionUI`（iOS 17+/macOS 14+，SwiftUI 与 Observation 宏）让每个屏幕都只是 `@Observable` view model 的薄函数，view model 只依赖 `CompanionWireDriving`——一次 unary call 与一条和 carrier 精确同形的 stream——真实适配器包装 `LinkClient`。`RemoteSessionViewModel` 拥有单一 follow task。打开或 reconnect 会取消并等待前一 task，分配新 generation 身份，并禁止已退役 generation 发布；非预期失败与正常结束都会先 backoff，再从权威快照重开，stop 取消 backoff 时不会新建 generation。同一模型驱动生成的会话事件折叠，为 timeline、plan、todo、goal、tools、attachments、artifacts 与 subagent address 供数据。`InteractionViewModel` 拥有单一 `$events` task：重复 start 保持幂等，restart 取消并等待前一 task，每代只从 Host `ready.clientId` 取得应答身份，断流后经 backoff 自动重开。它把审批/提问转发收进收件箱，以 Gateway 的生成式 outcome 字段经 `$events/result` 应答，并把 Host 拒绝保留为收件箱状态，而非丢卡片。主题仍是单一 `CompanionTheme` 令牌集：两风格读同名令牌，`resolve` 在系统不支持或开启减少透明度/增强对比度时把液态玻璃换成简约拟态，组件不按风格分支。XCTest 覆盖 replacement 顺序、stale-generation suppression、自动 retry、backoff 期取消、生成的会话折叠、prompt/cancel 与 interaction 参数、拒绝保留与降级规则。

## Consequences

伴侣端应用壳仍是两个库之上的薄 Xcode 宿主。单 task ownership 让 stream replacement 可等待，也防止已取消 task 与当前 generation 竞争。真实 Host 验收中断 active follow 与 `$events` generation，并要求这些生产 retry loop 各发布恰好一代 replacement；生成 fixture 与 fake-wire 测试不能替代该平台结果。没有 Swift/Xcode 的 Windows 宿主把原生编译与执行记为 `NOT_EXECUTED`，Apple 车道拥有这些结果。

## Alternatives considered

把 view model 放进应用壳被否：壳必须薄，且这层必须能在任何已有车道上测试。在 Swift 里手写 Session-event map 被否，因为猜测 wire field 正是生成 contract pipeline 要防的事。只取消并覆盖 task reference、却不等待前一 task 被否，因为旧 stream 可能在 replacement 后发布，或在 stop 后仍存活。按风格分叉组件（玻璃/拟态两棵视图树）违反单一令牌集规则；降级活在 `resolve` 里。
