---
description: "Web §26 查看位置 Handoff：一个 Session-header 动作把连接中的 Host、Session 与最后一个 Turn 锚点复制为跨设备链接，以及对收到链接的一次性打开。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-view-handoff

[English](README.md) | 中文

## 概述

本包交付 §26 第一阶段 Handoff 的 Web 跨设备通道：一个 Session-header 动作把连接中的 Host、当前 Session 与最后一个 Turn 的持久锚点捕获为带前缀载荷（`ClientSessions.encodeViewLocation`），包装成页面 URL 的 `#dsh-view=…` fragment 并复制整条链接到剪贴板。在另一台设备打开该链接时，页面恰好读取 fragment 一次，并在该页 Host 准入之后校验载荷恰好指向当前连接的 Host，再选中会话并经轮次跳转加载器揭示锚点。只转移查看位置，绝不迁移运行时。

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

动作显示分享字形与本地化标签；点击编码载荷、构造 `origin + pathname + #dsh-view=<payload>` 并复制链接——按钮以「已复制」状态保持两秒。剪贴板拒绝时链接仍可经按钮 tooltip 与失败提示一同触达。打开收到的链接会立即消费 fragment（一次性：指向错误 Host 的失败不会在刷新时循环），等待 Host 准入后经 sessions 服务打开；指向别的 Host 的载荷在控制台大声失败，页面不发出任何请求。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

插件在 `conversation.session.header.actions` 注册一个 header 动作并注册双语 `view-handoff` 词典。页面生命期 controller（[`src/client/controller.ts`](src/client/controller.ts)）订阅 connection generation observable：descriptor 存在即 `encodeViewLocation` 自身要求的准入信号，以快照存储发布、动作经 inject `hooks` 通道读取。动作的锚点从标准 `useConversation` 共享派生——Chat 目标 timeline 最后一个 Turn 的 `start` seq，正是 `loadThrough` 揭示的那类 seq。接收端在 apply 时读取一次页面 fragment，并在首个准入 generation 之后解决；链接构造与 fragment 读取都经注入的 location/clipboard 接缝，测试无需浏览器即可驱动。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-api-session-controller](../../api/session-controller/README.zh.md) — §26 编解码（`encodeViewLocation` / `openViewLocation`）与轮次跳转加载器。
- [dsh-client-ui-chat](../ui-chat/README.zh.md) — 提供锚点的 Chat 目标。
- [dsh-api-remotes](../../api/remotes/README.zh.md) — 准入信号派生自的 connection generation。

-----

<a id="model-experience"></a>
## 模型体验

无。动作与接收端均为浏览器 chrome；这里没有任何东西进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **链接自身不携带传输。** 跨设备投递仍需人掌控的消息通道（聊天、邮件、QR 渲染）；载荷刻意做成对它们全部 URL 安全，QR 渲染保持为未来的外壳工作。
- **锚点是最后一个 Turn 的 start。** 没有完成过 Turn start 的会话没有值得交接的位置、不显示动作；不捕获流式中的部分状态。
- **准入等待无界。** 收到的链接在任何 Host 连接前打开会一直等待直到有 Host 连接（fragment 已消费）；用户弃置的页面只是永不打开。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作语境——点击展开</summary>

节层面的各项决定——锚点选择、一次性 fragment 消费、以及把编解码暴露给 feature 包的 `ISessions` 加宽——记录在 [view-handoff Agent Note](../../../.agents/notes/implemented/architecture/2026-10-03-view-handoff.zh.md)。

</details>

**运行时不变式：** 不发布伴生入口。插件注册一个词典 effect 和一个 header slot 条目；准入信号存储在控制器的快照存储中，不存在可能与之分歧的第二份副本，接收端的一次性守卫使已消费的 fragment 从构造上不可重复。
