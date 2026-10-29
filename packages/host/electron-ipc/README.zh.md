---
description: "浏览器表面的桌面载体：进程内特权协议 fetch 目标，应答共享 /api 链、Gateway Remote 流、客户端插件 bundle 与启动清单注入的前端 dist；不绑定套接字。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-electron-ipc

[English](README.md) | 中文

<a id="summary"></a>
## 概述

浏览器表面的桌面载体：一个函数插件，提供 `desktopGateway`——Electron 应用壳挂到其特权 `dsh:` 协议上的进程内 fetch 目标。本包不绑定套接字。`handle(request)` 按四分支分发：`/api` 走 Connection 共享通道链（请求来自本进程的渲染端、从不经过网络）；`/dsh-stream/<endpoint>` 以 NDJSON 帧承载一条 Gateway Remote 流；`/plugins` 供给客户端插件组合 bundle；其余路径供给前端 dist——越出 dist 根目录的遍历返回 403，未命中以 200 回退到 index.html（SPA 路由），且每个 index 响应都携带传输引导脚本。

## 目录

- [概述](#summary)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

传输引导作为第一条 index-injection 行注入，位于每一条启动清单行之前；它安装的页面临时载体钩子与 worker 壳拥有的接缝相同。

</details>

<a id="model-experience"></a>
## Model Experience

无：本包只服务渲染端资源并分发渲染端 fetch，任何内容都不进入模型请求。

#### KV Cache effect

无；本包既不组装也不发送提供方请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **前端 dist 必须已构建**——激活时 `require.resolve` 失败会带着构建提示大声报错；没有源码供给的回退。
- **流式响应依赖 Electron 的协议处理器**——NDJSON Remote 流主体经协议桥流式传输，不支持流式的载体会让事件流停滞。
