# Agent Note: Android 模型的可观察状态投影

Status: implemented

[English](2026-08-31-android-stateflow-projections.md) | 中文

## 问题

四个视图模型持有普通字段，Compose 标签只在重组触发点（切标签、重回页面）重读——线缆数据到达时从不更新；被关注的会话可能在无人注视时悄悄变化。

## 决策

每个被渲染的字段都成了由私有 `MutableStateFlow` 支撑的 `StateFlow`：会话模型上的 sessions/list-state/open-session/sending，交互模型的收件箱与 answering，文件模型的 workspaces/selection/directory/entries/list-state，子代理模型的 rows/child-timeline。变更经流进行（列表手术走 `update`），会话模型的 `state` 保持为 open 流值的派生便捷属性。六个标签以 `collectAsState` 收集、逐发射重组。FakeWire 测试改经 Turbine 断言发射序列：list-state 的 `idle → loading → ready` 迁移、被打开会话的每个折叠切片各成一项、收件箱的追加、去重无发射（`expectNoEvents`）与应答后的退役。

## 后果

线缆活数据一落地界面即重组，车道全绿（24 个测试加三个序列用例）。README 如实记录：后台感知收集的 `collectAsStateWithLifecycle` 仍开放；模型自身按设计无生命周期。一个测试教训：对 `StateFlow` 属性直接 `assertNull` 而不取 `.value`，比的是流对象本身——车道以"expected null but was StateFlowImpl"抓到它。

## 考虑过的替代方案

Compose 快照观察器的 `State` 被否决——模型是纯 JVM、无 Android 也可测；StateFlow 保持其无框架。直接暴露 MutableStateFlow 被否决——公开变更属于模型的方法，不属于订阅者。
