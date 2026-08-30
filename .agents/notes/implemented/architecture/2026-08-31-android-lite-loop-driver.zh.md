# Agent Note: Android Lite 循环驱动器

Status: implemented

[English](2026-08-31-android-lite-loop-driver.md) | 中文

## 问题

Android 内嵌运行时阶段有了折叠地基与工具注册表，却没有驱动回合的东西：没有模型提供方可供流经的缝、没有从流式工具调用到注册表的分发路径，也没有让折叠可观察的终态语义——取消、交接、传输失败。

## 决策

`LiteLoop.kt` 镜像 Apple 的 `LiteLoopDriver`。`LiteProviding` 缝按 prompt 流出一次响应的块（`Reasoning`/`Text`/`ToolCall`），`ScriptedLiteProvider` 是按 prompt 匹配的替身。驱动器在传入的 scope 里持有一个 Job：`submit` 折 `prompt/accepted`、把块流进实时折叠（`LiteFold` 类在面向 fixtures 的 `foldLiteDomain` 旁增加了增量 `apply` 面）、经注册表分发每个工具调用——交接名折 `handoff/requested` 并停在标记处不执行，未知名折入调用却绝不分发——随后以拼装文本折 `message/completed` 与 `turn/completed`。驱动器自身 Job 的取消折 `turn/cancelled`，定稿已交付前缀；抛出的失败按词汇分流：`LiteTransportError.Network` 折 `network/error`（折叠保留部分文本以供续传）、`Provider` 折 `provider/error`、其余折 `PROVIDER_FAILED`。

Kotlin 逼出一处对 Swift 镜像的偏离：只有 `Throwable` 子类可被 catch，因此 `LiteTransportError` 是基于 `RuntimeException` 的密封类而非裸枚举——词汇与相等性不变。

## 后果

`LiteLoopDriverTest` 经折叠后的 `LiteDomainState` 断言每条路径：顺利回合（reasoning + text 块拼装进助手行、流式重置、回合完成）、注册表分发（执行器收到精确的 id/name/arguments 且调用配对为 completed）、交接（`run_tests` 零执行、`pendingHandoff` 携带标记、无回合结束、调用保持 running）、未知名称（折入不分发、回合照常完成）、取消（停在流中的流把部分文本定稿为中断行、`running` 归位）、以及三种失败词汇与断流保留对提供方清空的对照。Android 车道验证全绿。剩余镜像步骤是持久化与聊天面。

## 考虑过的替代方案

每事件经 `foldLiteDomain` 重建全量状态被否决——实时驱动器需要的是同一累加器上的增量 `apply`，Swift 也早已暴露。从缝抛裸字符串被否决——传输分类是规范可观察词汇的一部分，类型化密封错误让测试能以数据相等钉住错误行。
