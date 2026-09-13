---
description: "面向部署方的 OpenTelemetry 会话遥测后端说明，用于选择模式、配置导出器或排查哪些数据离开本机。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-telemetry-otel

[English](README.md) | 中文

## 概述

`dsh-session-telemetry-otel` 通过 OpenTelemetry 日志投递隐私安全诊断信息，是部署方为[会话遥测 seam](../session-telemetry/README.zh.md) 加载的唯一条目。其 `mode` 决定记录是跟随实时流、仅在记录反馈时释放，还是留在本地：`FULL` 把每条记录立即交给 OTel，`FEEDBACK_ONLY` 在 `feedback/record` 落地时回放权威日志前缀，`DISABLED` 不构造捕获或上报流水线，也不共享任何内容。上传模式原样组合 OTel JS SDK 并把每条记录映射到 `logger.emit()`，因此批处理、重试、排队与丢失策略都遵循 SDK。owner 级投影会在本后端看到记录之前排除 Session 载荷与 workspace 路径。

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

当部署方需要通过 OpenTelemetry 日志导出隐私安全的 Session 诊断信息时挂载此插件。显式选择上传模式并提供导出端点；省略模式时数据留在本地。

### 模式

| `mode` | 行为 |
|---|---|
| `FULL` | 每条已投影记录都立即交给 OTel SDK，包括生命周期运维记录 |
| `FEEDBACK_ONLY` | 每个 `feedback/record` 都会回放权威会话日志中截至该事件的后缀，并进行投影与脱敏；后续记录等待下一个反馈事件；如果没有后续反馈，则留在本地 |
| `DISABLED` | 默认值。不构造协调器、提供方、处理器或导出器；没有遥测记录会离开进程，`feedback/record` 会记录「不会共享任何内容」 |

程序化 TypeScript 配置使用导出的 `SessionTelemetryMode` 枚举；原始字符串字面量不可赋值。已挂载服务通过 seam 的 [`SessionTelemetrySharingStatus`](../session-telemetry/README.zh.md#the-sharing-disclosure) `sharing` 属性披露解析后的模式（`full` / `feedback-only` / `disabled`），因此 `/feedback` 的确认文本可以报告会话是否以及如何被共享——即使 `DISABLED` 也会披露 `disabled`。

### 最小配置

上传模式需要导出器 URL，并原样接受 SDK 选项块：

```yaml
- id: sessionTelemetry-otel
  name: '@deepseek-ai/dsh-session-telemetry-otel'
  config:
    mode: FULL                # explicit opt-in; default: DISABLED
    shutdownTimeoutMillis: 3000 # optional; defaults to 3000
    exporter:                # passed verbatim to the SDK's OTLP/HTTP log exporter
      url: https://collector.example.com/v1/logs
      headers:
        authorization: !!js `Bearer ${process.env.OTLP_TOKEN}`
    processor: {}            # optional; passed verbatim to BatchLogRecordProcessor
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `mode` | `DISABLED` | 共享策略：`FULL`、`FEEDBACK_ONLY` 或 `DISABLED` |
| `exporter.url` | 上传模式必填 | 完整 OTLP 日志端点；必须能解析为 `http(s)` |
| `exporter`、`processor` | — | 原样传给 SDK 导出器与批处理器 |
| `shutdownTimeoutMillis` | `3,000` | SDK 完整关闭序列的外层截止时间 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-session-telemetry-otel)是每个受支持字段的穷尽式真源。上传授权采用显式许可且为 fail-closed：随附 base 与直接构造都默认 `DISABLED`，未知模式会在读取传输配置前失败，`FEEDBACK_ONLY` 只响应权威日志中已存储的精确 `feedback/record` 对象。`ctx.sessionTelemetry` 没有公开 emit 或 shutdown 操作。

### 哪些数据会离开本机

上传模式发送事件时间／类型／序号、严重级别、有界的轮次／步骤／结果字段、工具错误状态、固定错误类别与生命周期操作。Resource 发送产品名／版本、`os.type`、`host.arch` 与派生的 harness home 匿名 `user.id`。匿名 identity owner 会在脱敏 waterfall 或本后端看到记录前，把原始 Session 与父 Session id 转换为稳定的 HMAC-SHA-256 假名；其私有根种子与 Session 密钥绝不会离开该包。每条 SDK 记录都使用 `ROOT_CONTEXT`，因此环境中的活动 span 无法添加 trace 或 span 关联。日志 body 不携带值或内容，但 OTLP JSON 编码器仍可能序列化一个空的 `body: {}` 对象。消息内容、推理、系统提示词／工具 schema、模型产生的工具名、工具参数／结果、反馈文本、任意错误名／代码／消息、workspace 路径、源代码、文件内容、trace id、span id 与 trace flags 均不会到达导出器。权威[隐私清单](../../../docs/subsystems/session-telemetry.zh.md#privacy-inventory)涵盖 DSH 控制的内容值、Resource 与记录 attributes，以及静态插桩作用域元数据。

### 失败与关闭

配置错误会在插件加载时失败：缺少或非 `http(s)` 的 `exporter.url`、非正整数的 `processor.maxExportBatchSize`（SDK 会接受该值，随后却在关闭时挂起）以及无效的 `shutdownTimeoutMillis` 都会在任何记录导出前被拒绝。关闭期间，OTel 会先等待 `exporter.forceFlush()`，再等待处理器有界完成 promise；如果该传输 promise 始终不结算，本包会在 `shutdownTimeoutMillis` 到期时放弃等待、记录已隔离的失败，并让应用继续拆卸——届时仍待处理的记录可能在进程退出时丢失。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释后端的组合方式；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

后端是对 OTel JS SDK 的薄适配层：它拥有捕获模式、派生 Resource 身份的发布与外层关闭截止时间。匿名 identity 包拥有私有根种子与 Session id 假名化；捕获协调器交给本后端的标识符已经假名化。静态的 `@deepseek-ai/dsh-session-telemetry-otel` 与 `@deepseek-ai/dsh-session-telemetry-otel/ops` 插桩作用域分别承载 ledger 与运维记录；两者都携带包清单版本。Resource 身份携带 `service.name`／`service.version`、`os.type`、`host.arch` 与派生的匿名 `user.id`；它们按导出批次携带一次，而非逐条记录。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：模式解析、fail-closed 校验、SDK 流水线接线、协调器组装、关闭截止时间 |

### 捕获接线

`FULL` 以 `live` 模式组装协调器；`FEEDBACK_ONLY` 以 `on-demand` 模式组装协调器，并且只对权威日志中精确的反馈记录触发 `captureSession(session, event.seq)`；`DISABLED` 只注册本地反馈警告。协调器接收私有 sink，而 `ctx.sessionTelemetry` 只暴露 `sharing`。后端刻意不实现 `flush()`，因为常规 flush 由批处理器负责。

### 字段映射

每条 seam 记录映射为一条 body 不携带值或内容的 SDK 日志记录：`time` 与 `severity` 变为 SDK 字段，已经假名化的隐私安全 attributes 原样携带，显式 `ROOT_CONTEXT` 会阻止隐式继承 trace context。OTLP JSON 编码器可能用空对象表示这种缺省。在 `FULL` 中，接收端可通过缺少 `shutdown` 记录检测崩溃；在 `FEEDBACK_ONLY` 中，已释放前缀通常没有后续标记，因此缺少标记不是崩溃信号。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当后端约定不够用时阅读以下页面。它们从它所实现的 seam 逐步进入子系统参考与它所上报的身份。

- [会话遥测 seam](../session-telemetry/README.zh.md)——捕获约定、记录词汇与脱敏 waterfall。
- [会话遥测子系统](../../../docs/subsystems/session-telemetry.zh.md)——能力拆分与类型声明。
- [匿名用户身份](../../identity/anonymous-user-id/README.zh.md)——作为 OTel Resource `user.id` 上报的 id。
- [生成配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-session-telemetry-otel)——每个受支持配置字段及其源声明。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该后端把 seam 记录转发进 OTel SDK 流水线，不注册任何面向模型的内容。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明 SDK 行为在何处起主导作用、导出保证止于何处。它们是当前包约束。

- **上游实验性源码树**——`@opentelemetry/sdk-logs` 从上游实验性源码树发布；SDK API 的变动只会落在本包，也仅落在本包，而 seam 约定不动。
- **真实 collector 行为属于 SDK 导出器**——身份验证、TLS、限流及其他真实 OTLP 部署行为遵循上游 SDK，不由本包自有兼容层处理。
- **反馈时快照**——`FEEDBACK_ONLY` 在反馈前不保留遥测自有副本；记录反馈时读取并脱敏当前的权威日志，因此反馈前崩溃时什么都不上传，反馈前的策略变更会影响该次回放的导出内容。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
