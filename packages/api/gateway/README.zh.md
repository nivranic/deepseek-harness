---
description: "带类型的 Client 到 Host 调用与流：分派、校验、取消、重连与转发的 Host 事件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-gateway

[English](README.md) | 中文

## 概述

为 Host 与 Client 两侧的 Cordis 环境提供 Typert RPC endpoint。Host 入口提供 `ctx.typertGateway`，`@deepseek-ai/dsh-api-gateway/client` 则提供 `ctx.remote`；两者使用同一份生成的 `InvocationDescriptor` 约定，并将业务选择交给 API Remotes。Connection 承载一元调用的请求关联、信任和响应 envelope，Gateway 则拥有多路复用的 Remote 流，每条流都在同一条逻辑流上携带从 Client 到 Host 的上行（uplink）。

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

每次调用时，`ctx.typertGateway.invoke()` 都会解析当前的描述符和 Cordis 服务，校验具名参数是否完全匹配，解析已注册的对象或 Context 身份标识，并调用公开的业务方法。业务服务继承 [`dsh-typert-protocol`](../../typert/protocol/README.zh.md) 的 `TypertRemoteService`，并用 `@Remote` 或 `@RemoteScope` 标记方法；已有其他基类时仍可改用 `bindTypertRemote()`。

`capabilities()` 从活跃 Remote 绑定读取显式版本声明。所有必需方法都必须保持可用；严格定义撤回会抑制该能力，直到重新注册。重复 id 与指向未导出方法的声明会失败。排序后的结果描述支持的操作，不代表调用方权限或特定请求资源已就绪。[Host 发现](../host-description/README.zh.md)通过现有 Remote 载体暴露这些事实。

严格模式从 `ctx.typert.local` 读取生成的调用描述符。查找参数使用 `ctx.typert.lookups` 中当前有效的解析器：业务包注册稳定声明与默认策略，Host 组合可用 effect-scoped `configure()` 覆盖解析行为；`@RemoteScope` 则通过已注册的 Host Context 适配器解析其接收者。SRC 模式是开发阶段的回退路径，适用于从未具备严格定义的端点；它解析简单参数名，并且只允许非查找参数使用可安全表示为 JSON 的值。已观测到的严格定义一旦撤回，系统会直接报错，而不会降低校验强度。 严格模式从 `ctx.typert.local` 读取生成的调用描述符。查找参数使用 `ctx.typert.lookups` 中当前有效的解析器：业务包注册稳定声明与默认策略，Host 组合可用 effect-scoped `configure()` 覆盖解析行为；`@RemoteScope` 则通过已注册的 Host Context 适配器解析其接收者。SRC 模式是开发阶段的回退路径，适用于从未具备严格定义的端点；它解析简单参数名，并且只允许非查找参数使用可安全表示为 JSON 的值。已观测到的严格定义一旦撤回，系统会直接报错，而不会降低校验强度。对于一元结果，Gateway 在生成 codec 提供 `encode()` 时执行它，否则保持 strict JSON 值不变；SRC 则递归识别运行时字节值。两条路径都向 Connection 返回 JSON 兼容元数据及相对于结果的字节附件，由 Connection 完成传输帧封装。

Connection 可用时，Host 入口会在 Connection 共享的 `/api` FetchHandler 上注册 trusted-host interceptor。Connection 把这个复合 handler 交给 HTTP bridge；handler 将已认领 endpoint 分发给 Gateway，未认领且没有精确 Fetch 路由负责的请求返回 404。直接调用 `invoke()` 会保留业务错误；`TypertGatewayError` 是 `RemoteError` 的子类，其 `gateway/*` 码命名了分发、绑定、提供方、查找、Context、参数、编解码器以及上行各自负责的故障：缓冲帧超过 `streamInboxBytes` 的上行报 `gateway/uplink-overflow`，`end` 之后的上行项报 `gateway/protocol`，被 codec 拒绝的上行项报编解码码 `gateway/input-invalid`。因策略而拒绝的解析器——冷恢复失败或 ownership fence——抛出自己的 `RemoteError`，它选定的码原样到达调用方。

每次调用都指明它所代表的 Peer：`InvokeRemoteRequest.peer` 与 `wireStream.open()` 的 `peer` 参数都是必填项，Gateway 从不提供默认 Peer。来自已释放 Peer 的分发以 `gateway/peer-disposed` 失败，一元调用、流、`$events` 与 `$events/result` 一律如此，wire 路径在读取 payload 之前检查。Host 服务注入 `remoteAccess`，没有 [`dsh-api-remote-access`](../remote-access/README.zh.md) 就不启动。每次调用在 endpoint 与参数字段检查之后按 Typert 编译类型校验一次 JSON 参数，失败为 `gateway/input-invalid`，分派复用校验后的值。对 Peer 的 principal 不是 owner 的调用，Gateway 在该校验之后、lookup 与 Context 解析之前解析调用访问的资源，并以端点为 action、校验后的参数为 `args` 询问 `ctx.remoteAccess.decide({ principal, action, resources, args })`，资源非法时不询问而以原因 `resource-invalid` 拒绝；被拒的调用抛出 details 为 `{ action, reason }` 的 `remote-access/denied`，因此被拒绝的调用在激活任何 Session 之前就失败。owner 的调用不解析资源、不询问判定即分派。

资源从已校验参数中读取：Typert 编译 codec 会移除未声明的对象字段，SRC fallback 只检查 JSON 安全性而不移除字段；lookup 与 Context 身份保持 wire 值。对每个资源种类，方法 `@Remote({ resources })` 或 `@RemoteScope(key, { resources })` options 中的读取函数优先；它以方法的位置参数调用（lookup 位为 wire 身份，取消参数位为调用的 signal），从根 Service 实例的类元数据读取。否则 provider 经 `resource` 声明了该种类的每个 lookup 参数贡献其 wire 身份，省略的可选 lookup 参数不贡献；Host Context adapter 声明了该种类的 Context 方法贡献其 Context 身份，在解析 Context 之前直接从参数读取。再否则使用该种类在 `typert.resources` 中登记的默认字段或同步 resolver。字段规则读取同名顶层参数，没有时读取第一个对象参数的同名字段。resolver 以 `{ args, parameters }` 调用一次：命名的已校验 wire 值，以及包含 `name`、`wire` 的有序参数描述。两种默认规则均返回单个身份或 `undefined`，数组无效。显式读取函数可以返回多个身份。resolver 或读取函数抛错、读取函数返回空列表、或某个身份（含 Context 身份）不是非空字符串时，解析结果为 `invalid`；不指明任何资源的调用只访问 `global` 资源，指明了资源的调用只访问这些资源。转发事件携带其条目声明的每个资源，因此在事件路径上读取函数返回 `undefined` 同样使解析结果为 `invalid`，而没有读取函数的条目访问 `global`。

`getPendingRemoteEvents()` 按到达顺序返回当前未结算转发事件的独立元数据，仅含事件名和 Agent ID。它不暴露请求正文，不改变事件生命周期，也不提供变化通知。

支持取消的 Remote 方法会把 `signal: AbortSignal` 声明为最后一个 Host 参数。signal 是 descriptor 元数据，而不是 wire 参数：Connection 将它提供给 Gateway，Gateway 则在已解码的业务参数之后注入它。SRC 识别这个保留的末位参数名，严格生成还要求它具有全局 `AbortSignal` 类型。

流式 Remote 使用 `@Remote({ mode: 'stream' })` 并返回 `Iterable` 或 `AsyncIterable`。`ctx.typertGateway.stream()` 执行与一元调用相同的 endpoint、参数、lookup 和取消校验，再返回可取消的业务项 iterable。Client 插件激活时打开 Gateway 自有的 `/api/remote.mux` WebSocket，并让它在空闲时保持连接。Connection 拥有重试调度；每次 retry 前，它要求 mux 取消候选或活动 socket，并且只做一次全新的物理连接尝试。Host 按配置的 `websocketHeartbeatIntervalMs` 间隔（默认 2 秒）发送 Ping 控制帧，浏览器在 WebSocket 协议层自动回复 Pong，使空闲网络中间层持续看到流量，而不新增 Remote 流帧。Pong、收到的任意帧，或未一次性完成的下行写入，都视为对端活动；默认 `'deflate'` 下，JSON 文本达到压缩阈值的帧异步 deflate，因此其完成总是计入。连续两个 Ping 间隔没有活动的 socket 会被终止，因此 Pong 被数据阻塞在拥塞链路上时连接仍会保持。`websocketCompression` 保持默认的 `'deflate'` 时，携带 `permessage-deflate` 的升级会协商该扩展，Host 压缩自己发出的、JSON 文本达到 1024 个字符 的帧；更短的帧不压缩，上行帧是否压缩由对端决定，设为 `'none'` 时接受同样的升级但不带该扩展。可独立取消的逻辑流共享这条连接；进程内 Connection 载体直接提供等价的流，不打开该 WebSocket。

启动器提供 `ctx.appReady` 时，Gateway 仅在应用成功启动后注册 WebSocket 升级路由。此前的连接尝试仍属于载体故障，由 Connection 的重试策略处理，因此重启中的 Host 不会在控制器仍在初始化时接受流。卸载会取消尚未触发的就绪订阅，并关闭已注册的载体。不提供 `appReady` 的嵌入式 Host 会立即注册，并自行负责启动顺序；进程内调用不变。

每条流还在同一条逻辑流上携带从 Client 到 Host 的上行。方法把上行项类型声明为返回类型的第二个类型参数——来自 [`dsh-typert-protocol`](../../typert/protocol/README.zh.md) 的 `RemoteStream<Out, In>`；`In` 缺省为 `never`，返回 `Iterable`、`AsyncIterable` 或 `RemoteStream<Out>` 的方法即声明自己不读上行。运行中的方法通过 `this.ctx.invocation` 读取本次调用：Gateway 从携带该 `RemoteInvocation`（`request`、`service`、`peer`、`signal` 与 `uplink()`）的 Context 派生接收者，因此没有任何东西进入参数列表，而非 Remote 调用派生的 Context 上 `ctx.invocation` 为 `undefined`。`uplink()` 每次调用只能取一次。描述符带 codec 时它在交付前逐项解码；不带时——SRC 方法，或 `In` 为 `never` 的方法——它交付经 JSON 安全校验的 `unknown` 值。Client 在已打开的逻辑流上把每一项作为 `item` 帧发送（顶层 `undefined` 项是不带 `value` 的 `item` 帧），以 `end` 帧表示半关闭；方法通过 `uplink()` 迭代结束感知半关闭，通过 `signal` 感知取消。被拒绝的项使整条流以 `gateway/input-invalid`（字段 `uplink`）失败。上行项在 Host 逐项校验，因为它们来自浏览器；下行项是 Host 方法产出的值，不经校验原样透传。方法结束下行时 Gateway 调用 uplink 迭代器的 return 并丢弃未读的项；发给从未取用 uplink 的方法的项在 inbox 里等到那时为止。每条逻辑流最多缓冲 `streamInboxBytes`（默认 262144）字节的上行帧；超限使流以 `gateway/uplink-overflow` 失败，`end` 之后的项使流以 `gateway/protocol` 失败，两种情况都不关闭 socket。发给 Host 已结束的流 id 的 `item`、`end` 与 `cancel` 帧被丢弃；只有重复的 `open` 会关闭 socket。`$events` 这类 Gateway 自有的流在打开时立即 return 其 uplink，因此它们的 `item` 帧被丢弃而不缓冲。一元方法也可以调用 `uplink()`；其项只在方法运行期间可读。每条流都代表一个显式指明的 Peer：WebSocket 上的流代表 Connection 在升级时接纳的 Peer，该 scope 释放时 socket 关闭；进程内载体的流代表其调用方传入的 Peer。该 Peer 释放时，流方法的 `signal` 也随之中止，流以 `gateway/cancelled` 结束，`$events` 流也随其 Peer 结束；已在运行的一元调用不会被取消。

Host 组合通过 `registerRemoteEvents()` 注册唯一的应用事件 source。Gateway 为其保留 `$events`，载体完成准入后只接受空 `args`。API Remotes 拥有事件选择、参数校验、每个 Client 的队列，以及 `{ type: 'ready', clientId, host: { home, platform } }` 中的 Host 事实。source 在发布就绪前同步安装增量 listener；撤回 source 会中止其流。

每条非 owner 广播都以 `event:<name>` 交给 `remoteAccess.decide()`，资源来自声明的读取函数；没有读取函数时使用 `global`。Gateway 对每帧只解析一次资源，并为相应接收方丢弃非法或未获授权的帧。payload 不作裁剪。具有 `view` 的设备角色显式获准在整个 Host 上接收这些由 Host 选择的通知。

待处理的作用域 waterfall 属于 Host 调用方，Client 断开不会删除它。首个获准结果只结算一次；对已结算或被替代投递的后续回复按幂等 no-op 处理。source 或调用方取消会结束待处理调用。进程重启丢弃待处理调用，重连不授权重放工具效果。Session 恢复由 [Session owner](../../core/session/README.zh.md)负责。

`$events` 与 `$events/result` 都要求存活的 Peer 且 `interactions: 'answer'`，否则 Gateway 返回 `gateway/interactions-forbidden`。本地 owner 流接收所有作用域 waterfall。设备只接收当前角色持有应用声明的 `requiredPermission` 的交互：Collaborator 可回答问题，Controller 与设备 Owner 还可回答审批，Viewer 不能回答。其他非 owner principal 只接收获准的广播。`hasLiveClient()` 统计尚未取消的回答型流；裸 socket 与 Viewer 流不计入，该观测也不保证 Client provider 已就绪。

每次设备回复都要提供新的签名准入，DeviceId 必须与目标事件流相同。其他设备冒答或设备借 owner 流回复返回 `gateway/interactions-forbidden`；native 载体缺少身份则返回 `gateway/permission-denied`。无效、过期与重放签名保留 Device Trust 错误。拒绝不会移除投递；Gateway 在结算前重新检查待处理交互的答复权限。

每个 native TLS listener 通过自己的 Cordis Context 调用 `createDeviceConnection()`。返回的回调保留隔离服务 receiver；除一次性 `deviceTrust/redeemPairing` 外，每次 RPC 与逻辑流都需要签名准入。载体 Peer 不具有设备权限；准入成功后创建独立的 `{ kind: 'device', deviceId }` Peer。Remote Access 将角色声明的端点 action 显式绑定到 `host`，保留原有 Host 级角色对合法 Session 和 Workspace 资源的访问。未声明或未获授权的端点返回 `remote-access/denied`；名为 `owner` 的设备角色从不成为本地 owner principal。撤销会移除授权并取消已打开的流，阻止后续值送达。

Native 信封携带 `{ apiProtocolVersion: 2, args, device }`，仍接受 `$events` 的冻结形式——签名放在 `args.device` 中。不支持的版本返回 `gateway/protocol-unsupported`；版本 0 只准入 Host 发现端点。普通浏览器载体保留 Connection 拥有的准入与官方 `{ args }` payload。

`terminateDeviceConnections({ deviceId })` 不经 WebSocket 关闭握手地销毁设备持有的每条不同物理流载体。这些载体上的流都观察到传输丢失，授权保持不变。流清理时释放其载体引用；没有活跃载体的设备返回零。`RemoteStreamMuxServer` 为 native listener 接受显式 `maxPayloadBytes` 与 `maxStreamsPerConnection` 限制。TLS 身份与部署限制见 [Native Remote Connection](../native-remote/README.zh.md)。

<a id="client-service-clientremote-ctx-key-remote"></a>
## Client 服务：`ClientRemote`（ctx key：`remote`）

`ctx.remote.$mount()` 会校验并注册生成的 Host-for-Client 贡献项，然后为发起调用的 Cordis fiber 安装具体的直接方法和作用域方法。每个 namespace 都是可追踪的 `remote.<namespace>` 子 Service，并在最后一个方法撤回后卸载。重复端点、命名空间冲突，以及缺少生成的严格 codec 的 Client 供值字段，都会在方法可调用前报错。

每次一元调用都会检查位置参数数量，构造与描述符完全匹配的具名 `args`，再把带类型的值原样交给 `ctx.connection.rpc.call('/api', endpoint, ...)`，而不执行 Client 侧 schema；Host 会在业务调用前校验收到的 wire 字段。生成的流方法返回 `dsh-typert-protocol` 的 `RemoteStreamHandle<Out, In>`，并在被调用时就打开一条逻辑流，进程内 Connection 载体可用时通过它打开，否则通过共享的 Gateway WebSocket 打开。句柄只迭代下行一次。`send(item)` 把一个上行项入队，在 `open` 帧之后发出；`end()` 半关闭上行；`dispose()` 在未收到终止帧时发送 `cancel`，并让迭代安静结束。提前跳出迭代等价于 dispose 句柄；下行终止后 `send` 抛错，`end` 被忽略。生成的支持取消的方法接受最后一个可选 `AbortSignal`；Client 会在调用载体前将它与贡献项的挂载生命周期合并。Client 将一元结果转换交给 codec 的可选 `decode()`。生成的解码器校验嵌套元数据与原生字节类型，不逐字节遍历、复制或冻结字节载荷。JSON 一元结果与流项不经 Client 侧类型解析直接传递。撤回贡献项会同时移除其描述符和方法、中止正在进行的调用与流，并使外部仍持有的方法句柄在调用时返回拒绝。

每次一元调用都解析为 `RemoteResult<T>`——`{ ok: true, value }` 或 `{ ok: false, error }`——且绝不因载体问题 reject：本面把断线载体折入错误分支，调用方 signal 中止时答以 `gateway/cancelled`，因此没有消费方需要包一层来兜载体失败。只有装配故障仍会 reject：参数个数不符、方法未挂载、贡献已撤下、缺少 Context 适配器。`error` 是活的 `RemoteError` 实例，所以 `throw result.error` 保持 throw 语义；而 `isRemoteFailure(value)` 是消费方唯一需要的谓词——它认下的捕获值带着 Remote 错误码，它拒绝的一律是本地故障，调用方应当让其崩掉。`carrierFailure(endpoint, error)` 与 `cancelledFailure(endpoint, cause)` 构造这两种折叠结果，测试里的替代实现据此采用相同的折叠方式。

HTTP 拒绝和其他载体异常使用 `gateway/internal`；Host 返回的 Remote 失败保留其错误码与详情。调用方取消使用 `gateway/cancelled`，优先于迟到的载体响应。事件连接重连不会重放或取消独立的一元调用。

`ctx.remote.$host` 提供固定的页面本地 `isLoopback` 值，以及当前事件连接代际的 `home`。在该代际不可用时，`home` 为 `undefined`。应用通过生成的 `host.describe()` 方法获取能力；领域消费者负责各自的能力准入。

`ctx.remote.$stream()` 返回跨越多个物理载体代次的单消费方 `RemoteStream`。对于回答型 Client，载体仍可用时的独立流故障允许一次立即重试；物理 WebSocket 丢失后等待 Connection 重开载体。如果 Host generation 已不可用，则等待下一代连接。每个流项都带有其物理代次。被动 Client 不使用 `$stream()`，而是调用生成的原始流方法，并自行处理终态载体故障。领域消费方校验并接受各代次的 opening value；业务与协议错误仍然终止流。一切终态失败离开本面时都是 `RemoteError`，包括重试耗尽和在 opening value 之前就结束的代次，因此流消费方与一元调用方用同一种方式判别。`RemoteStreamCarrierError` 命名的是可重试的物理丢失，它只作为 `carrierFailed` 回调参数到达领域，绝不作为终态结果。`RemoteSnapshotStream` 在此之上规定每代由一个初始快照和后续 delta 组成。`RemoteJournalStream` 基于领域提供的 entry 闭区间提供 follow-before-page、分页、重连追赶与缺口修复；它丢弃完整重复项，并拒绝缺口、倒置区间和部分重叠。领域还可以携带无 cursor 的通知：通知绝不推进或修复持久 cursor，在缺口修复期间收到的通知只会在 replacement page 提交后发布。若更新代次取代该修复，旧代次 held notification 会与其 page 一同丢弃。对任一种流执行 dispose（资源释放）时，系统会取消该流的请求，并在活动 iterator 完全停止后完成资源释放。

`ctx.remote.$on()` 订阅一条被转发的 Host 事件。它的合法键恰好等于 Host 装配声明的转发选择，listener 类型就是事件所属包自己的 Cordis `Events` 声明，因此不存在会与之漂移的第二份签名。每个订阅归属调用方 fiber，并随该 fiber 一起消失。Client Remote 服务仅在 `connection.interactions` 为 `answer` 时把 `$events` pump 注册为 Connection generation source，无论当前是否存在 `$on` listener。选择 `none` 时，`$on()` 不可用，Client 只打开物理生命周期连接；unary 调用不等待 socket 就绪。浏览器使用 Remote mux，进程内组合使用 `connection.rpc.open`；opening `ready` 项建立 Connection generation 并提供 Host 信息。物理 carrier 失败、Remote 流故障、意外正常结束、非 ready 首项或畸形事件项都会终止该 generation，由 Connection 按持续且间隔封顶的带抖动指数退避重开。普通通知按注册顺序运行并隔离 listener 失败；Agent-scoped waterfall（瀑布式事件）允许 listener 返回结果、调用 `next()` 或拒绝，Gateway 再通过现有 HTTP 一元载体回送该结果。

Client waterfall 的 Context 解析保持同步。解析器可以返回借用的 Context 或 `TypertOwnedValue<Context>`；Gateway 仅在处理器使用和回复结算均结束后释放 owned value。Context 解析失败保留既有的记录错误并委托语义，处理器失败产生拒绝回复。取消会抑制迟到回复，但不会释放处理器仍在使用的 Context。每个 handler 都必须响应 `request.signal` 并在取消后结束；插件销毁与 Connection generation 替换会等待未结束的 handler 结算。Session Context 的获取本身不执行历史 I/O。

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
- contribution 挂载时，每个由 Client 供值的字段都必须具备生成的严格 codec。SRC 标记没有 Client 类型投影，不是常规的 Client contribution 输入。
- `$stream()` 监督载体替换，但不推断回放语义；各领域自行拥有恢复 cursor 或替换 baseline 的校验，以及正常结束的分类。Connection generation 会重开内部 `$events` 流；单向通知不会重放，仍处于 pending 的 scoped waterfall 则沿用同一个 event id 重放。
- lookup 解析器按 key 配置；当前无法让单个 Remote 参数或 endpoint 在同一 `agent`/`session` key 下选择 live-only 策略。
- 被转发的事件到达 `$on` 时不做业务载荷投影或脱敏。普通通知在重连后不重放；Agent-scoped waterfall 只投影选择 Client Context 所需的顶层 Agent 身份，并自行携带 pending 生命周期。
- `websocketHeartbeatIntervalMs` 同时是 Ping 周期和活动截止时间。对端连续两个周期没有活动时，Host 会终止连接；如果部署的事件循环或网络可能停顿超过该间隔，必须调大此配置。
- `websocketCompression` 默认 `'deflate'`，会协商 `permessage-deflate`；Host 压缩自己发出的、JSON 文本达到 1024 个字符 的帧，更短的帧不压缩，因为 `ws` 在默认上下文接管下会忽略自己的 `threshold` 选项。压缩后的下行写入完成会计入心跳规则中的缓冲活动，而阈值以下的写入只有在本机发送缓冲区已满时才计入；换不到带宽的 loopback 部署可设为 `'none'`。
- 未压缩的排队写入完成说明 TCP 对端确认了数据；压缩写入则在 `ws` 完成 deflate 并写出后即完成，只证明本地流水线已排空。经过带缓冲的反向代理时，该对端是代理，因此持续下行期间 Client 消失，要等代理不再接收数据后才会被检测到。
- Gateway 通过 `invocation.uplinkWindow` 提供每条 WebSocket 流的 inbox 容量与 JSON 封装开销；没有编码帧 inbox 限额的载体省略该字段。领域协议可以公布该窗口并通过确认约束在途字节数。Gateway 本身不发放额度：Client 发送快于方法读取，或发给从未取用 uplink 的方法时，其流以 `gateway/uplink-overflow` 失败；上行项不会跨载体代际重放，需要恢复上行的领域在重开的请求里自带确认游标。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

./stream-protocol 导出为原生桌面调用方提供共享的 Remote 流帧格式和解析器。它们与浏览器客户端使用同一个经过认证的 WebSocket 端点。
