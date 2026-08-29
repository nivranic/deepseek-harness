---
description: "浏览器表面的桌面载体：进程内特权协议 fetch 目标，应答共享 /api 链、Gateway Remote 流、客户端插件 bundle 与启动清单注入的前端 dist；不绑定套接字。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-electron-ipc

[English](README.md) | 中文

<a id="summary"></a>
## 概述

浏览器桌面的桌面载体：一个函数插件（注入 `clientModules`、`connection`、`typertGateway`），提供 `desktopGateway`——Electron 应用壳挂到其特权 `dsh:` 协议上的进程内 fetch 目标，即 [webserver 文档](../webserver/README.zh.md)为桌面形态预留的 IPC 桥。本包不绑定任何套接字。`handle(request)` 按四分支分发：`/api` 走 Connection 共享通道链（Typert 网关把拦截器认领注册在 connection 服务本身，且不套用 HTTP 信任围栏——每个请求都来自本进程自己的渲染端、从不经过网络）；`/dsh-stream/<endpoint>` 经网关的 `wireStream` 适配器以换行分隔的 JSON 帧承载一条 Gateway Remote 流；`/plugins` 经模块注册表的 fetch 形态缓存供给客户端插件组合 bundle；其余路径供给构建后的前端 dist——越出 dist 根目录的遍历返回 403，任何未命中以 200 回退到 index.html（SPA 路由），未知扩展名按 octet-stream 发送，且每个 index 响应都在注入的启动清单之前先携带传输引导（一段纯内联脚本，安装 `window.__DSH_TRANSPORT__`，含 `ownsHost: true` 与 NDJSON 流 opener）。dist 位置是组装知识，经 `@deepseek-ai/dsh-web-frontend` 的 exports 解析，从不配置。

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
