---
description: "dsh Web 客户端设置中的分品类遥测同意分区：五个独立开关（会话遥测、提供商元数据、中继元数据、设备信任元数据、崩溃诊断），无总开关，写入走 settings scope。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-telemetry

[English](README.md) | 中文

## 概述

**遥测**分区让 Web 用户按数据品类决定此宿主可以共享什么：会话遥测、提供商元数据、中继元数据、设备信任元数据与崩溃诊断各自拥有独立开关，默认关闭。刻意不提供任何总开关。该分区仅当宿主注册 telemetry-consent 设置命名空间时才出现，标明更改何时生效，写入走 settings scope 的版本围栏通道，并通过对宿主现值的重读来呈现未生效的写入。

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

仅当宿主设置文档暴露 `telemetry-consent` 命名空间（遥测后端在宿主侧的注册；字段契约见开发备注）时才会注册该分区。命名空间缺席——未组合遥测后端，或设置仅进程本地的非环回页面——该分区完全不渲染。

五个数据品类各占一行：品类名、一句描述该品类覆盖范围的文案、一个开关。拨动开关只排队写入该字段本身；其他一概不动，任何位置都不存在一次翻转多个品类的控件。开关位置只来自宿主的应答，从不来自点击：被宿主拒绝的写入（包括并发变更引发的版本冲突）会让开关停留在重读后的宿主现值上，并由该行说明更改未生效。

### 每个品类覆盖什么

- **会话遥测** — 镜像自会话日志的会话记录，按已配置的上报后端共享。
- **提供商元数据** — 每次请求使用的 LLM 提供商与模型。
- **中继元数据** — 请求在客户端与宿主之间的中继方式。
- **设备信任元数据** — 已配对设备的身份事实，例如设备名称与密钥指纹。
- **崩溃诊断** — 应用崩溃时产生的诊断记录。

### 更改何时生效

分区顶部有一行说明更改在应用重启后生效，跟随宿主为该命名空间注册的 `applies` 模式；注册为 live 的宿主不显示该行。

### 只读文档

设置提供方不接受写入时，所有开关禁用并以悬停文本说明原因；分区仍展示五个已存储的值。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现 internals — 点击展开</summary>

该分区是设置 describe 镜像加一个绑定 settings scope 之上的投影；它不持有同意状态。

### 注册

插件通过 `ctx.settingsScope` 绑定一个 `telemetry-consent` scope，并观察共享 describe 镜像。注册严格跟随镜像视图中是否存在该命名空间：命名空间缺席即无导航行；命名空间 `applies` 模式变化会重新注册分区，使提示行跟随宿主自己的声明。

### 读取与写入

值、版本与可写性来自绑定的 scope，它与注册门源自同一镜像快照，二者不可能不一致。写入走 `scope.set(kind, value)`：scope 以最新命名空间版本作围栏、串行化快速手势、把写入应答折回镜像，并在写入被拒时重读宿主状态——冲突正是这样以重读值而非错误字符串的形式呈现。

### 渲染

每一行对应一个 `TelemetryDataKind`。展示顺序表与字典键都派生自 `dsh-session-telemetry` 导入的同一联合类型，在那里新增或重命名品类会让本包构建失败，直到该行及其文案跟进。局部手势状态记录哪个品类的写入在途、哪一行的上次写入未生效；两者都在组件状态中并随分区重置。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

这些页面覆盖设置域、同意词汇与该分区所配置的遥测接缝。

- [ui-settings](../ui-settings/README.zh.md) — 提供 settings scope 并声明 `settings.section` 的域基座。
- [ui-settings-devices](../ui-settings-devices/README.zh.md) — 本包所参照的相邻分区模板。
- [settings](../../settings/settings/README.zh.md) — 本分区读取其命名空间视图的宿主侧设置接缝。
- [session-telemetry](../../session/session-telemetry/README.zh.md) — 拥有五品类同意词汇的 Service Definition。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器侧设置投影，不注册任何面向模型的内容。

#### KV Cache effect

无；该包既不组装也不发送提供商请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义同意界面的触达范围；它们是当前包的约束。

- **部署级同意在本分区之外** — 开关持久化到用户设置文档；某个部署是否实际外发某一品类是其遥测后端的组合决定，本分区既不探测也不描述它。
- **无逐品类生效状态解释** — 各行展示已存储的开关，不展示运行中后端当前实际导出内容的解析视图；实时执行状态属于后端接缝。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

跨车道契约：宿主遥测后端注册设置命名空间 `telemetry-consent`，恰好五个布尔字段，字段名严格取自 `TelemetryDataKind` 字面量（`sessionTelemetry`、`providerMetadata`、`relayMetadata`、`deviceTrustMetadata`、`crashDiagnostics`），默认全关，`applies: 'restart'`。本包按名读取该命名空间；因为客户端侧只做 type-only 引用，不存在共享常量模块。

手势刻意不传 `expectedRevision`：scope 的 `set` 以最新镜像版本作围栏并串行化排队写入，若把每次点击钉在其渲染时版本上，任意两次快速拨动都会变成虚假冲突。冲突路径以 scope 文档化的恢复重读呈现，各行的呈现方式是把已结算手势与重读值比较。

</details>

**运行时不变量：** 未发布伴随件。本包投影共享设置镜像的 `telemetry-consent` 命名空间并经 settings scope 写入，不维护独立持久化权威。
