# Agent Note：第 26 节 Web 查看位置交接的生成端与接收端

状态：已实现

[English](2026-10-03-view-handoff.md) | 中文

## 问题

查看位置链接必须标识持久 Session 位置，同时不携带凭据或迁移 Agent。接收浏览器必须先核验已认证 Host，再查找目标 Session。

## 决策

- `@deepseek-ai/dsh-client-ui-view-handoff` 拥有私有 v1 编解码、捕获动作、二维码投递及一次性 fragment 接收。页头动作使用 `conversation.session.header.actions`。
- 锚点取 Chat 时间线最后轮次的 `turn/start` seq——与接收端轮次跳转加载器揭示的目标同源（`loadThrough` 契约原文即 "a turn's `turn/start` seq"），复制的正是将被揭示的位置。
- 链接使用当前页的 `origin + pathname + '#dsh-view=' + payload`，不含查询凭据；接收者独立认证。
- 两端使用当前连接代际的已认证 `host.describe()` 发现。不同 Host 在 Session 导航前被拒绝。代际替换或卸载中止待处理打开，迟到发现回执不能恢复准入。接收失败通过本地化根层提示报告。
- Session Controller 拥有持有期间的历史，Conversation 拥有 View 选择与焦点请求，Workspace 拥有可见 Session 引用。交接插件组合这些服务，不向 `ISessions` 添加编解码方法。

## 备选方案

- **分享/推送传输通道：**被第 26 节自身排除——移动的是位置，runtime 永不迁移；传输属未来 Relay 工作。
- **在 `ui-conversation` 内实现：**捕获动作与 fragment 接收独立于会话骨架演进；座位模式让 header 的所有者继续掌管布局，与 `ui-open-in-app` 完全一致。
- **`hashchange` 监听：**无轮询但与插件晚装载竞态；apply 时的一次性读取以一条代码路径同时覆盖启动与刷新。

## 影响

- 收到的 fragment 只消费一次。历史不可访问或 Turn 锚点缺失时，保留当前对话并报告失败。
- 展示请求保留在精确的 Session binding 上，直到注册的渲染器创建 store。释放 binding 会丢弃未消费请求。

## 开放工作

- 物理设备验收，以及自行管理 `location.hash` 的 SPA 路由下的 fragment 路由仍未验证。
