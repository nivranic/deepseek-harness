# Native SAF encoded upload 的 Host 请求体预算计划

状态：只读设计，当前存在 listener/Gateway 上下文路由阻断；此前无条件 ready 结论已撤回。尚未实现、生成、构建或验收。本轮只写此忽略文件。附件回执恢复的生产代码、测试、文档、before archive 和封存 helpers 保持冻结；开始实施须先解决下述路由前提，并等待主代理完成该轮推送和分配新文件责任，不复用或重跑该轮 prepare。

进入下一增量的基线：附件恢复已推送 `74b476627a`，主代理已完成其推送后核验与CI派发；新的 `native-upload-budget-before` 保存6924文件，archive SHA为 `a239e9736694a7e9e531f121ee440d806a042842d7549847e1cf4b306a533c5b`。该before不重跑。TS owner先实现并证明factory作用域，Android Core owner在收到通过信号前只准备接口与测试设计；集中Gradle、build和设备仍由主代理执行。

## 目标与当前事实

让 Android 在显式上传一个 SAF 文件时，读取已配对 Native HTTPS 监听器的实际 buffered HTTP body 上限，按最终发送的完整 UTF-8 JSON 字节做本地拒绝。Host 继续独立按收到的字节拒绝超限请求。此轮不实现 streaming、断点续传、图片上传预算、图片批次、Host 动态扩容或单纯调大常数。

已读根和 package 规则、`docs/architecture.md`，以及 Native Remote、Host Description、Connection、Typert 的相关实现与契约规则。当前路径如下。

| 事实 | 源码依据 | 设计影响 |
| --- | --- | --- |
| Android 限制源文件 524288 bytes、编码 args 1048576 bytes、每草稿 8 项 | `CompanionModelSet.kt` 的 `NativeFileAttachmentLimits`；`NativeFileAttachmentsModel.prepareUpload` | 三者是设备内存与草稿准入限制，不代表 Host 接受能力 |
| 上传只检查 `WireValue.ObjectValue(args)` 编码大小 | `NativeFileAttachmentsModel.kt` | 未包括 Connection envelope、RPC id、method、API metadata 与 device admission |
| 完整 JSON 在实际发送前才形成 | `gateway/NativeGatewayProtocol.request`、`NativeGatewayClient.rpc` | 精确检查必须在此处，不能估算 base64 头部余量 |
| Native Remote 把自身配置 `maxRequestBodyBytes` 传入 `bridgeConnectionHttp` | `packages/api/native-remote/src/index.ts` | 返回值应由接受请求的同一个监听器 owner 直接派生；当前共享Gateway路由尚不能保证这一点 |
| Native 的 `createRpcFetchHandler` 对所有 RPC 返回 `requestBodyMode=buffered` | `packages/client/connection/src/rpc-host.ts` | encoded upload 受完整请求体限制；它不是流式 Fetch 路由 |
| bridge 在声明 Content-Length 或累计读取字节大于上限时返回 HTTP 413，并终止请求 | `packages/client/connection/src/http-bridge.ts` | 等于上限允许继续；预算不包含 HTTP headers、TLS 或 chunk framing |
| `nativeRemote/describe` 的现有 capability 要求 `device.admin` | `native-remote/src/capabilities.ts`、`tests/transport.host.spec.ts` | 不能让普通 collaborator 借该方法读预算，也不能降低该方法权限 |
| `host.describe/negotiate` 的 capability 数组来自活跃 Gateway bindings | `host-description/src/index.ts` | 复用该发现渠道，不复制原生监听器配置进通用 HostDescriptor |
| Android 原生请求使用每次新鲜的 device admission、禁止重定向与透明重试 | `NativeGatewayClient.kt`、`DeviceAdmission.kt` | 必须只编码、签名一次并发送已检查的同一份 bytes；不得为了测量再生成第二个请求 |

Device admission 的签名覆盖 `deviceId\ntimestamp\nnonce`，并不签署整个上传 JSON；本计划的“完整签名 envelope”指包含该签名 admission 的完整请求体，安全传输仍由固定证书身份的 TLS 提供。

## 前置修正：绑定 listener 的调用 context

已确认的源码反例：Native Remote init 在 `src/index.ts:100` 取得 `this.ctx.typertGateway.deviceConnection`。Gateway `src/index.ts:233–238` 的该字段是普通对象，箭头闭包捕获构造Gateway时的原始 `this`；Cordis `utils.ts:117–123,176–198` 不会给无tracker的普通返回对象重绑context。直接Remote调用在Gateway `resolveReceiverContext` 返回其 `this.ctx`，随后 `prepareInvocation` 用该context的 `get(descriptor.service)` 取receiver。因此root Native A和isolated Native B共享root Gateway时，B的HTTP bridge按B预算限制，预算Remote却可能调用A。即使只有isolated B、root没有A，也不能用“只有一个listener”推出路由正确。

修改前真实复现已执行：`.artifacts/native-upload-budget-scope-feasibility.spec.ts` 通过正常 `launchWebScaffold` 和公开 `isolate('nativeRemote')/plugin` 启动真实TLS listener，1文件/2用例、17.84秒、退出码0。A/B同时存活且端口不同，在B真实配对owner后，经B固定SPKI的signed HTTP describe准确返回A信息；等待B释放后A仍可查询。仅isolated B时，B本地describe可用、真实owner配对成功，但signed HTTP describe返回 `gateway/permission-denied`。每个socket、listener与scaffold均等待清理。`native-upload-budget-scope-feasibility.{run,evidence}.log` 保留此 `BASELINE_DEFECT_REPRODUCED` 证据及执行前后源码SHA；这证明旧缺陷存在，不是factory修复或budget功能通过。

没有现成的公开context-bound device adapter可直接替换。公开 `invoke()` / `stream()` 接收已解码的业务请求，不等价于native signed-admission入口；禁止用它们包装预算或其他原生调用来绕过 `dispatchRpc` / `openWireStream` 的device检查。也不能从Native强转Gateway私有实现或用Reflect调用私有dispatch。

推荐先把冻结的 `deviceConnection` 对象替换为普通service方法 `createDeviceConnection(): TypertGatewayDeviceConnection`，不标记 `@Remote`。Native init从自己的 `ctx.typertGateway` 调用factory；factory在普通service方法的实际调用receiver中捕获caller context/receiver，再返回rpc/stream闭包。返回的plain对象本身不需要Cordis追踪，因为闭包已持有该次factory的正确receiver。实现不能把闭包重新绑回原始Gateway对象或保存为全Gateway共享的单个adapter。具体capture必须通过下述测试证明，不能仅假定代理会递归绑定。

新adapter的RPC仍调用 `dispatchRpc(endpoint,payload,signal,true)`，stream仍调用 `openWireStream(endpoint,payload,signal,true)`，failure仍用 `rpcError`；保持只有pairing redemption可unsigned、实际权限/重放检查、stream持续撤权与取消清理。Gateway的事件/交互存储仍由原Gateway实例拥有，不克隆第二套状态。删除旧对象入口并更新全部读者，避免同时保留一个会选错context的兼容路径。`wireStream`、Desktop及其他trusted-local carrier不在此修正中。

只读引用核对表明影响目前可控：唯一生产读者是 `native-remote/src/index.ts`，其他直接调用位于 `gateway/tests/gateway.host.spec.ts` 和 `gateway-stream.host.spec.ts`；公开interface、API文档和生成的tool-cordis catalog也包含旧声明。若实现时发现新的生产读者或需要改变共享Gateway状态隔离，先报告实际新增范围。

可靠启动拒绝仅作备选：它必须由Gateway公开窄检查验证“这个adapter实际会解析到的original service receiver就是此listener”，且覆盖尚未ready与provider替换。查Native自己的 `ctx.get('nativeRemote')`、比较预算/名称/端口、计数listener或只拒绝重复同isolation注册都不足以证明该关系。这比context-bound factory更复杂，当前不推荐。未完成factory实证前，不发布budget Remote或启动Android接入验收。

## 建议的最小 Host 方法

在既有 `NativeRemoteService` 下增加 `@Remote('httpRequestBudget')`，返回公开只含类型的 `NativeHttpRequestBudget { readonly maxRequestBodyBytes: number }`。名称与字段均限定 Native HTTP body，不称为文件大小上限、整个 Host 的 transport limits 或可用内存。返回定义必须说明：正 safe integer、单位 byte、包含完整 encoded JSON、包含端点与 device admission 字段、上限为 inclusive、不包含 HTTP headers/TLS/chunk framing。

配置owner已具备同样的范围：`native-remote/src/index.ts:51` 的 `limit()` 是 `z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required()`，`maxRequestBodyBytes`实际使用该schema。只读核对 `vendor/schemastery/src/index.ts:602–647`：范围检查拒绝越界，step=1按整数余数验证；小数、NaN与Infinity不能通过这组规则。因此不在getter重复新增runtime校验，不把返回声明放宽或收紧为另一份策略。定向配置测试仍需覆盖0/负数/小数/非安全整数/非有限值在配置owner拒绝，1与MAX_SAFE_INTEGER通过schema；只验证schema的巨大合法值不启动巨大内存分配。

独立声明 `native-remote.http-request-budget.v1`，methods 只含 `httpRequestBudget`，`requiredPermission: 'view'`。viewer、collaborator 与 owner 均可读取，但上传仍走原有 file-upload capability 和 `prompt.send` 等授权判断。现有 `native-remote.info.v1` 与 `describe` 的 `device.admin` 要求不变。未配对或已撤权请求仍由 Device Trust/Gateway 拒绝，不另开 unsigned discovery。

返回值只读取此 `NativeRemoteService` 实例已经校验、并用于其 HTTPS bridge 的 `config.maxRequestBodyBytes`；监听器尚未 ready 或已 disposed 时失败，不返回预设值。沿用现有 lifecycle readiness 失败路径，不为这一配置读取新增 Remote error code。该 Remote 方法与能力随原 service fiber 注册、退出；`host.describe/negotiate` 自动发现它，`HostDescriptor` 不新增 native 专用字段，也不增加独立预算 registry。

只有完成上述factory与真实双listener验证后，才能把该方法解释为接收请求的NativeRemoteService所拥有的预算；不能以当前错误adapter的行为为默认前提。即使本地 Web 管理员从另一个carrier调用该方法，也不能把返回值当作Web carrier预算。Android只对同一固定endpoint、pin和已核对Host identity的NativeGatewayClient使用该值。不得用全局最小值或某个root listener配置掩盖路由歧义。反向代理的更低限制不在此值中，实际Host/代理拒绝仍有效。

## Android 最小调用路径

在手工 Native Gateway 契约中增加预算值解析与已知 capability 映射。SAF 文件入口在当前成功观察中同时要求 file-upload 和已知预算 capability；不存在预算能力时提供本地化的能力不可用提示，不回退为某个“默认 Host 上限”。旧 Host 缺少这一新 capability 时，该文件上传入口不可用，聊天与其他原生操作继续按其现有能力工作。最新观察为未知时保持既有等待规则，未知版本 id（例如仅 v2）不当作 v1 使用。

实际执行仍由 `NativeGatewayClient.call` 对 `fileUploads/upload` 做最终保护，不能只依赖 UI：先通过现有 negotiate/Host 身份检查和 file-upload 能力准入，再检查预算 capability，并以同一个 client 的低层 RPC 查询 `nativeRemote/httpRequestBudget`。预算读取不通过会再次执行文件预算判断的包装层，避免递归。每次用户明确发起的文件上传都重新读取一次，不持久化、不跨请求缓存，不把之前成功的值当作本次失败后的默认值。这样只增加一次只读 RPC，省去缓存过期与 Host 改配置后的额外状态机。

预算查询本身、配对与 negotiate 不能依赖尚未取得的预算。它们仍受 Host 实际 body 限制；若上限小到连 signed discovery 都不能通过，上传必须停止并显示实际查询/传输失败。不能通过 unsigned endpoint、假的成功预算或不断减小请求绕过这一前提。

查询失败在附件模型保持 `FAILED / UPLOAD_FAILED`，通过既有固定本地化提示呈现；缺能力使用既有能力不可用展示，非法值保留 `ConnectionFailure.INVALID_RESPONSE`，网络/HTTP失败保留相应分类，真实Gateway拒绝保留完整envelope供诊断。取消继续作为取消处理。任何失败都不追加receipt、不清除或覆盖已有draft/pending，不把失败源URI保存为可重试授权；用户重新选择才发起下一次上传。此处不把所有失败统一文案为“文件太大”，只有实际完整body超预算才使用 `REQUEST_TOO_LARGE`。

取得有效预算后，按现有路径生成一次 rpc id、一次新鲜 admission 和一次最终 JSON。将该 JSON 一次转换为 UTF-8 `ByteArray`，比较 `bodyBytes.size.toLong() <= maxRequestBodyBytes`；大于时在 `OkHttp.newCall`/enqueue 之前拒绝。通过时从这一份 `bodyBytes` 创建 RequestBody 并发送，禁止重新序列化、重新签名或改 nonce。各字段包括非 ASCII 文件名、引号、反斜杠与控制字符的 JSON 转义全部自然计入。不能使用 String.length、base64 长度或 args 长度代替。

建议由原生 Gateway owner 定义本地 `NativeHttpRequestTooLarge(actualBodyBytes, maxRequestBodyBytes)` 异常，由附件模型的集中上传函数映射到既有 `NativeFileAttachmentIssue.REQUEST_TOO_LARGE` 与本地化提示。它不伪造 Host `Refused` 或新增共享 Remote error code；实际 HTTP 413 仍是收到的 `Carrier(413)`，不能把本地未发送与 Host 已响应混为一条计数。错误只保留固定类别与必要数值，不记录源 URI、文件内容、签名或原始 envelope。

源文件 512 KiB、args 1 MiB 和 8 项上限继续有效，即使 Host 宣布更大预算也不提升它们。准入是三个本地条件与完整 body Host 条件的交集，不是 `min(512 KiB, HostBudget)`：HostBudget 包含 JSON 和 admission，不能直接当成原文件字节数。此轮允许先完成既有有界读取和 args 编码，再执行完整 body 检查；不增加用于“提前算可选文件大小”的估算公式。

`fileUploads/upload` 无法判断文件来自 SAF 还是分享入口。因此在 transport 层保护这个 endpoint 会自然覆盖分享文件的同 endpoint 调用；不得添加来源标记来绕过限制，也不得宣称生产影响仅限 SAF。用户验收先限定单文件 SAF。共享文件路径保留既有原子本地采纳及失败行为，并用最小相关回归防止中途预算拒绝导致部分本地草稿提交；此轮不扩展图片批次或 `uploadImage` 的预算设计。

## 解析、失败和 Host 切换

| 输入或事件 | 要求 |
| --- | --- |
| 正整数预算 `1..9007199254740991` | 用 Long 保存/比较，不截断为 Int，不按预算分配数组；仍受本地内存限制 |
| 缺字段、null、字符串、负数、0、小数、超 safe integer 或非有限值 | 视为无效 Host 响应；本次文件 POST=0，无 receipt，无 prompt，不用旧预算 |
| 已知 v1 返回附加字段 | 可忽略扩展字段，仅消费严格校验过的已知字段；不能猜测未知字段为替代上限 |
| capability 缺失、只有未知版本、方法撤下或返回拒绝 | 本次上传明确失败；不降低检查或自动重传；用户可刷新 Host 后重新选择 |
| 查询取消、网络失败、身份/pin 不匹配 | 沿用取消与固定身份检查，文件 POST=0；不改变当前草稿或 pending |
| 本地完整 body 超预算 | 读取/选择资源按现有 owner 等待退出，显示 REQUEST_TOO_LARGE；无文件业务 POST、无新 receipt，不自动改文件 |
| 预算读完后 Host 配置变小、代理更严格或 Host 仍拒绝 | 保留真实 HTTP/Remote 失败与现有输入；不重试 mutation，不把预算当作接受承诺 |
| Host 切换或重新配对 | 预算、签名身份与 body 都属于原 NativeGatewayClient 实例；旧 client 关闭并等待查询/上传回调清理，新 client 重新发现与读取，迟到旧查询不得驱动新 Host |

预算读取完成后、请求构造/发送前继续使用原有 `requireOpen` 与 model selection-generation 检查；不把预算写进可跨 Host 复用的全局 static、credentials、input checkpoint 或 `SwitchableWireDriving` 共享缓存。读取预算期间仍属于当前附件操作的 busy 状态，Host 切换需要等待其退出。预算只是一次配置观察，不修改权限、Session、附件存储或 requestId 规则。

## 契约与生成范围

| 所有者 | 最小改动及规则 |
| --- | --- |
| Gateway TypeScript | `packages/api/gateway/src/{index,types}.ts`；普通 `createDeviceConnection()` factory与named adapter type，移除旧plain-object入口并导出type；保持原signed dispatch及shared instance state，不动wireStream或业务codec |
| Host TypeScript | `packages/api/native-remote/src/{index,types,capabilities}.ts`；同 owner 的返回类型和 live capability 是唯一声明，不改通用 HostDescriptor/codec 版本 |
| Typert | 根 `tsdown.config.ts` 的 workspace host `typertPlugin` 随 `build:lib:host` 生成该包 `lib/typert.host.{js,d.ts}`、`lib/typert.remote-client.{js,d.ts}` 与类型产物；不得手写 lib；现有 `./types`、`./typert`、`./remote` exports 可复用 |
| Kotlin | `NativeGatewayProtocol`/预算值解析、`NativeGatewayClient` 的受限 dispatch、`NativeGatewayDiagnostics` 已知能力、附件错误映射与对应 App 本地化/入口条件；当前没有 Kotlin Remote 方法生成器，不复制全套 TS 服务 |
| Swift | 当前 `apps/apple` 只有 Remote failure 分类与 schema 的 contract executable，没有 Native Gateway client 或 Swift 上传 runtime；不虚构已有 Swift 接入，不为此次单个方法创建新 Swift shell |
| TS/Python SDK | `packages/sdk` 与 `python/sdk` 使用独立 stdio JSON-RPC；未改 agent-loop、SessionEventMap 或 SDK 业务协议，不凭新 Remote 方法改其 expected 输出 |
| 共享错误契约 | 若采用上述已有服务失败及本地异常，不新增/改变 Remote error code，故不改 Remote error schemas、Kotlin/Swift failure fixtures 或 failure-class 生成结果；实施若确需新增共享错误，必须另行纳入全部生成/验证范围 |
| 公开文档和catalog | Gateway/Native Remote/Android README双语、一个新Agent Note；`docs/subsystems/typert.md` 双语的Gateway和nativeRemote API。已有 `TypertGateway` type-equiv块必须随interface更新（manifest已有条目）；新返回type补catalog ownership，若新增独立type-equiv块再登记。运行 `gen-cordis-catalog` / `gen-cordis-api` 更新API段与 `packages/extensions/tool-cordis/src/api-catalog.ts`，不手改生成catalog；每组更新pairing |

所用source imports、公开JSDoc参数/返回与generated API必须同改。budget Remote本身不增加模型输入或Session事件；Gateway factory的公开API改动会更新tool-cordis生成catalog，应运行其直接相关生成一致性/期望输出检查并检查是否影响所选录制输出，不能笼统声称没有模型可见变化。用户可见的拒绝/恢复行为要有实际owner-local expected与已安装场景；不重录无关LLM snapshot。

## 必须通过的最小验收

0. **先证明factory上下文。** Gateway定向测试通过root和isolated child context分别调用factory，保留A/B adapter后交错执行，验证实际接收者各属自己的context，而非getter/service存在性或相等预算示例。真实profile/scaffold同时启动root A与isolated B两个TLS listener，共享同一root Gateway，使用不同budget和实际port；signed `nativeRemote/describe` 与budget分别返回到达的listener事实。B卸载时等待其socket/mux/request清理，A仍可用。另覆盖root没有nativeRemote、仅isolated B的情况，防止“第二实例才错”的错误假设。普通direct stream采用可区分A/B结果与finally清理的隔离fixture，验证RPC与stream都捕获caller，而不只修RPC。unsigned RPC/stream、预算内viewer权限拒绝、撤权终止及取消清理继续走原认证路径。此项不通过，后续budget与Android验证不能替代它。

1. **Host authority 与权限。** 扩展 `native-remote/tests/transport.host.spec.ts`，通过真实 TLS 与 signed admission 读取两个不同配置实例的确切 budget；viewer/collaborator 可读而旧 describe 仍要求 admin；未配对、撤权拒绝；service disposal 后方法/能力随 owner 退出。直接调用真实Gateway执行入口，证明viewer读到预算后仍不能 `fileUploads/upload`，且没有上传/存储副作用；使用完整body在预算内的有效小请求，准确断言Host的 `gateway/permission-denied`，不能让413掩盖权限层。成功读取budget后再撤权，后续file POST仍由Host拒绝；查询和mutation分开计账。NativeGatewayClient只做能力准入，不把budget成功或本地role当作权限真值；collaborator仍需原有效Session与上传授权。正常Controller创建/解析Session，不能用UI隐藏、假receipt或替换业务方法证明权限。现有 HTTP body enforcement 不变。
2. **真实 Host 字节边界。** 使用足以容纳 pairing/negotiate/budget 请求的小预算（例如先验证 2048 bytes 可行），对真实序列化、带有效签名 admission 的 encoded-file 请求构造 B-1、B、B+1 字节。根据实际最终 bytes 补充有效文件名字符，而非只改变源文件/base64 的 4-byte 台阶；每个样本重新测量完整 body。B-1/B 到达原上传处理并产生有效 receipt；B+1 在 bridge 返回 413，原上传方法与存储无接收。另保留 declared Content-Length 与 chunked 实际累计超限的拒绝证据。极小到 bootstrap 也失败的配置单独断言，不把它冒充文件边界场景。
3. **Kotlin 编码与本地拒绝。** 使用实际 `NativeGatewayProtocol.request` 所产生的 body，证明测量和 RequestBody 使用同一字节数组；测试刚好B允许、B+1在newCall前拒绝。包括中文/emoji、引号/反斜杠/控制字符、长Session id、真实admission字段；其中至少一例 args<=B 而完整body>B。直接调用 `WireDriving.call("fileUploads/upload", ...)` 绕过按钮与附件UI，仍必须拒绝超预算body；预算capability缺失或只有未知版本时，同样直接调用也必须阻止预算与file POST。不能只测纯size函数。覆盖所有非法预算与合法大预算不提升512KiB限制。无 nonce 测量占位或固定“预留字节”。
4. **已安装 SAF + 真实 Host。** 正常 profile/scaffold 与真实系统选择器，Host 预算小于现有1MiB默认而大于bootstrap请求；选择一个在512KiB本地限制内、args尚能放入预算但完整body超限的文件，预算查询可见而 fileUploads/upload/prompt 均为0，草稿/pending保留且错误可读。再由用户明确选择更小文件，真实上传字节/hash匹配，明确发送一次产生一个用户消息。预算查询单列，不能把新增只读调用误算作自动业务提交。
5. **独立 Host 拒绝与隔离。** 原始客户端绕过Android预检查仍得到真实413；预算观察不是安全边界。对不同预算的A/B Host进行真实选择切换，阻塞并释放A的只读预算请求，证明A结果/签名/body不流向B、A请求退出、B独立查询；若使用可控响应变形覆盖恶意budget，明确属于parser负例而非Host真实配置事实。
6. **最小回归与证据。** 原Files成功/进程恢复、附件receipt恢复、文件分享的既有原子采纳路径；Native Gateway签名/撤权/退出；仅在实际改到共享图片逻辑时增加其直接回归，不借此扩图片预算功能。新增一个owner-local expected与少量截图（预算拒绝、草稿保留、明确小文件成功）。不把单测桩、mock budget 或一次PASS写成Swift、全图片或发布验收。

## 可并行文件责任

| 责任 | 文件与交付 | 协调点 |
| --- | --- | --- |
| TS Host/Gateway owner | `packages/api/gateway/src/{index,types}.ts`、`gateway/tests/{gateway.host,gateway-stream.host}.spec.ts`；`packages/api/native-remote/src/{index,types,capabilities}.ts`、该包 `tests/transport.host.spec.ts` 及所需owner-local测试fixture | 先完成factory与真实双listener前置，再固定budget方法/字段并通知Android；保留signed dispatch权限逻辑，不改HostDescriptor或HTTP bridge production |
| Android Core owner | `gateway/NativeGatewayClient.kt`、`NativeGatewayProtocol.kt`、`NativeGatewayDiagnostics.kt`、新增budget解析/本地异常文件；`companion/NativeFileAttachmentsModel.kt` 及对应Core测试 | 只对fileUploads/upload采用预算；保持WireDriving接口与共享input格式，集中映射REQUEST_TOO_LARGE；不得改其他worker的App/driver文件 |
| Root/App与真实验收 owner | `app/.../MainActivity.kt`、`HostCapabilityDetails.kt`、必要的 `NativeShareCard.kt` 与locale资源；`NativeCompanionAcceptanceTest.kt` 窄命令；新 `apps/web/tests/android-native-upload-budget.e2e.ts`、专用native小预算patch与expected | 入口/能力文案跟随Core确定的枚举；独占安装APK、设备、Host A/B控制与集中Gradle，确认同endpoint分享范围 |
| 文档与生成 owner | Gateway/Native Remote/Android README中英及sidecars；新Agent Note；`scripts/gen-cordis-catalog.ts` 返回类型归属映射、`docs/subsystems/typert.{md,zh.md}` 和sidecar、现有TypertGateway type-equiv块及必要的新manifest项；生成tool-cordis API catalog | 等TS factory/返回类型稳定后串行生成API与catalog；等实际测试后填证据；在pairing写入完成前不并行跑doc gates；不改手写产品、测试或当前封存helpers |

TS owner先完成factory来源验证，才能解锁Host budget与Android集成；Core可提前按固定候选字段做独立解析/完整bytes算法，但不得把它算作来源已解决或发布功能。Root独占共用构建和设备；Typert/build生成与文档目录生成明确串行，worker不各自重跑共享生成器。每位owner先保留工作树已有修改，不回退他人编辑。实现前再按最终方案检查这些精确路径，表中命名不是已经创建的文件。

## 取舍与实施顺序

先以普通service factory修正native adapter的caller context，再增加 `view` 可读的native-owner方法，能让预算对应实际listener，同时保持旧管理方法权限。直接复用invoke/stream会绕过signed admission；只做单例计数又无法识别isolated B的来源，因此不采用。每次显式上传先读一次预算，比永久缓存多一个只读请求，但不需要TTL、刷新推测或跨Host缓存。完整body生成后检查不能省去本地有界读取，却能与真正发出的bytes完全一致；保留现有内存上限约束该成本。

不采用“Host值替换512KiB常量”“base64乘4/3再加固定余量”“HTTP413后自动重试更小文件”“仅UI禁用”“所有客户端/所有transport的预算registry”或放宽服务端检查。新值是配置观察，不是配额预留，也不是文件服务的解码后大小承诺。

主代理完成当前封存并批准责任分工后，先实现context-bound factory并通过真实双listener RPC/stream授权与来源验证，再实现budget method与小预算边界，随后接入Kotlin完整body发送点和本地错误映射，最后完成已安装SAF、Host切换、文档/生成物/配对。factory实证失败时停在该依赖，不用Android通过或单listener示例掩盖。若修正需要扩大共享Gateway状态语义，先报告，不草率扩大公共协议。本文件中的全部新验证均为待执行要求，未运行生成、测试、构建或设备操作。

独立只读审查补充：此前ready结论撤回，修正版采用先factory、再真实双listener、后budget接入的顺序。没有现成安全adapter替代；权限负例、预算读取后撤权及绕UI缺失能力拒绝等要求仍保留。当前factory尚未实现、双listener尚未执行，因此阻断尚未被运行证据解除；本文件不是无条件发布ready结论。
