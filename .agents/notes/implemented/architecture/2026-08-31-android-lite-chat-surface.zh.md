# Agent Note: Android Lite 聊天面

Status: implemented

[English](2026-08-31-android-lite-chat-surface.md) | 中文

## 问题

Android 内嵌运行时阶段已备齐所有缝——折叠、注册表、驱动器、journal——却没有把它们组合起来的面：没有东西经循环把 prompt 提交进 journal，也没有东西渲染用户将看到的折叠状态。Apple 的 `LiteChatViewModel` 与 `LiteChatView` 是该阶段最后未镜像的两块。

## 决策

core 的 `LiteChat.kt` 镜像视图模型：`send()` 经循环提交 prompt 并 join 回合的 Job（`submit` 现在返回它），随后把回合的折叠可见结果事件记入 journal——`prompt/accepted`、带回合最终会话文本的 `message/completed`、以及 `handoff/requested`（同时置 `lastHandoff`）或 `turn/completed`——并经 store 持久化。原始增量不进 journal，与 Apple 记录的同一第 64 章保真规则。暴露的 `state` 在回合运行时是实时驱动折叠、其余时刻是 journal 重放。app 模块的 `LiteChatScreen.kt` 与 Apple 的视图一致地渲染 `LiteDomainState`：带 你/助手 标签与 已中断 标记的会话行、流式部分（或 正在思考…）、带状态词的工具行、工件引用、以及点名能力已在宿主继续的交接横幅。

## 后果

`LiteChatViewModelTest` 以替身 provider 与临时目录 store 钉住组合生命周期：提交-持久化-重启-恢复折回完全一致的会话；`run_tests` 回合浮出横幅状态（`lastHandoff` 与 `pendingHandoff` 都携带标记）；同一会话上的第二回合让 journal 与恢复重放一起增长。Android 车道验证全绿。内嵌宿主运行时阶段自此在 Android 上完全镜像——折叠、注册表、驱动器、持久化、聊天——每一块都被 Apple 回放的同一批 fixtures 或单测钉住。

## 考虑过的替代方案

把驱动的原始流事件记入 journal 被否决——驱动折叠是仅实时状态；回合结果事件才是持久真相，且第 64 章禁止过早保真。经折叠的 StateFlow 投影渲染被延后——今天的面随每次持久化回合重读；实时流式投影随真正的 HTTP 提供方一起到来，届时回合中渲染才有意义。
