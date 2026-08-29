---
description: "dsh 桌面表面：与 web 表面共享同一代理、工具与安全默认值的 Electron 应用窗口，由进程内特权协议桥承载。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-desktop-app

[English](README.md) | 中文

## 概述

桌面表面 bundle：dsh 的 Electron 应用窗口，支持与代理交互对话、模型与设置管理以及会话历史，背后是与其他表面相同的模型访问、工具与安全默认值。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-base`](../base/README.zh.md) 之上：设置编码 persona，插入桌面宿主行（workspace、投影缓存、storage、[`electron-ipc`](../../host/electron-ipc/README.zh.md) 载体）以及 Web 表面的浏览器插件花名册外加一行桌面专属行（[ui-desktop](../../client/ui-desktop/README.zh.md)，关闭按钮偏好），并挂载本包的 `desktop-runtime` 粘合插件（配置 `{surfaceContext}`）。该表面与 [`dsh-web-app`](../web-app/README.zh.md) 的差异恰恰在载体：不绑定 webserver 行、不解析 `webStartup` 旗标，Connection 行以空信任清单保持挂载，提供其注册表服务与浏览器半。electron-ipc 行提供 `desktopGateway`，由 Electron 应用壳（`apps/desktop`）挂到其特权协议上；自适应目录选择器通过 `bindHost` 声明其回环绑定事实，因为没有可读的服务器绑定。本表面没有 URL 行、shell 变量或 HTTP 席位。

## 目录

- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计概念

该 bundle 是一层补丁而非代码：它插入的每一行都是既有包的组合，本包唯一的代码是 `desktop-runtime` 粘合插件。桌面载体以共享 `/api` 链、`/dsh-stream` 上的 Gateway Remote 流、客户端插件组合 bundle，以及传输引导加启动清单注入的 dist 应答渲染端的特权协议 fetch；Typert 网关行来自 base 层，经 connection 服务的共享 fetch 处理器分发。

### 组合映射

| 关注点 | 行 |
|---|---|
| 载体（不绑定套接字） | `electron-ipc` → [`dsh-host-electron-ipc`](../../host/electron-ipc/README.zh.md) |
| 浏览器传输 | `connection` → [`dsh-client-connection`](../../client/connection/README.zh.md)，`trustedHosts: []` |
| 无服务器时的回环姿态 | `directory-picker` → [`dsh-host-directory-picker-auto`](../../host/directory-picker-auto/README.zh.md)，`bindHost: 127.0.0.1` |
| 桌面偏好 | `ui-desktop` → [`dsh-client-ui-desktop`](../../client/ui-desktop/README.zh.md) |
| 粘合插件 | `desktop-runtime` → 本包，配置 `{surfaceContext}` |

</details>

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

桌面 exe 由 `apps/desktop` 经 `scripts/build-desktop-release.ts` 构建；窗口标题按设计跟随活跃会话。

</details>

<a id="model-experience"></a>
## Model Experience

### Harness-source 与桌面表面上下文

#### What the model sees

`surfaceContext` 为 true 时，`harness:source` 段落指明磁盘上的 Harness 实现而不声称它是工作目录；`app:desktop-surface` 全局段落（order −98）为模型定向桌面窗口："this page" 的指代、没有隐式 DOM／路由／截图上下文、无 URL 约定（窗口在进程内加载构建后的前端，没有 HTTP 服务器供给它），以及未经要求不要启动 `dsh web` 服务器的指示。为 false 时两个段落都不注册。

#### Token effect

每个会话一行来源说明加一段提示词；进程内恒定。

#### KV Cache effect

提示词段落位于系统提示词头部附近，且在进程生命周期内稳定，不会在轮次间使缓存失效。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **前端 dist 必须已构建**——载体的 `require.resolve` 在激活时失败会带着构建提示大声报错；没有源码供给的回退。
