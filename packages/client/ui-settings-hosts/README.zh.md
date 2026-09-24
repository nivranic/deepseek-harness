---
description: "dsh web 客户端 Web Settings 的已保存主机名册区：本地名册行 + 进入第 28 节接缝的切换动作、当前选择标记、回到本页 Host，以及跨会话的选择持久化。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-hosts

[English](README.md) | 中文

## 概述

**主机**区展示本页到达过的每个 Host，数据直接来自本地已保存主机名册：显示名、平台、origin 与上次连接时间。一次点击即经第 28 节接缝把连接切换到所选 Host——单次调用与流载体同时重定向——且切换跨页面刷新持久；随时可回到本页 Host 清除选择。选中行带当前标记并隐藏其切换动作；本页会话行没有可定向的 origin，因此不提供切换。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

该区始终可用：名册是本地页面状态，注册不需要任何 Host 能力，连接替换后行数据保持完整。

### 切换 Host

在 Settings 打开**主机**区。每行给出 Host 名称、平台标签（如有）、origin 与上次连接时间。某行的**切换**经 `switchToSavedHost` 路由——行 origin 流入 `connection.retarget`，hostId 持久化在 `dsh-selected-host.v1`，下次刷新在任何循环运行前应用该选择。被切换的行获得「当前」标记并失去切换动作；**回到本页 Host** 同时清除选择与持久化 id。**忘记**移除一行名册；连接不会再定向到被忘记的 Host。

-----

<a id="understand-the-implementation"></a>
## 理解实现

一个 React 区加其注册；全部数据为本地。

- **注入面** —— `HostsSettingsSectionInjected` 暴露活读取器（`rows`、`selectedOrigin`）而非一次取回的快照：本区在名册通知、自身动作与刷新控件上重渲染。切换组合共享的 [`switchToSavedHost`](../connection/README.zh.md) 编排，仅在成功时写持久化；未知 id 绝不触碰连接与存储。
- **持久化** —— 选择经 `browserSelectedHostPersistence` 落在 `dsh-selected-host.v1`；Connection 插件在任何载体或循环存在之前的启动期应用持久化 id，因此应用是纯赋值。行缺失或 in-process 时保持本页 Host。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`dsh-client-connection`](../connection/README.zh.md) 拥有名册、retarget 接缝与持久化选择的启动应用。
- [Gateway 流载体](../../api/gateway/README.zh.md)以同一选择构建每次物理 WebSocket URL。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器侧 Host 名册投影，不注册任何面向模型的内容。

#### KV Cache effect

无；该包既不组装也不发送提供商请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 选择读取器是轮询而非观察：本区之外的切换要等下一次名册通知或刷新才可见，不是立即。
- 跨源 Host 在调用成功前还需要自己的浏览器信任配对；切换只重定向载体。
- 除「忘记」外无名册编辑；排序保持最近优先。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

本区是第 28 节切换表面；接缝与载体采纳位于 `dsh-client-connection` 与 `dsh-api-gateway`，各有自己的记录。

</details>
