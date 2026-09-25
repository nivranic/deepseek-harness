---
description: "dsh web 客户端 Web Settings 的已保存主机名册区：本地名册行 + 进入第 28 节接缝的切换动作、当前选择标记、回到本页 Host，以及跨会话的选择持久化。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-hosts

[English](README.md) | 中文

## 概述

**主机**区展示本页保存的 Host：显示名、平台、origin 与上次连接时间。同源书签可在页内选择并跨刷新持久化；其他 origin 通过独立主机页面访问，行内不提供切换。本页会话没有可路由 origin。

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

在 Settings 打开**主机**区。同源行的**切换**调用 `connection.selectSavedHost`；选中行显示「已选择」，**回到本页 Host**清除选择与持久化 id。**忘记**移除书签及其持久化选择，但不断开活动连接。跨源行只提供独立页面链接；若目标页要求授权，请使用该 Host 当前的启动链接。授权不会使当前页面获得跨源 API 权限。

-----

<a id="understand-the-implementation"></a>
## 理解实现

一个 React 区加其注册；全部数据为本地。功能包只导入 Connection 类型，选择、回本页 Host 与忘记均调用注入服务；Connection 拥有选择持久化。

- **注入面** —— 框架选择器钩子观察已保存名册与 `connection.target`。外部选择立即更新本区。切换使用 [`connection.selectSavedHost`](../connection/README.zh.md)；未知 id 不改变连接与持久化。
- **持久化** —— Connection 在载体启动前恢复同源选择，清除无法使用的持久化选择并保留书签；[Connection README](../connection/README.zh.md)拥有存储规则。

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

- 浏览器存储可能不可用或已满；当前选择仍可使用，但刷新可能丢失改动。
- 页内跨源连接不受本地 Web 载体支持。原生 Remote 必须通过独立 Connection Source 与 Device Trust 接入。
- 除「忘记」外无名册编辑；排序保持最近优先。

不发布运行时不变式伴生入口：本区展示 Connection 管理的名册与选择状态，不维护独立的 Host 投影。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

本区是第 28 节切换表面；接缝与载体采纳位于 `dsh-client-connection` 与 `dsh-api-gateway`，各有自己的记录。

</details>
