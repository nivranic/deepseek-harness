---
description: "面向部署方与后端作者的会话遥测捕获 seam 说明，用于选择上报后端、挂载脱敏规则或实现后端约定。"
kind: "package-library"
---

# @deepseek-ai/dsh-session-telemetry

[English](README.md) | 中文

## 概述

`dsh-session-telemetry` 捕获可安全外发的会话诊断信息：它把 Session 事件转换为有界元数据，移除全部载荷与 workspace 路径，允许部署方进一步缩减记录，再交给上报后端。部署方只加载一个后端（随附的 OpenTelemetry 后端是 `dsh-session-telemetry-otel`），由它注册 `ctx.sessionTelemetry` 并组装捕获协调器。seam 拥有捕获、强制隐私投影、进一步脱敏与共享披露；批处理、重试、排队与丢失策略在 `emit()` 后归后端 SDK。每个已挂载后端都披露其部署级策略，使确认 surface 能够报告诊断信息是否以及如何被共享。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

作为部署方，应选择后端与模式；只有内置隐私投影还需进一步缩减时，才添加 `session-telemetry/record` 监听器。作为后端作者，应实现私有 sink 约定，并以一种捕获模式组装协调器。

### 选择并挂载后端

只加载一个后端插件；它把捕获协调器与自己的投递流水线注册为 `ctx.sessionTelemetry`，重复加载会抛出异常。已挂载后端通过必需的 [`sharing` 成员](#the-sharing-disclosure) 披露共享策略，`/feedback` 的确认文本会渲染它；只有在未挂载任何遥测服务时，消费方才渲染「未配置」。

### 后端约定

协调器接收带三个成员的私有 `SessionTelemetrySink`：`emit(record)` 是会话事件路径上的非阻塞入队；可选 `flush()` 是轮次结束的即发即忘提示；`shutdown()` 排空队列并达到完全停稳。`ctx.sessionTelemetry` 只暴露提供方无关的 `sharing` 披露，因此其他插件不能注入任意外发记录，也不能驱动提供方关闭。

### 捕获内容

捕获以两种模式之一运行。`live` 捕获跟随追加事件、在挂载时回放已存活会话并记录生命周期标记；`on-demand` 捕获通过 `captureSession(session, throughSeq?)` 读取权威日志前缀。ledger 记录保留事件时间、类型、序号、有界的枚举／数值诊断字段与固定错误类别；Session 内容、模型产生的工具名、系统提示词、工具参数／结果、任意错误名／代码／消息、反馈文本和 workspace 路径均不存在。协调器会通过匿名 identity owner 对 Session id 做假名化，之后才让任何扩展看到记录。每个 `(turn, step)` 只发出第一条 `assistant/chunk`，因此 `seq` 缺口是常态，绝不是丢失信号。

### 共享披露

<a id="the-sharing-disclosure"></a>

每个后端都通过 seam 的 `sharing` 词汇披露其部署级共享策略：`full`（每个事件在发生时立即交接）、`feedback-only`（在 `feedback/record` 事件释放其之前的未释放前缀之前，不交接任何内容）或 `disabled`（完全不交接任何内容）。已记录反馈条目的确认文本会报告该状态；披露从不声称投递——交接是非阻塞入队，批处理、重试与丢失策略仍归后端 SDK。

### 脱敏记录

<a id="the-redact-waterfall"></a>

每条外发记录在强制投影与 Session id 假名化之后经过 `session-telemetry/record` waterfall（瀑布式事件）。候选记录及其属性均已冻结。监听器通过变换 `next()` 来堆叠，但协调器只接受键和值都未改变的原始属性；新增、改写与别名复制均会丢弃。因此监听器只能删除字段或选择有效 severity，不能引入外发数据；抛出异常的监听器会以 fail-closed 方式拦下该记录。权威会话日志永不改写。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释捕获设计；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

seam 建立在一个边界之上：harness 的职责止于 `emit()`。捕获、投影、脱敏与 handoff 游标都在这里；批处理、重试、排队与丢失策略属于上报 SDK，本包有意不建模也不包装。设计与被否决的替代方案见[复活 Agent Note](../../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.zh.md)。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Service Definition：`SessionTelemetryBackend`/`SessionTelemetrySink` 约定、记录词汇、`session-telemetry/record` waterfall 声明 |
| [`src/coordinator.ts`](src/coordinator.ts) | 捕获：live 监听器、on-demand 回放、分片投影、脱敏、handoff 游标、异常隔离 |

### 捕获流程

live 捕获通过组合方 fiber 的 effect 注册：`session/created` 收养会话并从 handoff 游标起回放其日志；`session/event` 在构造时已解析身份的前提下投影隐私安全字段并以零 I/O 交接；`session/flush` 转发可选提示且不让循环等待；`session/disposed` 捕获会话的 `shutdown` 标记并退役它；`agent/error` 只转发固定错误类别。dispose 会为仍存活的会话捕获 shutdown 标记，再等待 sink 的 `shutdown()`。on-demand 捕获只注册 dispose effect，并在请求时读取权威日志。每个同步处理器都会隔离后端与策略失败。

### handoff 游标

一个模块作用域的 `WeakMap<Session, seq>` 按会话记录已交接（而非已投递）的最高 seq。live 捕获在追加时推进它；on-demand 捕获只在交接所请求的前缀时推进它。未捕获的前缀只留在权威日志中，因此协调器重载不会增加遥测自有的恢复状态；游标缺失时安全退化为从会话构造边界起重新交接，由接收端基于 `(session.id, event.seq)` 的去重吸收。这是对「注册即 effect」纪律的一次有意的、有文档说明的窄例外：条目随其会话消亡，值是单调水位线，丢失它绝不是错误。由此接受的代价与至多一次（at-most-once）投递一致：恢复的会话不会回填上一个进程未能投递的记录。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当 seam 约定不够用时阅读以下页面。它们从随附后端逐步进入子系统参考与决策证据。

- [OpenTelemetry 遥测后端](../session-telemetry-otel/README.zh.md)——部署方加载的随附后端，含模式与导出器配置。
- [会话遥测子系统](../../../docs/subsystems/session-telemetry.zh.md)——能力拆分与类型声明。
- [遥测隐私清单](../../../docs/subsystems/session-telemetry.zh.md#privacy-inventory)——每个由 DSH 控制的外发值与被排除的敏感类别。
- [会话遥测复活决策](../../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.zh.md)——理由、权衡与被否决的替代方案。
- [会话包映射](../README.zh.md)——相邻的持久化、投影、标题与遥测包。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该 seam 观察会话流并把脱敏后的副本交给外部；它不注册任何面向模型的内容。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义部署方能得到的投递与数据保护保证。它们是当前包约束。

- **尽力而为的投递**——游标标记的是已交接而非已投递；在重载窗口内被拆除的会话无法重新收养，崩溃时留在后端队列中的内容会丢失。持久化 outbox（spool、每 sink 游标、at-least-once）推迟到有部署方提出明确的崩溃丢失要求时再实现。
- **隐私投影刻意保持稀疏**——插件拥有的事件只暴露类型、序号、时间、严重级别与假名化 Session 关联；只有事件 owner 添加显式安全诊断字段后才会增加内容。
- **按需策略使用当前状态**——未捕获的事件只存在于权威会话日志中；后续的 `captureSession()` 会应用当前隐私投影与缩减监听器，不存在捕获时的遥测快照或持久化的捕获前 spool。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
