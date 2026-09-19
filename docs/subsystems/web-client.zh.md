# Web Client 架构

[English](web-client.md) | 中文

Web Client 是由独立加载插件组装而成的浏览器侧 Cordis 应用。它有四个可复用底座：[Client Modules](client-modules.zh.md) 加载插件图，[API Gateway](../api-gateway.zh.md) 提供类型化 Host 通信，[Slots](slots.zh.md) 组合 React UI，[Conversation](conversation.zh.md) 把 Session 历史窗口变成各 target 自有的视图。本文串联这些系统，并规定 Client model 与功能包各自所在的位置。

## 分层与所有权

| 层 | 主要 owner | 职责 |
|---|---|---|
| Host 应用 | 业务 service 与 `packages/api/*-controller` Host entry | 拥有权威状态、持久化、mutation 顺序、访问策略与 stream 生产。 |
| 传输与 API assembly | `client/connection`、`api/gateway`、`api/remotes` | 建立 Client generation，公开生成的 `ctx.remote` method 与 stream，转发选定的 Cordis event，并承载取消和结果。 |
| Client model | `api/session-controller/client`、`api/workspace-controller/client` | 维护不依赖 React 的 Host 状态镜像，处理 stream/unary 竞态，拥有对象 identity 与订阅，并公开收窄的 command service。 |
| UI adapter | `client/ui-session`、`client/ui-workspace` | 把 model observable 转换为 root 或 Session scope 的标准 Slot source，不接管业务状态所有权。 |
| Conversation 数据 | `client/ui-conversation`、`ui-chat` 与 `ui-trajectory` 等 target package | 把标准 event 与紧凑的 Assistant 历史批次组装成相互独立的 target snapshot，并拥有共享的 Conversation shell 与输入流程。 |
| 组合与渲染 | `client/ui-slots`、`client/ui-renderer`、`client/ui-layout`、各 UI 功能包 | 声明扩展位置、推导组件 props、把 observable 绑定成 React hook，并挂载最终组件树。 |

依赖方向是 Host 状态 → Remote 传输 → Client model → UI adapter → Conversation 或 presentation → Slots → React。用户操作通过 callback 反向进入注入的 Client service 或生成的 Remote namespace。Presentation component 绝不接收 Cordis `ctx`、transport object 或其他功能插件的实现。

## 浏览器启动

Host 把组合后的 `WebBootGraph` 写入 `window.__DSH_BOOT__`，并在 parser-preloaded script 执行前安装浏览器 module-loader facade。模块系统是一张 lazy CommonJS 表：加载 bundle 只注册 factory；materialize entry 时才以同步 `require` 运行 factory，并解析 platform module 和已声明的动态依赖。

Web boot kernel 创建模块系统、预取 `immediately` entry、挂载 vendored Cordis Loader，再创建图中的每个 entry。Cordis service injection 决定激活顺序；module graph 顺序只决定同步 import 能否被 materialize。完整 roster 到达 settled 状态后，`ui-renderer` hydrate 不依赖框架的 boot DOM，并调用唯一一次 context 级 `renderSlot('root')`。[Client Modules](client-modules.zh.md)负责 graph、bundle route、cache revision 与 loader 细节。

## Remote 通信

Host 业务 service 使用 Typert Remote decorator 标记可调用 method。Host generation 产出严格 descriptor、runtime codec、declaration merge 与 source map。Client 侧 `api-remotes` assembly 选择这些生成贡献，并把具体 method 挂到 `ctx.remote.<namespace>` 与 Session scope 的 `agentCtx.remote.<namespace>`。功能包依赖生成的 service face，而不依赖 Gateway 实现或 Host 包的运行时 entry。

Connection 拥有 request correlation、`/api` carrier、trust check、精确 Fetch 路由与 connection generation。API Gateway 拥有 Remote dispatch、取消、logical stream 与选定 Host event 的转发。Controller 操作应进入生成的 Remote method 或显式 Remote stream；功能自有的下载则注册精确 Fetch 路由。[API Gateway 参考](../api-gateway.zh.md)定义 generation 与调用，[Connection README](../../packages/client/connection/README.zh.md)定义物理 carrier 与信任策略。

内部 `$events` logical stream 是 Connection generation source。它的 opening `ready` frame 携带用于路径显示的 Host home，并在 Host listener 已挂载、任何 controller 开始 baseline read 之前建立 generation。`ctx.remote.$on()` 把 allowlist 内的普通 event 交付给 root Client Context，并把 scoped waterfall event 交付给已解析的 Session Context；waterfall listener 可以返回结果、调用 `next()` 或拒绝。

## Client models

每个 API controller 包都拥有配对的 Host face 与 Client face。Host 侧拥有权威 mutation 与 stream 生产；Client 侧基于相同的生成 wire type 维护 identity 稳定、与 React 无关的 model，并公开 observable snapshot 与 command。UI 包消费这些 Client service，不在 component store 中复制 transport state。

### Sessions

[`api/session-controller`](../../packages/api/session-controller/README.zh.md)公开 Session list、search、creation、selection data、prompt、queue、cancellation、pagination 及 follow/control stream 等 Host command。其 Client 侧按 `ClientSessions → SessionManager → Session` 组织：

- `ClientSessions` 提供 `ctx.sessions`，拥有 Session scope 与稳定的 `SessionBinding` object，并投影选中的 list state。
- `SessionManager` 拥有 list baseline、实时 list/control update、惰性 Session instance、queue、projection store、subagent catalog，以及 pull 与后到 update 之间的冲突顺序。
- 每个 `Session` 拥有一段由 `SessionEventLikeEntry` value 表示的连续逻辑 event window、pagination、follow、prompt/control state 与供 adapter 消费的 observable snapshot。

持久 event 路径打开 `follow()`，其首帧包含当前 header、tail page、cursor 与完整 projection baseline。历史 record 带有显式 `event` 或 `chunks` 判别字段和字段对齐的内部 `event`；journal 先校验每条 record 的逻辑 seq 闭区间，Client 再直接把这些 record 保留为 `SessionEventLikeEntry`，无需逐 record 转换。每个物理 generation 都根据该 snapshot 原子替换保留窗口，随后按 seq append 标准实时 event。`page()` 只用于更早历史与 gap repair。瞬态 control stream 每代以完整 baseline 开始，随后应用 queue、job 与 projection update。

### Workspaces

[`api/workspace-controller`](../../packages/api/workspace-controller/README.zh.md)把 Workspace mutation policy 与权威 follow feed 留在 Host。`ClientWorkspaceModel` 拥有浏览器侧 row、order、archived Session id、command echo，以及 stream/unary 竞态合并。每代 stream 先给出完整 baseline，再给出 `upsert`、`remove`、`order` 和 `archived` increment；重连时以新 baseline 替换 model。`WorkspaceController` 把该 model 作为 `ctx.workspaces` 公开，而 `ui-workspace` 向 UI 提供 `useWorkspaces` 与 navigation callback。

这种配对不会产生第二份业务真相。Host controller 决定持久状态与 mutation outcome；Client model 维护最新可用的本地 projection，在有利于渲染时保持 object identity，并明确 delayed response 与 replacement baseline 的合并规则。

## Conversation 与 presentation

`ui-session` 安装 `session` scope adapter，并提供 `useSessions`、`useSession`、`sessionId` 和 `useProjection`。领域 adapter 可以继续添加标准 source，但不会把 React hook 放进 model object。

`ui-conversation` 对每个 `SessionBinding.eventSource` 只绑定一次。它的 event registry 把持久 Session event 与 Client-only `assistant/live-chunk` update 关联成稳定的业务 Context，view registry 则 materialize target snapshot。Chat Assistant、Trajectory Assistant 与 Turn Tail 同时解释 live chunk 和持久 settlement 中嵌入的紧凑 stream，因此重连与分页历史无需持久 token 行即可复现相同 Assistant 状态。`ui-chat` 与 `ui-trajectory` 分别注册自己的 Definition 和 builder：它们可以解释同一 event family，但不会导入或共享彼此的最终 display model。Shell 选择一个已注册 view，再通过标准 hook 与 Slot 交付其 snapshot。[Conversation](conversation.zh.md)定义 Context identity、replay、Location data、target builder 与 keyed renderer。

`ui-slots` 提供类型化 registry 与 lifecycle ledger；`ui-renderer` 是唯一通过 `useSyncExternalStore` 绑定裸 observable、拥有 React context 并渲染 root tree 的包。功能 component 通过推导出的 props 接收 framework hook、owner prop、store action 与显式 injection。[Web Client Slots](slots.zh.md)列出这些输入、扩展 API 与当前 Slot 层级。

## 数据通路

| 路径 | 顺序 |
|---|---|
| 持久 Session 展示 | Host Session log → packed Remote `follow`/`page` 历史 → Client `SessionEventLikeEntry` window → Conversation Context → target snapshot（`chat`、`trajectory` 或其他已注册 target）→ Slot view → React |
| 瞬态 Session control | Host control baseline → Remote snapshot stream → `SessionManager` queue/job/projection store → Session 与 list snapshot → 标准 hook → component |
| Workspace 状态 | Host Workspace baseline 与 increment → `ClientWorkspaceModel` → `ctx.workspaces.list` → `useWorkspaces` → sidebar、hero 与 navigation entry |
| scoped interaction | Host Cordis waterfall → API Remotes `$events` → Session Context 上的 `ctx.remote.$on()` → 所属 UI 包 → result 或 `next()` |
| 用户 command | component callback → 注册项 inject face 或 Slot owner → `ctx.sessions`、`ctx.workspaces` 或生成的 scoped Remote → Host Controller → 权威 update → stream 或 event projection 回到 Client |

## 重连

物理恢复与逻辑恢复彼此独立。Gateway mux 恢复物理 WebSocket；Connection 发布可用 generation 后，每个 `RemoteStream` 分别重开自己的 logical source。Carrier failure 可以重试；business error、非法 opening item 或 protocol violation 会令所属 logical stream 终止。

Gateway 将需要人工处理的发现失败分类后，Connection 发布 `incompatible` 或 `fatal`。这两种状态暂停 generation 自动尝试并拒绝应用调用准入；Settings 提供本地化修正提示与手动重连。[发现失败决策](../../.agents/notes/implemented/bug-fix/2026-09-17-terminal-host-discovery.zh.md)定义分类范围。

HTTP 调用者在发送前捕获 Connection generation。401 仅使仍活动的该 generation 失效并发布 `auth-expired`；已取消调用者与过时代次不能撤销较新的连接。恢复使用既有浏览器令牌交换与显式重连，不自动重新提交被拒绝的 Prompt。

握手达到告警阈值或硬期限仍未收到 ready 帧时发布 `host-not-ready`，保留既有就绪取消与重试调度。这是观测到的就绪延迟，不是 Host 启动原因诊断，也不替代认证失败状态。

Connection 区分首次 `connecting`、后续 `reconnecting`、`offline` 暂停与已准入的 `ready` generation。初始应用准入可等待第一次握手；恢复状态在 ready generation 出现前拒绝新的业务操作。Settings 通过本地化文字或轨道紧凑控件投影这些事实。

source 的 `ConnectionGenerationProgress` 回调在首次及替换尝试验证 Host 访问权限期间报告 `authenticating`，复用 Connection 的代际取消与就绪期限。Gateway 在进度变化期间保留本次尝试是否允许初始等待的判断，因此重试认证不会把新业务操作排队。

恢复方式由数据语义决定：

- 持久 Session journal 校验逻辑 seq range，并根据每个 generation 的 opening snapshot 替换窗口；`page()` 提供更早历史并修复后续 range gap。
- Session control 与 Workspace stream 在断开期间保留最后一次发布的值，再用新的 opening baseline 原子替换。
- 普通 forwarded notification 不会 replay。需要可靠恢复的 stateful domain 必须提供 baseline、cursor 或显式 query；scoped waterfall 保留自身的 request lifetime。

架构中没有统一的 Client `Runtime`、`HostFrame`、`events.mux`、`events.host` 或通用 `resync()` API。Connection 公开 generation state，Gateway 管理 logical stream，Client model 则按自身数据定义 replacement 或 resume 语义。

## 包边界

功能插件包可以通过 `import type` 共享声明；不得运行时导入或转发另一个功能插件的值。跨包行为使用注入的 Cordis service，跨包 UI 使用 Slots。特定 target 的 Conversation Definition、projection helper 与最终 view data 留在所属 target 包中，即使 Chat 和 Trajectory 有意实现平行逻辑。

共享运行时值需要一个职责收窄、没有功能生命周期的静态 owner，例如 `client/store`、`ui-primitives` 或浏览器安全的 util 包。Transport 与生成 API assembly 可以导入运行时 contribution，因为组装同一个 protocol 正是它们的显式职责。功能包不能只为绕过此规则而添加 `dsh.client.external`。

根据所添加的扩展查阅四篇详细参考：

- [Client Modules](client-modules.zh.md)：package discovery、loading、共享 module identity 与 boot order。
- [API Gateway](../api-gateway.zh.md)：Host method、生成的 Remote contribution、stream 与 forwarded event。
- [Web Client Slots](slots.zh.md)：component、hook、store、injection 与 placement。
- [Conversation](conversation.zh.md)：持久 event correlation、target snapshot，以及 Chat 或 Trajectory view contribution。

## 原生交付操作

Web 交付所有者通过生成式 Remote 方法暴露 `ctx.presentedFiles`。`PresentedFileRequest` 使用当前查看的 `sessionId`，以及非负安全整数 `seq` 与 `index` 定位持久交付事件。Host 原生命令接受已验证的源路径后，`PresentedFileActionValue` 返回 `completed: true`。`PresentedHost` 包含服务端 `name`、配置决定的 `available` 状态，以及取值为 `finder`、`explorer`、`directory` 或 `null` 的 `fileManager`。API 能力存在不代表拥有原生操作权限或文件可用；[所有者](../../packages/client/ui-deliverables/README.zh.md#explicit-deliveries)定义操作生命周期与 Client 准入。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpresentedfiles--presentedfiles"></a>

### `ctx.presentedFiles` — `PresentedFiles`

Authenticated native actions for persisted file declarations; never activates an Agent.

```ts cordis-catalog
/**
 * Describe the serving desktop without opening a file or activating an Agent.
 * @param signal - caller cancellation.
 * @returns serving desktop metadata; API support does not grant native execution permission.
 */
@Remote('desktop') desktop(signal: AbortSignal): PresentedHost

/**
 * Open the current source file in its default native application.
 * @param request - persisted declaration coordinates in the viewed Session.
 * @param signal - caller cancellation; disposal also cancels and awaits native work.
 * @returns confirmation after the native command accepts the verified path.
 */
@Remote('open') open(request: PresentedFileRequest, signal: AbortSignal): Promise<PresentedFileActionValue>

/**
 * Reveal the current source in the Host file manager.
 * @param request - persisted declaration coordinates in the viewed Session.
 * @param signal - caller cancellation; disposal also cancels and awaits native work.
 * @returns confirmation after the native command accepts the verified path.
 */
@Remote('reveal') reveal(request: PresentedFileRequest, signal: AbortSignal): Promise<PresentedFileActionValue>
```

Source: [`packages/client/ui-deliverables/src/present-open.ts`](../../packages/client/ui-deliverables/src/present-open.ts)
<!-- END GENERATED cordis-surface -->
