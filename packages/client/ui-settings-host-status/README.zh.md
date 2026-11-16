---
description: "dsh Web 客户端 Web 设置中的 §41 宿主就绪分区：宿主自行派生的「能否接受 Agent 请求」判定行，加上六个健康组件（进程、运行时、会话存储、插件状态、连接、模型提供方）各一行的状态行，数据来自 hostDiagnostics/health。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-host-status

[English](README.md) | 中文

## 概述

**宿主状态**分区向 Web 用户展示此宿主当前能否接受 Agent 请求以及原因：判定行承载宿主自行派生的就绪判定；§41 的六个健康组件——进程、运行时、会话存储、插件状态、连接、模型提供方——各占一行，显示该组件的 up/degraded/down 状态与命名所查事实的非敏感探针 detail。分区无条件注册（hostDiagnostics 是每个设置面宿主都组合的服务），并自持失败呈现：读取被拒时显示错误行加重试按钮，而不是让导航项消失。

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

打开 Web 设置并选择**宿主状态**。页面在进入时读取一次 `hostDiagnostics/health` 快照并自上而下渲染：先是判定行（`data-host-ready`），然后是六个组件行。每行包含组件名、状态点（up 绿、degraded 琥珀、down 红）与该组件自己的 `detail` 字符串原文——detail 命名被探测的服务或证明（例如 `pid 1234` 或 `no model provider is registered`），绝不携带配置值。

判定行是快照里宿主自行派生的 `ready` 字段；分区绝不在客户端重新推导就绪。连接组件被刻意排除在该推导之外：没有网络载体的宿主（CLI、桌面管道）是合法部署形态，因此「连接行 down + 判定 ready」并存是正确表现而非矛盾。

读取被拒时页面替换为错误行加重试按钮；重试重新发起读取，下一次成功快照后分区自动恢复。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 注册

插件注册一个 `settings.section` 贡献（`id: 'host-status'`、order 16，位于 Hosts 与 Telemetry 之间）。注册是无条件的：分区的数据面是 `ctx.remote.hostDiagnostics`——每个设置面宿主都组合的唯一 Remote 命名空间——因此没有能力可观察；无法应答 `health` 的宿主通过分区的错误态呈现，而不是撤走导航行。

### 数据面

注入面是一个函数 `health(): Promise<HealthSnapshot>`。注册侧适配器解包生成客户端的 `RemoteResult`：`ok: true` 解析为快照，`ok: false` 以远端失败拒绝，使组件的错误态在一处拥有全部拒绝形态（未配对、未通告、超时、wire 错误）。组件以请求计数器维护 `loading | ready | error` 视图状态供重试使用，与插件清单标签页同一模式。

### 渲染

显示列表 `HOST_STATUS_COMPONENTS` 与字典键集都派生自 `keyof HealthSnapshot` 去掉 `ready`，因此宿主侧新增或重命名组件会使本包构建失败，直到行与文案跟随。`ComponentHealth` 三态到 StateDot 的映射为 `up → done`、`degraded → warning`、`down → error`：`ongoing` 是保留给进行中过渡的动画运行环，而 §41 的 `degraded` 是已稳定的部分失败，琥珀色 `warning` 点才是最近的合法值。每行还携带 `data-component` 与 `data-component-state` 属性供测试使用。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

这些页面覆盖设置域、本分区渲染的 §41 词汇，以及它所依赖的 Remote 缝。

- [ui-settings](../ui-settings/README.zh.md)——声明本包注册进的 `settings.section` 槽的领域底座。
- [host-diagnostics](../../api/host-diagnostics/README.zh.md)——六组件词汇与派生就绪判定的宿主侧属主。
- [remotes](../../api/remotes/README.zh.md)——挂载 `hostDiagnostics` 命名空间的客户端 Remote 聚合。
- [ui-settings-telemetry](../ui-settings-telemetry/README.zh.md)——本包沿其注册模式的兄弟分区。

-----

<a id="model-experience"></a>
## 模型体验

无；本包是浏览器侧设置投影，不注册任何模型可见面。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义就绪呈现面的边界；它们是本包的当前约束。

- **无实时刷新**——分区在进入时读取一次快照，仅经重试按钮重读；它不订阅任何转发事件，因此页面打开期间宿主降级时保持显示上一次读取的快照，直到用户重试。
- **判定不在客户端重新推导**——各行显示各组件状态，但判定行是宿主自己的 `ready` 字段；刻意不从行数据客户端重推导就绪，使两者永不分歧。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

跨面契约：`hostDiagnostics` Remote 命名空间只经 `dsh-api-remotes` 聚合抵达客户端——聚合既 `$mount` 该贡献、又再导出其声明合并（`export type {} from '@deepseek-ai/dsh-api-host-diagnostics/remote'`），消费程序里 `ctx.remote.hostDiagnostics.health()` 能通过类型检查正依赖于此。生成客户端应答 `RemoteResult<HealthSnapshot>`；适配器的解包是该形态唯一被知悉之处。

</details>

**运行时不变量：** 不发布伴生。本包在每次页面进入时经注入的 Remote 面投影一次 `hostDiagnostics/health` 快照；不维护任何独立持久权威。
