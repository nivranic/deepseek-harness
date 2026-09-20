---
description: "带类型的 Client 到 Host 调用与流：分派、校验、取消、重连与转发的 Host 事件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-gateway

[English](README.md) | 中文

## 概述

为 Host 与 Client 两侧的 Cordis 环境提供 Typert RPC endpoint。Host 入口提供 `ctx.typertGateway`，`@deepseek-ai/dsh-api-gateway/client` 则提供 `ctx.remote`；两者使用同一份生成的 `InvocationDescriptor` 约定，并将业务选择交给 API Remotes。Connection 承载一元调用的请求关联、信任和响应 envelope，Gateway 则拥有多路复用的 Remote 流。

## 目录

- [Host 服务：`TypertGatewayService`（ctx key：`typertGateway`）](#host-service-typertgatewayservice-ctx-key-typertgateway)
- [Client 服务：`ClientRemote`（ctx key：`remote`）](#client-service-clientremote-ctx-key-remote)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

超时库保持 peer 依赖：`deadline` 创建的 `TimeoutReason` 由 `timeoutOf` 按类身份识别。原生及 Client 请求生命周期继续由各自所有者管理。

-----

<a id="host-service-typertgatewayservice-ctx-key-typertgateway"></a>
## Host 服务：`TypertGatewayService`（ctx key：`typertGateway`）

每次调用时，`ctx.typertGateway.invoke()` 都会解析当前的描述符和 Cordis 服务，校验具名参数是否完全匹配，解析已注册的对象或 Context 身份标识，调用公开的业务方法，并校验其结果。业务服务继承 [`dsh-typert-protocol`](../../typert/protocol/README.zh.md) 的 `TypertRemoteService`，并用 `@Remote` 或 `@RemoteScope` 标记方法；已有其他基类时仍可改用 `bindTypertRemote()`。

`capabilities()` 从活跃 Remote 绑定读取显式版本声明。所有必需方法都必须保持可用；严格定义撤回会抑制该能力，直到重新注册。重复 id 与指向未导出方法的声明会失败。排序后的结果描述支持的操作，不代表调用方权限或特定请求资源已就绪。[Host 发现](../host-description/README.zh.md)通过现有 Remote 载体暴露这些事实。

严格模式从 `ctx.typert.local` 读取生成的调用描述符。查找参数使用 `ctx.typert.lookups` 中当前有效的解析器：业务包注册稳定声明与默认策略，Host 组合可用 effect-scoped `configure()` 覆盖解析行为；`@RemoteScope` 则通过已注册的 Host Context 适配器解析其接收者。SRC 模式是开发阶段的回退路径，适用于从未具备严格定义的端点；它解析简单参数名，并且只允许非查找参数使用可安全表示为 JSON 的值。已观测到的严格定义一旦撤回，系统会直接报错，而不会降低校验强度。

Connection 可用时，Host 入口会在 Connection 共享的 `/api` FetchHandler 上注册 trusted-host interceptor。Connection 把这个复合 handler 交给 HTTP bridge；handler 将已认领 endpoint 分发给 Gateway，未认领且没有精确 Fetch 路由负责的请求返回 404。直接调用 `invoke()` 会保留业务错误；`TypertGatewayError` 是 `RemoteError` 的子类，其 `gateway/*` 码命名了分发、绑定、提供方、查找、Context、参数和编解码器各自负责的故障。因策略而拒绝的解析器——冷恢复失败或 ownership fence——抛出自己的 `RemoteError`，它选定的码原样到达调用方。

支持取消的 Remote 方法会把 `signal: AbortSignal` 声明为最后一个 Host 参数。signal 是 descriptor 元数据，而不是 wire 参数：Connection 将它提供给 Gateway，Gateway 则在已解码的业务参数之后注入它。SRC 识别这个保留的末位参数名，严格生成还要求它具有全局 `AbortSignal` 类型。

流式 Remote 使用 `@Remote({ mode: 'stream' })` 并返回 `Iterable` 或 `AsyncIterable`。`ctx.typertGateway.stream()` 执行与一元调用相同的 endpoint、参数、lookup 和取消校验，再用生成的 result codec 校验每个产出项。Client 插件激活时打开 Gateway 自有的 `/api/remote.mux` WebSocket，并让它在空闲时保持连接。Connection 拥有重试调度；每次 retry 前，它要求 mux 取消候选或活动 socket，并且只做一次全新的物理连接尝试。Host 按配置的 `websocketHeartbeatIntervalMs` 间隔（默认 2 秒）发送 Ping 控制帧，浏览器在 WebSocket 协议层自动回复 Pong，使空闲网络中间层持续看到流量，而不新增 Remote 流帧。若 socket 尚未回复上一次 Ping，Host 会在下一间隔终止它。可独立取消的逻辑流共享这条连接；进程内 Connection 载体直接提供等价的流，不打开该 WebSocket。

Host 组合可通过 `registerRemoteEvents()` 注册唯一的应用事件 source。Gateway 为它保留内部 `$events` logical endpoint，只接受空 `args`，并在 source 撤回时中止该注册打开的流。事件名单、参数校验、每个 Client 的队列及 opening `{ type: 'ready', clientId, host: { home } }` frame 中的 Host home 由 API Remotes 拥有。source factory 在返回 iterable 前同步挂好增量 listener，因此 Client 只在增量投递就绪后发布 generation 并开始 baseline 读取。

Gateway 接受协议 1 的 `{ args }` 请求，也接受与 `args` 并列的显式 `apiProtocolVersion` 1 或 2。共享 `/protocol` 入口按已选版本编码；版本 1 省略元数据以支持旧 Host。未知或格式错误的显式版本在业务调用、流打开或事件结果结算前返回 `gateway/protocol-unsupported`。端点参数仍严格校验。请求元数据不授予权限。应用准备回调必须返回明确选择的编解码器，由准入代际及其事件回复持有；独立组合显式解析为协议 1。

显式 `apiProtocolVersion` 0 声明落后两代的诊断层级：请求沿用冻结的协议 1 编解码，且只对只读 Host 发现端点（`host/describe`、`host/negotiate`）准入。其余所有端点——业务 RPC、流与事件结果结算——以携带相同兼容性详情的 `gateway/protocol-unsupported` 拒绝，Client 因此呈现常规升级指引。该层级是固定协议不变量而非配置项；`host/negotiate` 仍要求正整数报价，诊断层 Client 无法把自己协商进完整编解码器。

按声明版本划分的准入端点面，由 `tests/gateway.host.spec.ts` 的 `pins the protocol-version by endpoint-class interop matrix` 作为一张互通矩阵固定（流打开的准入版本行在流套件中）：

| 声明版本 | 发现端点（`host/describe`、`host/negotiate`） | 业务 RPC | Remote 事件流打开 | 事件结果结算 |
| --- | --- | --- | --- | --- |
| 0（仅诊断） | 准入，只读 | 拒绝：诊断消息 | 拒绝：诊断消息 | 拒绝：诊断消息 |
| 1（遗留） | 准入 | 准入 | 准入 | 准入 |
| 2（当前） | 准入 | 准入 | 准入 | 准入 |
| 未知或畸形 | 拒绝：`gateway/protocol-unsupported` | 拒绝：`gateway/protocol-unsupported` | 拒绝：`gateway/protocol-unsupported` | 拒绝：`gateway/protocol-unsupported` |

初始应用调用可在 `connecting` 期间等待，直到发现与事件首帧允许准入。`reconnecting`、`offline` 或失败状态期间发起的调用在载体发送前失败。重连不会重新提交被拒绝的操作；调用者必须在 `ready` 后显式发起新请求。

建立 generation 时，Host 或 Gateway 协议不受支持、发现阶段缺少必需能力会发布 `incompatible`；Host 发现信息无效或 preparation owner 被撤回会发布 `fatal`。两者均暂停 Connection 的自动尝试。任一状态生效期间，业务调用在发送前失败；手动重连会重新执行发现后才允许调用。普通业务操作失败不改变 Connection 状态。

无效的 WebSocket 帧、转发事件就绪信息或交互记录产生 `gateway/stream-invalid`，携带对应流并在本地保留解析原因。受影响流直接终止，不执行载体重试；事件代次失败后发布 `fatal`，直到显式重连。真实 socket 断开保留普通恢复策略。验证失败不授予重放变更或回答的权限。

待处理的作用域 waterfall 由 Host 调用方持有，不随 Client 断线结束。第一个被接受的结果只结算一次请求。迟到回答、已关闭 Client 连接代次的回答，以及该 Client 已通过 `next()` 委托后的回答，均返回携带 `eventId` 的 `interaction-closed`，不改变任何待处理请求。Client 投递将此结果视为已完成的交互，而非 Connection 故障；其他错误保留原有失败行为。此结果不提供持久化变更回执或设备授权。

除 `interaction-closed` 外，被拒绝的交互结果 envelope 以保留 Host 错误码和详情的 `RemoteError` 结束事件代次。因此既有 Connection 分类器可将不支持的协议暂停为 `incompatible`；版本冲突和未知码保留其普通恢复策略。收到拒绝只清除与该请求对应的保留回答。

对于应用声明的交互，协议 2 在 waterfall 及其终结取消帧中附带 Host 持有的记录。`requestId` 等于 `eventId`；Session 身份和所需回答权限来自事件源，Gateway 分配创建时间、状态和 revision。重连重放同一份 revision 为 1 的待处理记录。其余投递以 revision 2 和 `resolved`、`delegated`、`cancelled` 或配置到期产生的 `expired` 状态关闭；回答方已持有自身结果。协议 1 保持原有事件字段，不附带该记录。记录仅存活于待处理的 Host 调用期间；权限元数据不授予权限。

协议 2 的交互结果、委托和拒绝均回传 `interactionRevision`。Gateway 在移除投递或结算调用方前与待处理记录比较。缺少版本返回 `gateway/input-invalid`；不匹配返回携带预期版本和收到版本的 `revision-conflict`。回答协议必须与活动投递连接代次一致，防止协议 2 回答通过旧格式省略版本检查。协议 1 和没有交互记录的 waterfall 拒绝版本字段。无效回答保留待处理投递；已关闭投递仍返回 `interaction-closed`。Client 版本失败沿用原有连接代次恢复流程，由 Host 重放待处理记录，不向业务监听器注入元数据。

`interactionReplyPermissions.approval` 与 `.question`（默认 `true`）在 Host 侧对每条转发交互应答强制执行：不具备待决交互 `requiredPermission` 的 client 收到 `gateway/permission-denied`，其应答既不结算调用也不消费投递，底层工具副作用不会发生，其他有资格的应答者仍可作答。该开关是匿名 client 的默认值：Remote 事件流打开时 `args` 携带签名设备准入（`{deviceId, timestamp, signature}`，组合了 device-trust 时经 `ctx.deviceTrust` 验证）的 client 改为获得其设备角色第 21 节权限集。

`interactionTimeoutMs.approval` 和 `.question` 可分别限制被转发交互的存活时间，单位为毫秒，范围为 1 至 2,147,483,647。未配置的类型没有 Gateway 期限。期限从 Gateway 创建待处理记录时起算；`expiresAt` 使用 Host 时间，重连时保持不变。经过时长的定时器，或重放、接受回答前对 Host 截止时间的检查，会使请求过期，因此时钟回拨不会延长已启动的计时，回调延迟也不会放行到期后的回答。结算、调用方取消或事件源取消均清理定时器。过期以 `interaction-expired` 拒绝 Host 调用，并向协议 2 消费者发送 `expired` 终结记录；协议 1 接收原有取消字段。迟到回答返回 `interaction-closed`。Approval 将回答方拒绝映射为既有的失败关闭结果 `unavailable`，Question 则传播过期错误。此转发调用之外的本地回答方不受影响；过期记录不跨 Host 重启保存。

Host 进程重启会丢弃待处理调用。Client 重连时移除旧投递；向旧事件 id 回答会返回 `interaction-closed`。Session 恢复由 [Session owner](../../core/session/README.zh.md)负责，不归 Gateway 所有：中断工具可能具有未知结果，因此重连本身不授权重放其副作用。

<a id="client-service-clientremote-ctx-key-remote"></a>
## Client 服务：`ClientRemote`（ctx key：`remote`）

协议 2 的 ready 帧包含 `pendingInteractionIds`，列出为该连接代次排队的待处理交互 id。HTTP 传输失败时，Client 在内存中保留已完成的回答，仅在应用提供的 `interactionReplyScope`、待处理 id 和 revision 均相同时重发。缺少 scope 或待处理 id 快照时禁用保留；scope 变化时必须重新作答。成功确认、`interaction-closed`、取消、业务错误，或下一次 ready 快照中没有该 id，都会清除回答。迟到确认只能清除其发送的那份保留回答。发送前复制监听器结果；未完成的监听器仍在断连时中止，委托结果不保留。Client 卸载或页面刷新会丢失保留的回答。此重试不提供授权或持久化回执，也无法区分确认丢失与其他 Client 的回答胜出。

`$prepare` 的可选第二个回调在传输层派发前，依据已准入连接代次的信息检查每个端点。拒绝只影响该操作。领域流可通过 `available` 等待符合条件的 Host，而不打开流；取消会释放连接代次观察订阅。

逻辑流监督器将每次打开及交付的帧绑定到观察到的 Connection 代次。准入或读取期间发生替换时，丢弃旧代次的 Remote 失败或迟到帧，等待符合条件的新代次。孤立的载体重试预算属于单个已准入 Connection，因此连续替换连接不会在基线到达前互相耗尽预算。未分类的本地错误仍会终止流。领域消费者不另建重连循环。

`ctx.remote.$mount()` 会校验并注册生成的 Host-for-Client 贡献项，然后为发起调用的 Cordis fiber 安装具体的直接方法和作用域方法。每个 namespace 都是可追踪的 `remote.<namespace>` 子 Service，并在最后一个方法撤回后卸载。重复端点、命名空间冲突，以及缺少生成的严格编解码器的描述符，都会在方法可调用前报错。

应用在挂载所选业务 namespace 前，通过 `ctx.remote.$prepare()` 安装唯一的发现回调。回调使用现有的一元调用载体和 Connection 本次尝试的取消信号。Gateway 等待发现完成后才打开 `$events`，并在该连接代际就绪后才放行一元与流式业务调用；已放行的调用共享该代际的取消生命周期。发现失败保留其 Remote 错误码；发现责任方撤回后，准入保持关闭，直到替代者注册。未安装应用发现责任方的独立 Gateway 组合保留通用调用行为。[API Remotes 组合](../remotes/README.zh.md)拥有 Host 专属策略及通过 `$host` 暴露的事实。

发现回调接收 Connection source 的可选握手进度报告函数。Gateway 在发现回调报告进度前，记录本次尝试是否从首次 `connecting` 开始。业务调用可以等待该初始尝试的 `connecting` 或 `authenticating` 握手。重试即使显示 `authenticating` 也不允许等待；新调用在派发前失败，认证完成后不会重放。

每次一元调用都会校验位置参数，构造与描述符完全匹配的具名 `args`，再通过 `ctx.connection.rpc.call('/api', endpoint, ...)` 发送。生成的流方法返回 `AsyncIterable`，并在进程内 Connection 载体可用时通过它打开逻辑流，否则通过共享的 Gateway WebSocket 打开。生成的支持取消的方法接受最后一个可选 `AbortSignal`；Client 会在调用载体前将它与贡献项的挂载生命周期合并。一元结果和每个流项都经过校验后才会交给应用代码。撤回贡献项会同时移除其描述符和方法、中止正在进行的调用与流，并使外部仍持有的方法句柄在调用时返回拒绝。

每次一元调用都解析为 `RemoteResult<T>`——`{ ok: true, value }` 或 `{ ok: false, error }`——且绝不因载体问题 reject：本面把断线载体折入错误分支，调用方 signal 中止时答以 `gateway/cancelled`，因此没有消费方需要包一层来兜载体失败。只有装配故障仍会 reject：参数个数不符、方法未挂载、贡献已撤下、缺少 Context 适配器。`error` 是活的 `RemoteError` 实例，所以 `throw result.error` 保持 throw 语义；而 `isRemoteFailure(value)` 是消费方唯一需要的谓词——它认下的捕获值带着 Remote 错误码，它拒绝的一律是本地故障，调用方应当让其崩掉。`carrierFailure(endpoint, error)` 与 `cancelledFailure(endpoint, cause)` 构造这两种折叠结果，测试里的替代实现据此采用相同的折叠方式。

没有 Remote envelope 的 HTTP 拒绝由 Client 统一映射：401 为 `gateway/authentication-required`，403 为 `gateway/permission-denied`，503 为 `gateway/host-not-ready`，其他状态为 `gateway/transport-interrupted`，均携带 `{ endpoint, httpStatus }`。使自身连接代际失效的 401 保留认证错误码；调用者取消及到达时已取消的响应仍为 `gateway/cancelled`。这些代码描述失败请求：403 不证明设备撤销，503 也不会使其他方面已就绪的代际失效。未分类的载体异常仍为 `gateway/internal`，Host 业务失败保留自己的代码。

已识别的 Connection 传输中断使用 `gateway/transport-interrupted` 和 `{ endpoint }`；逻辑流的载体重试耗尽使用同一码和 `{ stream }`。只有实际收到 HTTP 响应时才提供 `httpStatus`。这些分类不会重试变更操作，也不改变流重试策略。

`ctx.remote.$host` 读取已准入代际的 Host 事实和页面本地的 `isLoopback` 值。在就绪前以及断连期间，`home` 和应用发现事实不可用。它不添加存储或订阅；消费方通过 Connection 代际变化观察失效与替换，或通过 `connection/reset` 观察新建立的代际。

`ctx.remote.$stream()` 返回跨越多个物理载体代次的单消费方 `RemoteStream`。每次调用领域 opener 前，它等待已准入 Host 及可选能力谓词满足；因此首次连接准备不会以不可用错误终止领域流。Host 仍在线时，它允许一次立即重试；Host 离线时，它等待下一代连接，并为每个流项标注物理代次。领域消费方校验并接受各代次的 opening value；业务与协议错误仍然终止流。一切终态失败离开本面时都是 `RemoteError`，包括重试耗尽和在 opening value 之前就结束的代次，因此流消费方与一元调用方用同一种方式判别。`RemoteStreamCarrierError` 命名的是可重试的物理丢失，它只作为 `carrierFailed` 回调参数到达领域，绝不作为终态结果。`RemoteSnapshotStream` 在此之上规定每代由一个初始快照和后续 delta 组成。`RemoteJournalStream` 将可选的 Host 可用性谓词传给同一流监督器，并基于领域提供的 entry 闭区间提供 follow-before-page、分页、重连追赶与缺口修复；它丢弃完整重复项，并拒绝缺口、倒置区间和部分重叠。领域还可以携带无 cursor 的通知：通知绝不推进或修复持久 cursor，在缺口修复期间收到的通知只会在 replacement page 提交后发布。若更新代次取代该修复，旧代次 held notification 会与其 page 一同丢弃。对任一种流执行 dispose（资源释放）时，系统会取消该流的请求，并在活动 iterator 完全停止后完成资源释放。

`ctx.remote.$on()` 订阅一条被转发的 Host 事件。它的合法键恰好等于 Host 装配声明的转发选择，listener 类型就是事件所属包自己的 Cordis `Events` 声明，因此不存在会与之漂移的第二份签名。每个订阅归属调用方 fiber，并随该 fiber 一起消失。Client Remote 服务激活时就把 `$events` pump 注册为 Connection generation source，无论当前是否存在 `$on` listener。浏览器使用 Remote mux，进程内组合使用 `connection.rpc.open`；opening `ready` 项建立 Connection generation 并提供 Host 信息。物理 carrier 失败、Remote 流故障、意外正常结束、非 ready 首项或畸形事件项都会终止该 generation，由 Connection 按持续且间隔封顶的带抖动指数退避重开。普通通知按注册顺序运行并隔离 listener 失败；Agent-scoped waterfall（瀑布式事件）允许 listener 返回结果、调用 `next()` 或拒绝，Gateway 再通过现有 HTTP 一元载体回送该结果。

`ctx.remote` 不暴露 Connection 生命周期控制。只有职责包含恢复的消费方才直接读取 `ctx.connection.state` 并调用 `ctx.connection.reconnect()`；普通 Remote 消费方仍只使用生成的 namespace 与 `$stream()`。

生成的声明合并通过共享的 `TypertClientRemote` 约定提供 TypeScript API。Client 入口不包含 Host 服务或 Host Cordis 接口合并；方法查找和调用使用普通对象与函数，而不使用 JavaScript Proxy。

<a id="model-experience"></a>
## 模型体验

无，因为该包分发应用调用，不注册任何提示词、工具或会话事件。

#### KV Cache 影响

无直接影响；被调用的业务服务负责产生任何模型可见结果。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- Connection 适配器对分发故障与未归类异常答以 `gateway/internal`，且不附带详细信息；拥有方或 Gateway 自己抛出的 `RemoteError` 带着自有码、message 与 details 过线。其 `cause` 链与 `TypertGatewayError` 子类身份只对同进程调用方留存。
- SRC 模式仅支持名称唯一的标识符参数，不支持解构、默认值或剩余参数。它只校验值能否安全表示为 JSON，不校验生成的业务类型，也绝不会推断可选字段。
- Client 侧只能挂载严格模式生成的贡献项。SRC 标记不具备 Client 编解码器或类型投影。
- `$stream()` 监督载体替换，但不推断回放语义；各领域自行拥有恢复 cursor 或替换 baseline 的校验，以及正常结束的分类。Connection generation 会重开内部 `$events` 流；单向通知不会重放，仍处于 pending 的 scoped waterfall 则沿用同一个 event id 重放。
- lookup 解析器按 key 配置；当前无法让单个 Remote 参数或 endpoint 在同一 `agent`/`session` key 下选择 live-only 策略。
- 被转发的事件到达 `$on` 时不做业务载荷投影或脱敏。普通通知在重连后不重放；Agent-scoped waterfall 只投影选择 Client Context 所需的顶层 Agent 身份，并自行携带 pending 生命周期。
- `websocketHeartbeatIntervalMs` 同时是 Ping 周期和 Pong 截止时间。对端未在下一周期前回复时，Host 会终止连接；如果部署的事件循环或网络可能停顿超过该间隔，必须调大此配置。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。Host 调用会重新读取权威的 Cordis 与 Typert 状态，Client 方法、描述符与 `$on` 订阅的变更则统一归属同一个 effect。
