# Agent Note: Android Lite 聊天实时投影

Status: implemented

[English](2026-08-31-android-lite-live-projection.md) | 中文

## 问题

聊天面按持久化回合渲染：回合流式进行时 UI 停在上一个快照，因为驱动重读的只有 journal 大小。聊天面当时记录的延后条件——"待提供方真正喂给 UI"——已随真实 HTTP 提供方落地而到期。

## 决策

`LiteLoopDriver` 增加逐事件投影回调：它折叠的每个生命周期事件现在把切面状态送进 `onEventApplied`（一个包装器路由 `drive` 的全部应用点，任何事件都无法绕过投影）。`LiteChatViewModel` 把该回调喂进 `MutableSharedFlow<LiteDomainState>`（重放一份给晚订阅者、缓冲六十四让每个中间切面都存活——StateFlow 会把逐事件流式合并成只剩最新），并在每次持久化后发布 journal 重放；旧的 `state` 属性改读同一重放缓存，因此这个面的两个视图永不分歧。`LiteChatScreen` 以 `collectAsStateWithLifecycle`（初值取自重放缓存）收集 `liveState`，彻底丢弃 journal-size 重读；停止态暂停收集而非渲染陈旧快照。

## 后果

一个非受限收集器测试逐切面钉住脚本回合的发射序列（初始空 journal；用户行；两段增长的部分文本；工具行先折 running 再 completed 且部分文本保留；助手行落地流式重置；回合结束移动；最后是 journal 重放——按第 64 章保真规则不带工具行）。Android 车道验证全绿；既有的发送/恢复/交接测试对着流背书属性原样通过。

## 考虑过的替代方案

由 UI 轮询折叠被否决——折叠是无观察者的朴素状态，轮询会重新引入本增量要消除的陈旧性。按块而非按事件投影被否决——事件切面是一致性钉住的单元；块是提供方的私有词汇。
