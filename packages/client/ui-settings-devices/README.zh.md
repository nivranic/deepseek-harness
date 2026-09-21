---
description: "dsh Web 客户端设置中的已配对设备管理分区：带角色、平台与最近活跃事实的清单，行内重命名，需确认的撤销与全部撤销。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-devices

[English](README.md) | 中文

## 概述

**设备**分区让 Web 用户管理与宿主配对的设备。它列出每一条授权：显示名称、角色、客户端声明的平台、配对时间与最近准入时间，以及密钥指纹；已撤销的授权保持可见，标记为已撤销且不再提供操作。重命名在行内编辑名称；撤销单台设备或全部活跃授权都需要显式确认，完成的全部撤销会报告撤销的数量。失败按共享的 Remote 失败类别映射为本地化文案，未分类的错误码保留原始诊断。

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

仅当当前连接声明 `device.list.v1` 能力时才会注册该分区。连接替换会撤下分区、中止其读取并丢弃行状态（重命名草稿、打开的确认）；恢复时挂载新页面并懒读取当前宿主，前一页面的迟到响应或被保留的回调无法更新或触达替换后的宿主。

每个 Remote 回调都保留原始 `RemoteError`，包括此 Client 未知的错误码。行内与页面失败按 [`classifyRemoteFailure`](../../typert/protocol/README.zh.md) 选择的本地化文案呈现——例如 `device/admission-expired` 读作身份验证失败，`device/not-found` 读作目标授权已不存在——未分类的错误码回退为原始诊断文本。

### 管理单台设备

打开设置中的「设备」分区。每一行命名设备、标注角色；客户端声明了平台时展示平台标签，另有配对时间、最近准入时间（首次准入前显示「尚未准入」）和密钥指纹的前 16 个十六进制位。**重命名**打开行内编辑；空名称在本地拒绝，不会发起宿主调用，保存前会修剪名称再发送 `renameDevice`。**撤销**先要求行内确认；确认后的撤销立即停止该授权——其已打开的流由宿主侧终止——随后分区重新读取清单。

### 撤销全部设备

只要存在至少一条活跃授权就会显示**全部撤销**，并要求独立确认。完成的全部撤销会报告撤销的授权数量，刷新后的清单仍将过去的授权以已撤销状态保留。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现 internals — 点击展开</summary>

该分区是 device-trust Remote 命名空间上的投影；它不持有设备状态，插件激活期间也不读取 Remote。

### 注册

浏览器插件注册一个 id 为 `devices` 的本地化 `settings.section` 贡献（导航顺序 10，位于通用与插件之间）。注册使用 `ctx.slots.inject()`，因此跟随分区的延迟声明、重新声明、语言切换与卸载，而无需导入设置外壳。注册在 `connection.generation` 变化时重新注册，以 `device.list.v1` 能力为门，并换成新的组件标识，让 React 丢弃前一宿主的行状态。

### Remote 调用

四个操作都经由同一个受守卫的 `settle` 辅助函数：调用前与 await 后都检查连接代际，飞行中的代际变化（或其传输失败）表现为「connection changed」拒绝，永远不会触达替换后的宿主。`formatTime` 以语言服务的活跃 locale 用 `Intl.DateTimeFormat` 格式化 epoch-ms 值，时间戳随语言切换而变，不依赖组件重渲染契约。

### 渲染

行以设备 id 为键；角色标签使用固定色调（viewer 中性、collaborator 信息、controller 实心、owner 成功、已撤销 警告）。成功的行内变更触发一次清单重读；失败留在行内。页面持有全部撤销的确认、其报告数量，以及加载/失败/空/刷新状态。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

这些页面覆盖设置域、Remote 面与宿主侧信任接缝。

- [ui-settings](../ui-settings/README.zh.md) — 声明 `settings.section` 的域基座。
- [ui-settings-general](../ui-settings-general/README.zh.md) — 相邻的通用分区与设置外壳入口。
- [api-remotes](../../api/remotes/README.zh.md) — 挂载 `remote.deviceTrust` 的 Remote BFF 面。
- [api-device-trust](../../api/device-trust/README.zh.md) — 该分区所管理的宿主侧配对、准入与撤销接缝。
- [connection](../connection/README.zh.md) — 支撑分区撤下与恢复的代际契约。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器侧设置投影，不注册任何面向模型的内容。

#### KV Cache effect

无；该包既不组装也不发送提供商请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义设备视图的新鲜度与触达范围；它们是当前包的约束。

- **每次设置挂载或变更读取一份清单** — 分区不订阅授权变化，重连后也不自动重新拉取；在其他设备上执行的撤销只在手动刷新或本地变更后才会出现在这里。
- **配对签发不在范围内** — `issuePairing` 属于引导流程而非管理界面；增加配对入口是明确的后续工作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

无。

</details>

**运行时不变量：** 未发布伴随件。该包持有一个除显式撤销外均为只读的设置贡献。
