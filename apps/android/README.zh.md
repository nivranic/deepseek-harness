# DSH Android 伴侣

[English](README.md) | 中文

Android 伴侣（原生化方案第 52、60 章）：`core` 是纯 JVM 领域与线缆模块，`app` 是其上的 Compose 七标签面——先配对，后在简约拟态基线下呈现会话/审批/计划/工具/文件/工件/子代理。各模型持有同一个可替换 wire handle，fresh pair 成功后会为全部既有模型替换配对前 transport。unary 与 stream 请求使用 canonical `args` 嵌套；Remote Event 回答使用 Host `ready.clientId` 与 `outcome`；carrier loss 后，follow 与 interaction stream 分别通过 authoritative snapshot 或 ready frame 重订阅。

## 目录

| 路径 | 是什么 |
| --- | --- |
| [`core/src/main/kotlin/ai/deepseek/dsh/link/LinkContracts.kt`](core/src/main/kotlin/ai/deepseek/dsh/link/LinkContracts.kt) | 生成的契约模型，由 `pnpm run gen-link-contracts` 同步、`verify-link-contracts` 字节门禁 |
| [`core/…/companion/DomainFold.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/DomainFold.kt) | 第 62 章领域状态折叠的 Kotlin 半边：与 TypeScript、Swift 回放同一份一致性 fixtures，折叠结果完全一致；工件面板按 Lite 词汇消费 artifact/created 与 artifact/status（第 56 章） |
| [`core/…/companion/LiteFold.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteFold.kt) | Lite 行为规范折叠的 Kotlin 半边（第 33/34/63 章）：与 TypeScript 参考折叠、Swift Lite 折叠回放同一份 lite-conformance fixtures——取消保留前缀、断流保留部分文本、工具按 id 配对——内嵌宿主运行时阶段的地基 |
| [`core/…/companion/LiteToolRegistry.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteToolRegistry.kt) | Lite 静态工具注册表（第 36 章）：编译期捆绑 web_search/url_fetch/image_inspect/attachment_read/artifact_create/calculator，run_tests 经 LITE_REQUIRES_FULL_RUNTIME 交接，未知名称返回 null 绝不动态分发 |
| [`core/…/companion/LiteLoop.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteLoop.kt) | Lite 循环驱动器（第 34 章）：经 LiteProviding 缝驱动 prompt→流块→工具分发（查注册表，交接名停而不执行）→message/turn 完成；取消折 turn/cancelled，抛错按 provider/network 分流折入错误——ScriptedLiteProvider 替身可测 |
| [`core/…/companion/LiteStores.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteStores.kt) | Lite 持久化：`LiteSession` 事件溯源 journal（重放经 LiteFold 复原全量状态）、`LiteFileSessionStore` 每 `<id>.litejournal 追加式 JSON 行原子替换、`LiteFileArtifactStore` 资源通道 `<id>.artifact` 原子写（第 11/56 章） |
| [`core/…/companion/LiteArtifactReading.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteArtifactReading.kt) | 第 56 章资源通道消费面：按 id 读取字节并决定呈现——markdown/text/report/patch 直接呈现文本、其余显示类型与字节数、缺失 id 为诚实空态；聊天面工件行按需读取 |
| [`core/…/companion/LiteChat.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteChat.kt) 及 [`app/…/LiteChatScreen.kt`](app/src/main/kotlin/ai/deepseek/dsh/companion/LiteChatScreen.kt) | Lite 聊天面：`send()` 驱动一回合并把回合结果事件记入 journal 持久化、重启经 journal 重放恢复；Compose 面经 `liveState` StateFlow 实时渲染 LiteDomainState——回合中逐事件发布流式部分与工具相位、回合间 journal 重放（镜像 Apple LiteChatView） |
| [`core/…/companion/LiteHTTPProvider.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteHTTPProvider.kt) | Lite 真实提供方：OpenAI 兼容流式 chat completion（JDK HttpClient）——SSE `data:`/`[DONE]`/裸 NDJSON 行解析、reasoning_content/content/工具调用增量、按 index 的碎片组装；传输失败映射 timeout/unreachable/dropped，非 2xx 为 Provider——对真实本地 HTTP 服务器回路测试 |
| [`core/…/companion/NeumorphicTokens.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/NeumorphicTokens.kt) | 仅简约拟态的视觉基线（第 60 章）：单一风格、双色调浮起表面 |
| [`core/…/link/LinkWire.kt`](core/src/main/kotlin/ai/deepseek/dsh/link/LinkWire.kt) 及同族 | 线缆客户端半边：canonical `payload.args` / stream `args`、回显 rpcId 与 void result、JDK 提供方的 Ed25519 签名、pin-only TLS SPKI enforcement，以及 `LinkClient` 的 pair/describe/call/stream；配对会在持久化凭据前校验必填身份、角色与协议字段；规范的 `403 forbidden` 授权应答映射为 `LinkClientException.Refused("forbidden", …)`，不满足该精确判别条件的应答仍保留 HTTP `Carrier` 分类；[传输 owner](../../.agents/notes/implemented/architecture/2026-09-02-android-link-transport-and-stream-ownership.zh.md)在 I/O 前登记每个 OkHttp `Call`、以不阻塞 Main dispatcher 的可取消 suspension 执行 pair/unary、只让 stream 的 IO owner 关闭 response/source、join 被取消或反压的 reader，并在 replacement 中等待退役 client |
| [`core/…/companion/CompanionModels.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/CompanionModels.kt) | 视图模型——会话折叠/发送/取消、交互收件箱、带 UTF-16 分页读取的文件浏览、子代理列表——各自驱动 `WireDriving` interface，测试使用 FakeWire 替身；Session 与 Interaction replacement 串行化 active/pending stream generation，可等待 teardown 会 join 到静止 |
| [`core/…/companion/FileChanges.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/FileChanges.kt) | 工具轨迹到只读文件变更的投影（第 55 章首版）：write/edit/str_replace_editor 的已完成调用各成一 hunk，+N/−M 行数与增删行在工具标签折叠展开 |
| [`core/…/companion/CompanionPush.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/CompanionPush.kt) | 第 70 章最小推送链路：`$events` 转发折为仅携带引用数据的推送（审批等待/提问等待/任务完成），设备端本地化标题，本地通知呈现，中继（APNs/FCM）延后 |
| [`core/…/companion/NotificationGrant.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/NotificationGrant.kt) | 第 70 章运行时授权投影（Android 13+ 动态请求 POST_NOTIFICATIONS）：系统启用读数 + 本进程是否已问 + 用户末次回答——呈现随系统启用走、缺授权时一进程一问；app 侧 `NotificationGrantController` 持 StateFlow 接系统对话框 |
| [`core/…/companion/RelayRendezvous.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/RelayRendezvous.kt) 及 [`core/…/companion/RelayClient.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/RelayClient.kt) | 中继会合地基（第 68/69 章）：`RelayRendezvous` 内存态单账号转发——设备注册（含 pushToken 槽）、仅引用信封向账号设备扇出、按 poll 排空；`RelayClient` 是 Noise 加密的 HTTP 消费者（惰性 XX 握手、帧式 AEAD 体、一次性密钥推送流），对照真实本地 Noise 应答方回路测试，`link/Noise.kt` 携带由 node 参考实现固定密钥向量钉住的 Noise_XX_25519_ChaChaPoly_SHA256 栈；信封经 `asPush()` 桥接第 70 章推送词汇；自托管壳见 [`apps/relay`](../relay/README.zh.md) |
| [`core/…/companion/Handoff.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/Handoff.kt) | 第 40 章 Handoff L1 的设备侧：`LiteHandoff` 从折叠 Lite 状态（对话尾部、计划标志、待办、工件引用、溯源）构建快照线值并经 `session/handoff` 发送；拒绝或无会话应答读为 null |
| [`app/`](app/src/main/kotlin/ai/deepseek/dsh/companion/MainActivity.kt) | Compose 壳：coroutine 驱动的配对屏、七标签脚手架、进程所有的稳定可替换 wire、只停止模型的 view-model teardown，以及来自 core tokens 的简约拟态主题 |
| `core/src/test/kotlin/ai/deepseek/dsh/link/LinkNativeAcceptance.kt` | 执行共享真实 Host 垂直切片 corpus 的独立 Kotlin driver |
| [`core/src/test/resources/`](core/src/test/resources/) | 测试回放的同步黄金 fixtures、一致性场景与钉扎证书 |

## 构建与测试

参考实现 `RelayClient` 串行执行完整 HTTP 交换，在交换失败后退役缓存密钥且不自动重放。其无符号计数器在密码学运算前拒绝保留的最终 nonce；[中继传输语义](../relay/README.zh.md#transport-encryption)统一说明恢复规则与独立流密钥。

应用版本和内嵌分发渠道来自[公共应用发布标识](../../docs/development/product-release-identity.zh.md)。Gradle 读取生成的 properties，不使用兜底版本。

[Android Kotlin](../../.github/workflows/android-kotlin.yml) 车道和本地构建使用已提交的 Gradle 8.14 wrapper、经验证的分发 SHA-256、JDK 17 和 Android SDK 36。在本目录执行 `./gradlew --no-daemon test :app:assembleDebug`（Windows 使用 `gradlew.bat`）。CI 还对正式 Host composition 运行独立的 `:core:nativeAcceptance` driver。App 的编译和目标 API 均为 36，最低 API 保持 33。

共享传输固定使用 OkHttp 5.3.2。依赖升级必须同时通过 App 的 `:app:checkDebugAarMetadata`、`:app:assembleDebug` 和 core 测试：Gradle 会选择不同的 OkHttp JVM 与 Android 产物，纯 JVM 测试通过不能证明 Android SDK 兼容性。

在默认签名模式下，`./gradlew --no-daemon :app:lintRelease :app:validateReleaseBundle` 使用 R8 优化和资源收缩构建未签名 AAB，执行 release lint，并通过 bundletool 1.18.0 验证 bundle。产物位于 `app/build/outputs/bundle/release/app-release.aab` 和 `app/build/outputs/mapping/release/mapping.txt`。CI 拒绝已签名 bundle，并在验证后保留两个文件及其 checksum。[Release 基础](../../.agents/notes/implemented/process/2026-09-06-android-release-foundation.zh.md) 说明该证据与签名、release 设备验收、完整候选 provenance 的区别。

JVM、Android 和 Compose 的 Kotlin 插件与实际解析的 Kotlin 标准库使用相同版本。[Android 分析输入](../../.agents/notes/implemented/process/2026-09-06-android-codeql-inputs.zh.md) 记录兼容的 AGP 配对和通知使用的显式 Activity 类映射。通知 instrumentation 检查实际 Android 通知与 immutable PendingIntent 注册项。

App 使用 `Color(token.toLong())` 转换 core 的 32 位 ARGB token；Compose 的 `ULong` 构造器接收其专用 packed color 格式。未配对界面不会打开 Remote push stream。连接 Android 设备后，在本目录执行 `./gradlew --no-daemon :app:connectedDebugAndroidTest` 会启动真实 Activity，并在凭据恢复后验证配对首屏；测试会预先授予通知权限，将系统弹窗排除于该启动断言之外。Android workflow 在 API 34 模拟器中运行此检查，并保留 APK、checksum 和 instrumentation 报告。

### Release 签名

`DSH_ANDROID_SIGNING_MODE` 选择 `unsigned`（默认）或 `keystore`。Unsigned 构建拒绝任何已提供的 keystore 字段。Keystore 模式要求下表中的四个环境字段齐全，且 keystore 文件路径必须绝对、可读；未知模式、字段不全或文件无效都会拒绝 Gradle 配置。构建脚本将密码传给 Gradle 签名配置，不将值放入命令参数或诊断。Gradle 在实际签名时校验 keystore 凭据。

| 环境字段 | 含义 |
| --- | --- |
| `DSH_ANDROID_SIGNING_STORE_FILE` | 调用方提供的 keystore 的绝对路径。 |
| `DSH_ANDROID_SIGNING_STORE_PASSWORD` | Keystore 密码。 |
| `DSH_ANDROID_SIGNING_KEY_ALIAS` | 签名密钥别名。 |
| `DSH_ANDROID_SIGNING_KEY_PASSWORD` | 签名密钥密码。 |

注入这些字段并选择 keystore 模式后，`./gradlew --no-daemon --no-configuration-cache :app:assembleRelease :app:validateReleaseBundle` 使用该密钥签署 release APK 和 AAB。候选验证时使用临时 debug key，并核对其公钥证书与实际产物；生产签名和分发保持为独立操作。Unsigned 基础 CI 在 bundle 验证后使用临时 debug keystore 测试签名，校验 APK 证书，并确认已验证的 unsigned AAB 字节没有变化。它还通过真实 Gradle 配置拒绝不完整或互相冲突的签名输入。

## 已知限制与延后工作

- **生命周期感知收集**——各标签以 `collectAsStateWithLifecycle` 收集模型的 StateFlow，停止态暂停收集，不在后台空烧。
- **pin 认证的私有 Host TLS**——共享 OkHttp transport 在创建任何 `Call` 前安装 pin-only trust manager，以及重复检查叶子 SPKI 的 hostname verifier。Host 证书刻意没有 public-CA DNS identity，由 QR 认证的 SPKI 标识它。wrong-pin HTTPS fixture 必须在 HTTP handler 收到字节前失败。签名私钥经 `CredentialsCipher` 缝只在 AndroidKeyStore AES/GCM 封存下落盘。
- **真实 Host 验收**——Kotlin driver 与 Host orchestrator 消费从配对至撤销的唯一 13 步共享 corpus。结果分别记录 Host 与 Client commit，以及 protocol、contract、Session format 版本；缺少或跳过任一步都会让车道失败。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
