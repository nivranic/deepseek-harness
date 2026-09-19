---
description: "Host 与 Client 工作区控制：修改工作区导航并跟随其完整投影。"
kind: "package-reference"
---
# Workspace Controller

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-workspace-controller` 拥有 Host 的 `ctx.workspaceController` 服务和生成的 Client `ctx.remote.workspace` namespace。它的 Remote 方法负责创建、重命名、移除和重排 Workspace，在 Workspace 内重排 Session，从 Workspace 导航中归档 Session，以及跟随完整的 Workspace 投影。当 Client 必须修改或跟随 Workspace 导航时，请通过 API 网关使用它。本包同时拥有 `ctx.directoryPickerController` 与生成的 `ctx.remote.directoryPicker` namespace，因为它承载的选目录 seam 是抽象的，自身从不作为 Loader entry。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Host 控制器会串行执行正确性取决于当前注册表状态的变更，并为预期失败抛出带有稳定 `workspace/*` 或 `directory-picker/*` 错误码的 `RemoteError`。它的 `follow()` 流会同步订阅持久 Workspace 变更，先发出一份完整 baseline，再按顺序发出 `upsert`、`remove`、`order` 和 `archived` 增量。重连会以替换 baseline 开始新一代，因此消费方不依赖收到断线期间的每个增量。

纯 `/capabilities` 入口声明独立的 `workspace.follow.v1`、`workspace.manage.v1` 和 `workspace.sessions.v1` 操作集。Host 通过 Typert 绑定公布这些能力，应用在派发前要求对应操作集。Session 管理能力不能授权 Workspace 注册表或归档操作。

Directory Picker 使用同一纯声明入口定义 `directory-picker.native.v1`、`directory-picker.browse.v1` 和 `directory-picker.create.v1`。原生后端只声明原生选择；浏览后端分别声明列目录和创建能力。未知扩展种类不声明这些操作。后端能力在 Service 生命周期内稳定，因此替换后端会随控制器重建声明。文件系统访问仍由 Host 在调用时检查。

目录创建在调用文件系统能力前，以 `gateway/bad-request` 和[可移植验证诊断](../../typert/protocol/README.zh.md)拒绝无效输入。

Client 入口提供 `ClientWorkspaceModel` 和 `createWorkspaceStateStream()`。模型负责行、注册表顺序、归档 id，以及流与一元调用的竞态处理。同一连接内，较新的行按 `updatedAt` 获胜，已提交的流顺序优先于较旧的一元回显，延迟数据不能复活已移除的 id。Host 快照替换会清除这些投影及删除、排序依据；迟到的一元结果返回 `gateway/cancelled`，不会修改新投影。这不会撤销已经派发的 Host 变更。

能力发现尚未完成时，模型保持加载状态；明确缺少跟随能力时，模型进入 `unavailable`，且不打开跟随流。Gateway 负责等待与恢复；能力恢复后打开新基线，不另行触发领域重启。快照与订阅不依赖框架，UI 负责导航和 React 钩子。

-----

<a id="model-experience"></a>
## 模型体验

无，因为 Workspace 组织属于浏览器和 Host 的控制状态，并且不注册提示词、工具或会话事件。

#### KV Cache 影响

无直接影响；Workspace 变更不会改变模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- `follow()` 在重连后替换完整投影，不提供持久 cursor 或增量追赶协议。
- 进程内删除标记仅保护当前 Host 快照的生命周期。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。Workspace 注册表负责持久化，每次流生成都是完整投影。
