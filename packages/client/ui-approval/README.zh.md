---
description: "通过作用域交互路径响应 Host 权限请求的浏览器批准界面。"
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-approval

[English](README.md) | 中文

## 概述

基于 Agent-scoped Remote Event waterfall 的浏览器审批界面。插件通过 `ctx.uiSession` 发布每个待处理请求、接管 Conversation composer、按需渲染关联的 Tool 详情，并将用户决定返回给等待中的 Host 请求。当浏览器必须为等待中的 Host 操作收集批准时，请使用它。

决定区旁边，面板列出 §38 各项事实——操作、Host（来自连接的 host facts）、工作区、风险档、权限提升原因，以及位于关联 Tool 详情之上的命令预览标题。值缺失的行会被隐藏；风险行只在询问方给出档位时出现。

## 目录

- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只在浏览器中呈现审批请求，不注册任何面向模型的内容。

#### KV Cache 影响

无；审批请求和响应的呈现不会改变模型请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **面板只提供临时决定**——它支持仅本次允许和拒绝；持久权限策略仍由 Host 侧审批包拥有。
- **事实行跟随询问方的数据**——Host 与工作区从客户端状态解析，连接握手或工作区列表未就绪时可保持隐藏；面板绝不编造占位值。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。Remote listener 与临时 Slot entry 由各自注册表持有并观察。
