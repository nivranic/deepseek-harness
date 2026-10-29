# Agent Note: CompanionUI 工具轨迹

Status: implemented

[English](2026-08-30-companion-tool-trajectory.md) | 中文

## 问题

Phase 2 的模块清单（方案第 50 章）把工具列为主模块，会话事件词汇表增量也刚落地了解码后的 `tool/call`/`tool/result` 载荷——但时间线对每个事件只有一行摘要，没有配对展示模型调了什么、发了什么参数、返回了什么的视图。

## 决策

`RemoteSessionViewModel` 现在从与时间线、面板状态相同的 follow 记录里折叠工具轨迹：`tool/call` 以线缆 `callId` 为键追加一条运行中的 `ToolCallRecord`（名称、原始参数 JSON、定序的开场 seq），`tool/result` 按结果块的 `toolCallId` 匹配并关闭对应记录——按失败标识的有无判定已完成或失败，并携带嵌套的结果文本。未匹配的结果按无操作容忍，重开会话时轨迹与面板状态一同重置。`ToolsView` 把轨迹渲染为第四个标签页（名称与阶段标题、等宽参数、结果文本、失败标红），直接读取 `@Observable` 模型使记录随结果到达实时闭合。没有改动任何线缆面：全部经由 fixture 漂移门禁已钉住的生成模型 `LinkToolCallData`/`LinkToolResultData` 解码。

## 后果

伴侣端以零新增契约面呈现方案 Trajectory 模块要求的执行叙事，view model 测试覆盖配对（成功、失败、孤儿结果、重开重置），全部喂真实信封形状。Swift 在本机仍是已编写未编译（既有的 macOS 车道告解）；断言所依赖的 fixture 字节由漂移门禁证明与 TypeScript 钉住的一致。

## 考虑过的替代方案

从时间线条目（字符串摘要）推导轨迹被否决——配对记录需要结构化载荷，且每次渲染重复解码会复制折叠逻辑。独立的轨迹 view model 被否决：记录来自会话模型已拥有的同一条 follow 流，第二个订阅者只会为同样的事件加倍线缆流量。
