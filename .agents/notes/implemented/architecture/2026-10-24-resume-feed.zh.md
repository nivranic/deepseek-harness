# Agent Note: 重启的会话把重放的工具行喂进下一请求——chapter 64 的读面

Status: implemented

[English](2026-10-24-resume-feed.md) | 中文

- Date: 2026-10-24
- Class: architecture
- Scope: `apps/android/core`（`LiteLoop.kt`、`LiteChat.kt`）、`apps/android/core` 测试（`LiteChatViewModelTest.kt`）

## Problem

A 半让 journal 携带回合工具行、重启把它们重放进渲染面——但请求历史仍只骑活 fold：驱动器每个进程从空起步，重启的会话在屏幕上显示先前的工具调用、下一请求却不携带任何历史。工具行虽已在磁盘上存活，模型跨重启仍丢失自己的工具输出。

## Decision

在读面上闭环（B 半）：`LiteLoopDriver.seed(events)` 在任何活回合之前把存储 journal 重放进驱动器——每条事件经同一 fold apply、每个重放的 `prompt/accepted` 取与 `drive` 相同的边界快照（`turnRoundStarts` 与 `roundToolBoundaries`），于是导出的请求历史在精确回合边界重建重放回合及其工具行。`LiteChatViewModel` 构造在 journal 非空时以存储会话的事件播种驱动器；运行中的回合拒绝播种（`check(!running)`），冷开照旧空。缝就是驱动器本身：零新导出路径、零 journal 形态变更——写面的事件经唯一 fold 与唯一历史导出器重放，重启会话的下一请求逐字携带先前来回（含 calculator 调用与结果文本）。

## 备选方案（已否决）

- 请求时从 journal 导出历史绕过 fold：同一事件上的第二导出器会在任一方变化时与活导出器漂移——一个 fold 上的一个导出器才是值得保持的不变量。
- 经构造参数列播种：播种是有序重放不是配置；与 `submit`/`cancel` 并列命名的 `seed(events)` 方法比第四个构造参更好地陈述生命周期（任何回合之前播种）。
- 只重放工具行进边界而不重放会话事件：历史导出器从会话行读回合——部分播种会腐蚀它本要服务的回合切分。

## Consequences

- 新测试钉住完整闭环：回合一经真求值器执行 calculator 调用（结果 `9`）并持久化；同一 store 上重启的 view model 给第二请求喂恰一个先前来回的历史、其单轮携带 calculator 调用与结果文本——模型跨重启看到自己的工具输出。`:core:test` 增至 85 套件 / 613 测试（+1）。
- 播种经 `onEventApplied` apply 事件，构造把重放 cut 发进 live-state 流——与重放已发布的同态同序；收集者看不到新形态。
- debug APK 漂移（`69e9f027 → ac58c38b`，core 主源集变更）；androidTest APK 逐字节复现 `e0d3214b`。
