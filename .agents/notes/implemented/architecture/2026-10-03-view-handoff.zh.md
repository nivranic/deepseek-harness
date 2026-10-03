# Agent Note：第 26 节 Web 查看位置交接的生成端与接收端

状态：已实现

[English](2026-10-03-view-handoff.md) | 中文

## 问题

第 26 节已交付编解码两端——sessions 面上的 `ClientSessions.encodeViewLocation` / `openViewLocation`，Android 已消费、Swift 契约已镜像——但 Web 自身没有捕获入口：在桌面 Web 会话页阅读的用户无法把查看位置交给另一台设备，收到交接链接的 Web 页面也不对其做任何事。台账以「跨设备真实 QR/链接投放通道属外壳工作」把这一缺口记在案。

## 决策

- 新包 `@deepseek-ai/dsh-client-ui-view-handoff`（沿用 `ui-open-in-app` 配方：由 web-app profile 装载的 client bundle）。生成端以一个安静的分享动作占用 `conversation.session.header.actions` 座位（order 20）；接收端从插件 `apply` 启动。
- 锚点取 Chat 时间线最后轮次的 `turn/start` seq——与接收端轮次跳转加载器揭示的目标同源（`loadThrough` 契约原文即 "a turn's `turn/start` seq"），复制的正是将被揭示的位置。
- 链接形态为当前页 `origin + pathname + '#dsh-view=' + payload`：URL fragment 从不随请求发给服务器，这正是「只承载查看位置、不承载传输」的最小真实通道。QR 渲染仍属外壳工作。
- 两端都以 `encodeViewLocation` 要求的同一准入信号门控（当前 generation 携带 Host descriptor）：动作在准入前或无轮次锚点时保持隐藏；接收端 `waitForAdmission` 推迟打开，payload 永不可能触达错误的 Host。收到的 fragment 读后即消费（立即清空）——刷新或重试不会循环；打开失败大声上报、绝不重试。剪贴板拒绝时降级为动作 `title` 呈现链接本体。
- `ISessions` 加宽这两个动词——接口自述文档将其定义为 "the explicit act of widening what features may do to the sessions domain"，feature 包消费 `ctx.sessions` 正是这一显式行为。`TestSessions` 经真实编解码器实现两者（单一固定测试 Host）；`FixtureSession.loadThrough` 的 fail-loud stub 现在报出被要求到达的 seq。

## 备选方案

- **分享/推送传输通道：**被第 26 节自身排除——移动的是位置，runtime 永不迁移；传输属未来 Relay 工作。
- **在 `ui-conversation` 内实现：**捕获动作与 fragment 接收独立于会话骨架演进；座位模式让 header 的所有者继续掌管布局，与 `ui-open-in-app` 完全一致。
- **`hashchange` 监听：**无轮询但与插件晚装载竞态；apply 时的一次性读取以一条代码路径同时覆盖启动与刷新。

## 影响

- header actions 座位迎来第四个占用者；四个邻域套件（skeleton、header-overflow、两条 host-switch 车道）不经改动保持全绿。
- `ISessions` 加宽在编译期波及每个实现者——`TestSessions` 与 conversation-registry 内联 fixture 现在对这两个动词大声失败，使测试替身与面保持诚实。

## 开放工作

- QR 渲染、真实跨设备投放通道与物理设备验收仍属外壳/各节工作；自行管理 `location.hash` 的 SPA 路由器下的 fragment 路由未经测试。
