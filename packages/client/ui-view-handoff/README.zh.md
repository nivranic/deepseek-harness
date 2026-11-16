---
description: "Web §26 查看位置 Handoff：一个 Session-header 动作把连接中的 Host、Session 与最后一个 Turn 锚点复制为跨设备链接，以及对收到链接的一次性打开。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-view-handoff

[English](README.md) | 中文

## 概述

复制链接或扫描二维码，即可在另一台已认证的设备上继续查看 Session。链接标识 Host、Session 和最后已加载的 Turn 起点。接收页面核验 Host 后在 Chat 中定位该轮。链接不携带凭据、不授予访问权限，也不迁移运行中的 agent。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Web 组合中挂载本插件（[`dsh-web-app`](../../bundle/web-app/README.zh.md) bundle 已携带）；该行无配置。当 Host generation 已准入且 Chat timeline 持有至少一个 Turn 锚点时，Session header 长出分享动作。

### 预期行为

点击动作会复制不含查询参数的页面链接，并打开锚定二维码对话框。Escape 关闭对话框并把焦点归还触发器，点击外部也会关闭。剪贴板拒绝时，链接保留在按钮提示中。接收页面只消费一次 fragment，然后等待已认证 Host 发现。无效链接、不同 Host、连接不可用及位置不可访问均显示本地化提示。不同 Host 会在任何 Session 导航前被拒绝。连接代际变化或插件卸载会取消待处理导航。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

[控制器](src/client/controller.ts) 为每个连接代际通过 `host.describe()` 发现身份，并忽略迟到回执。插件拥有 v1 载荷编解码。接收流程在加载历史期间持有 Session，在 Chat timeline 中核验目标 Turn 起点，并在工作区导航接管持有关系前提交一次性 Conversation 焦点请求。Conversation 渲染器创建共享展示 store；挂载前到达的请求等待在对应的精确 Session binding 上。根层浮动提示在目标 Session 无法打开时仍能报告失败。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-api-session-controller](../../api/session-controller/README.zh.md) — 有作用域的 Session 持有与历史加载。
- [dsh-client-ui-chat](../ui-chat/README.zh.md) — 提供锚点的 Chat 目标。
- [dsh-api-remotes](../../api/remotes/README.zh.md) — 已认证 Host 发现。

-----

<a id="model-experience"></a>
## 模型体验

无。动作与接收端均为浏览器 chrome；这里没有任何东西进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **链接自身不携带传输。** 跨设备投递仍需人掌控的通道；弹层 QR 覆盖相机扫描路径，粘贴进聊天或邮件同样有效——载荷刻意做成对它们全部 URL 安全。
- **锚点是最后一个 Turn 的 start。** 没有完成过 Turn start 的会话没有值得交接的位置、不显示动作；不捕获流式中的部分状态。
- **准入等待无界。** 收到的链接在任何 Host 连接前打开会一直等待直到有 Host 连接（fragment 已消费）；用户弃置的页面只是永不打开。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作语境——点击展开</summary>

[view-handoff Agent Note](../../../.agents/notes/implemented/architecture/2026-10-03-view-handoff.zh.md) 记录原始投递设计。当前编解码与接收生命周期归本插件所有。

</details>

**运行时不变式：** 发现和导航随所属连接代际失效。链接内容从不授予 Host 或 Session 访问权限。
