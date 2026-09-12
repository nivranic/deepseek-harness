# Agent Note: Android Link 传输与流所有权

Status: implemented

[English](2026-09-02-android-link-transport-and-stream-ownership.md) | 中文

## 问题

Android [Kotlin wire 客户端](2026-08-30-android-wire-client.zh.md)使用 `HttpURLConnection`，且只在 response body 打开后才发布可关闭 reader。因此，在 DNS 解析、connect、request write 或 response header 阶段收到取消时，没有预先存在的 call owner；与此同时，`disconnect()` 也不保证这些阻塞阶段会在 teardown join reader job 前停止。Session 与 interaction replacement 还会在没有串行化并发 replace/stop 的情况下覆盖 job 引用，使一条 stream 可能在其 owner 已不可达后仍然存活。

## 决策

`LinkClient` 按[优先采用维护依赖的策略](../process/2026-07-26-dependencies-over-hand-rolling.zh.md)拥有一组 OkHttp 5.3.2 client。pair、describe 与 unary 操作在 enqueue 前创建并登记各自的 `Call`，再通过可取消 suspension 等待 callback；coroutine 取消会调用 `Call.cancel()`，callback 结算时移除该 call。配对响应只有在提供非空身份字段、生成的 `LinkDeviceRole` 以及请求所用的 Link 协议版本后，客户端才会持久化凭据；畸形响应以 `BadWire` 失败。Stream collection 在单一 IO owner 中运行已登记 call，并通过 rendezvous channel 传递 frame。结算会先取消 `Call`，再取消并 join 该 owner；只有 owner 会关闭自身 `Response` 与 source，因此钉扎 TLS 取消不会让第二个 worker 排空同一个尚未结束的 chunked body。UI coroutine 不会执行阻塞 unary `Call.execute()`。载体授权拒绝采用参考客户端的稳定失败词汇：当 `403` 响应体的字符串字段 `error` 为 `forbidden` 时，客户端抛出代码为 `forbidden` 的 `LinkClientException.Refused`，消息依次取非空 `message`、非空 `reason`、`HTTP 403`；不满足该精确判别条件的应答仍为 `Carrier` 失败。`LinkClient.close()` 请求退役、拒绝后续 call、取消全部已登记 call、逐出连接池并关闭自身 dispatcher；`closeAndAwait()` 还会等待每个已跟踪 call、stream collector 与 dispatcher task 结算。`SwitchableWireDriving.replaceAndAwait()` 发布下一个 delegate 并等待已退役 delegate，因此 restore 与 fresh pairing 只会在先前 transport 完全停稳后返回。

`LinkTransportConfig` 显式给出 connect、write、unary read/call 与 stream read/call timeout。stream read 或 call timeout 为零时，刻意允许长期 stream 空闲；取消仍是终止机制。共享 client 在创建任何 call 前安装同一个 pin-only trust manager 与 hostname verifier。这保留 [Remote Link 访问](2026-08-30-remote-link-access-vertical-slice.zh.md)规则：由 QR 认证的叶子 SPKI 标识私有 Host，public-CA DNS identity 不会取而代之。

`SessionModel`、`InteractionModel`、`FilesModel` 与 `PushModel` 各自把 stream 生命周期交给一个 generation owner。mutex 串行化 replacement；同一个原子记录保存权威 generation 及其诊断快照，防止退役 job 发布连接观测。active 与 pending job 让每条已启动 transition 都可等待。同步 stop 使 generation 失效，并保持 `stopping` 直到两组工作全部结算；可等待 stop 会 join 它们，达到完全停稳。`CompanionRuntime` 为 Android 进程拥有稳定的 switchable wire。view model teardown 停止全部四个模型的流，不退役进程所有的 transport；配对失败会关闭临时 client，配对成功则把该 client 转交给稳定 wire。

连接尝试在收集执行到 wire 时开始。惰性 Flow 尚未建立订阅，因此只有已解码帧才把观测变为 `open`。EOF 和固定失败增加饱和中断计数；会话和交互重试保留最后失败，直到收到帧。工作区和推送所有者不自动重试。已取消作用域和已被取代的待处理 transition 不会让未启动观测一直保持 `opening`。诊断快照排除 generation 和全部帧内容。

共享 Gradle 依赖固定为与 App 编译 SDK 兼容的版本。OkHttp 的 JVM 与 Android variant 分别解析；Android AAR 元数据要求由 `:app:checkDebugAarMetadata` 检查。依赖升级必须同时通过 App 装配、core 生命周期测试和真实 Host 验收，不能仅凭纯 JVM 结果接受。

## 验证

经过认证的 Host 描述保留必填字段类型，不虚构能力或版本默认值。对象缺失、布尔值缺失或类型错误、版本不是数值或不是有限值时，均以 `BadWire` 失败；显式的零和 false 仍有效。按生成的 Link 兼容规则，未知可选字段仍可忽略。真实 HTTP describe 路径也会把畸形或非对象 JSON 映射为固定 `BadWire` 拒绝，不保留响应原文。

聚焦 Kotlin 测试证明从类 Main 单线程 dispatcher 发出的 unary call 不会阻塞该 dispatcher，取消会到达 active OkHttp call，close 与 enqueue 竞争仍会结算。其他确定性 barrier 覆盖 TLS connect、request-body write、response-header wait、response-body read，以及被 collector backpressure 阻塞的 stream reader。钉扎 TLS fixture 会保持两条 chunked NDJSON response 打开、并发取消两名 collector，并要求两名 collector 与 client 退役全部结算。Replacement 必须等待被阻塞 collector，并防止其排队的旧 frame 到达模型。这些测试还交错模型 replacement 与 stop，要求可等待 teardown 等待每一代，要求模型 teardown 保持进程所有 wire 可替换，并在不持久化凭据的前提下拒绝畸形的配对身份、角色与版本字段。传输状态测试钉住 unary 与 stream 授权两个路径：规范的 `403 forbidden` 应答带出稳定拒绝码，畸形 `403` 则保留为使用 HTTP 兜底消息的载体失败。[真实 Host 原生 Link 验收](../testing/2026-09-02-real-host-native-link-acceptance.zh.md)仍是共享 pair 至 revoke corpus 的执行 owner；源码检查与生成 fixture 不能替代 Kotlin 车道结果。

## 考虑过的替代方案

**保留 `HttpURLConnection`。** `disconnect()` 与 reader closure 无法提供在 DNS、connect、write 或 response header 开始前即可取消的 call handle，因此不能证明 teardown 达到静止。

**只给 `join()` 包一层 timeout。** 有界等待会让 teardown 在 socket 或 IO job 仍存活时返回；它限制等待时间，却没有退役资源。

**由取消方 coroutine 关闭 response。** OkHttp 在 `Response.close()` 期间可能排空尚未结束的 HTTP/1 chunked body。第二个 worker 因而可能与钉扎 TLS reader 争用同一个 input lock，而 IO owner 已会在 `Call.cancel()` 停止读取后通过 `use` 关闭两项资源。

**取消并覆盖每个模型 job。** 并发 replacement 可能在 stop 后发布，也可能覆盖另一条 live job 的引用。必须通过串行化与 generation invalidation 保留每条 transition 的 owner。

**恢复 public-CA hostname validation。** 私有 Host 证书刻意以 QR 认证的 SPKI 作为身份。要求 public DNS identity 会改变现有信任模型，而非修复取消。

## 后果

纯 JVM Android core 现在多一个受维护的 HTTP 依赖，并显式退役 transport。Link client 经 `close()` 后即为终态，依赖完整退役的 lifecycle transition 会在返回前走可等待路径；switchable wire 会构造新 client，而不会复用已退役实例。[Android Lite HTTP 提供方](2026-08-31-android-lite-http-provider.zh.md)保留自身的 JDK `HttpClient`；选择 OkHttp 是为了 Link transport 的 pinning 与取消所有权，而不是全仓网络栈重写。

官方 Gradle 模块构建、Android 应用组装与真实 Host-to-Kotlin 结果仍属于平台车道证据。直接 Kotlin 编译与 JUnit 执行可以在没有 Gradle 的宿主上证明纯 JVM 源码，但它们不能替代 Gradle 图、Android SDK 或真实原生车道。无法执行的步骤仍记为 `NOT_EXECUTED/HOST_ENVIRONMENT`；聚焦源码或 TypeScript 证据永远不会变成原生 `PASS`。
