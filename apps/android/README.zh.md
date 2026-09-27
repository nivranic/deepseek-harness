# @deepseek-ai/dsh-android

[English](README.md) | 中文

DeepSeek Harness 的下游 Android 薄壳。设备首先是 Remote Companion：不运行 Agent runtime，不维护第二份 Session 真相。本工程从消费共享 Remote 失败词汇表的 contract 模块起步，`core` 领域模块与 `app` 外壳现已从历史 Android 应用源迁入本构建。

## 使用本工程

`contract` 模块是 Kotlin JVM 库，镜像当前候选的 Remote 失败契约：

- `RemoteFailureClass` 与 `RemoteFailureClasses.classify(code)` 镜像 `@deepseek-ai/dsh-typert-protocol` 的 `RemoteFailureClass`/`REMOTE_FAILURE_CLASSES`。没有共享语义的码——包括更新 Host 的所有未来码——解析为 `UNKNOWN`，必须保持为可呈现的不透明诊断。类只命名 Client 接下来可做的事；从不授予能力、权限、重试策略或协议版本准入。
- `EnvelopeSchemaTest` 用[Remote 失败 JSON Schema](../../packages/typert/protocol/remote-errors.schema.json) 校验真实录制的 HTTP payload，拒绝非法的已知码详情，并证明 Kotlin 镜像与 TypeScript 权威的生成投影一致。

schema 在测试期直接从协议包复制，因此 Kotlin 列始终校验当前候选字节。分类投影通过 `node scripts/gen-remote-failure-classes-json.mjs`（先 `pnpm run build:lib`）重新生成；已提交的产物由测试校验，漂移即失败。

`core` 模块是迁入的纯 JVM 领域：Lite 折叠（loop、chat、stores、tool registry）、Link 配对/线协议栈（Noise、签名、pinning、诊断）、Handoff 快照、支持导出与 push/relay 客户端。测试类用 `gradlew :core:test` 在 JVM 上运行，不需要 Android SDK。`app` 模块承载 Compose 表面（聊天屏、通知、Keystore cipher、支持扫描器胶水）；构建它需要"已知限制"中说明的支持扫描器 AAR 链。

在本目录用 Gradle wrapper 运行测试（Windows 用 `gradlew.bat :contract:test :core:test`，其他平台用 `./gradlew :contract:test :core:test`）；首次运行会下载 Gradle 发行版与依赖。

core 的 `gateway/NativeGatewayClient` 通过 `WireDriving` 实现当前固定指纹 Native Remote 协议：操作员签发的 `dsh-native-pairing` 版本 1、API 2 Connection RPC，以及共享的 `/api/remote.mux` WebSocket。每次分派签署新的设备准入，只有兑换不签名。配对在保存凭据前核验返回的设备公钥指纹、授予角色及协商后的 Host 身份。Session writer 版本与 API 协商分开观察。凭据带有 `transportFormat: native-gateway-v1`；恢复拒绝旧 Link 身份但不删除它。部署方提供超时与每流缓冲上限；溢出使对应流失败，不静默丢值。

Host 传输场景为 [android-gateway.e2e.ts](../web/tests/android-gateway.e2e.ts)。以 `gradlew.bat :core:nativeGatewayClasspath`（或 `./gradlew :core:nativeGatewayClasspath`）准备 Kotlin 驱动，再使用 `vitest.web.config.ts` 运行场景，将 `DSH_ANDROID_JAVA` 指向 Java 17。驱动通过 stdin 接收临时配对数据，不使用命令行参数。它覆盖指纹固定、确认信息核验、权限拒绝、并发流、取消、撤销、恢复和等待关闭。

应用选择 `NativeGatewayClient`，把 Keystore 加密的身份保存在 `native-gateway-credentials.json` 中；`link-credentials.json` 保持原样。Question 回复携带下发的交互修订号及结构化选项/自定义答案。文件以选中的 Session 为范围，以 `.` 请求根目录，并在按行分页期间保持同一版本。回复失败时保留卡片供用户显式重试。HTTP RPC 每次关闭连接且不自动重试，避免复用用户回答期间已被 Host 关闭的连接；mux 保持长连接。

录制的[伴随端场景](../web/tests/android-companion-question.e2e.ts)同时验证 JVM 模型和已安装的 Compose Activity。验收 Host 将页面限制为 1000 行，因此 1001 行 UTF-8 文件需要第二次读取。使用下方扫描器输入构建 `:app:assembleDebug :app:assembleDebugAndroidTest -PdshNativeAcceptance`，将两个 APK 安装到模拟器。`DSH_ANDROID_ADB` 指定 adb，`DSH_ANDROID_SERIAL` 必须指定模拟器。场景只重置独立的 `.nativeacceptance` 应用，通过临时 ADB socket 驱动配对及 Question 回答，并在点击“加载更多”后核对界面文件文本。该驱动拒绝物理设备。

## 理解实现

在当前 Host 下打开 **连接能力**，查看最近成功查询的能力声明、配对时角色以及彼此独立的 API/Session 版本。列表仅覆盖客户端固定识别的能力；未出现表示该次观察未声明支持，不表示权限被拒绝。进入前台或显式刷新时查询 Host。刷新失败保留已有事实并显示失败提示；切换 Host 关闭旧详情，隔离迟到查询。观察不证明当前权限或健康。[已安装能力场景](../web/tests/android-capability-presentation.e2e.ts)验证拒绝与显式恢复。

会话、文件与子代理操作分别依据其能力声明。已知不受支持的操作保持隐藏，自动查询停止；原生传输也会在发送前拒绝对已知操作的直接调用。观察关闭后，本地草稿与待确认输入仍保留，恢复支持不会自动提交。内建事件传输保持自身 API 协商规则。[操作决策](../../.agents/notes/implemented/architecture/2026-09-27-android-operation-capabilities.zh.md)定义映射及其与授权的区别；[已安装操作场景](../web/tests/android-operation-capabilities.e2e.ts)在服务端方法保持挂载时验证请求被抑制。

子代理页列出当前打开 Session 的子会话。打开子项可读取已保存时间线、加载较早分页或在读取失败后重连；视图不提供消息输入框或停止操作。目录刷新失败保留该父会话的行，切换父会话会退役旧子会话观察。父 Agent 未运行不表示其已保存子会话不可读。[子视图决策](../../.agents/notes/implemented/architecture/2026-09-27-android-subagent-timeline.zh.md)拥有取消及替换规则；[已安装场景](../web/tests/android-subagent-timeline.e2e.ts)验证冷子会话读取、分页和父会话选择。

Session 草稿与 Question 答案共享加密输入存储，按 Host id、固定指纹及设备授权隔离。已保存输入与最后查看的普通 Session 可以跨进程重启恢复；恢复只开启观察。显式提交仍由模型持有，并等待输入保存。失败 prompt 独立保留原始文本/附件完整意图及请求 id，不受新编辑影响。确认及匹配的 Host 回执仅清理已接受意图；关闭或修订后的 Question 移除过期答案。保存失败阻止提交并提供重试。不可读取的输入保持原样，直到用户显式备份并重建。[输入持久化决策](../../.agents/notes/implemented/architecture/2026-09-26-android-encrypted-input-checkpoints.zh.md)拥有格式与恢复语义；[录制场景](../web/tests/android-input-persistence.e2e.ts)验证进程恢复和加密存储损坏。

在 Session 输入区选择 **+ → 文件**，通过系统文档选择器选择一个文件；选择 **+ → 照片**，通过 Android Photo Picker 选择一张图片。文件与图片共用一个有序、可移除的附件列表；消息可以只含附件而不含文本。选择、读取和上传期间禁用发送及待确认消息重试。移除卡片只修改本地草稿。应用限制每份草稿最多 8 个附件、每个源文件最多 512 KiB；这些本地限制不与 Host 协商。文件与照片入口分别要求 `file-upload.stage.v1` 和 `image-upload.stage.v1`。照片接受 PNG、JPEG、WebP 和 GIF，拒绝 HEIC。恢复回执不会自动上传或发送。[文件决定](../../.agents/notes/implemented/architecture/2026-09-27-android-file-attachments.zh.md)拥有文档选择器入口；[照片决定](../../.agents/notes/implemented/architecture/2026-09-27-android-photo-attachments.zh.md)拥有图片入口、混合顺序与验证边界。

Host 报告暂存回执不存在时，失败提示说明显式恢复步骤。丢弃待确认发送前，请先复制需要保留的文字：丢弃会同时删除未再编辑的对应草稿，不同的新草稿则保留。移除草稿中仍存在的旧附件，重新选择，再显式发送。[回执恢复决定](../../.agents/notes/implemented/architecture/2026-09-28-android-attachment-receipt-recovery.zh.md)拥有错误识别与验证边界。[已安装恢复场景](../web/tests/android-attachment-receipt-recovery.e2e.ts)覆盖同一运行中 Host 释放 Session 后的 SAF 文件恢复；提示不诊断超时或 Host 重启。

选择 **+ → 相机**，通过已安装相机拍摄一张完整尺寸 JPEG。确认拍摄结果只把图片加入草稿，发送仍需显式操作。相机复用上述图片能力与本地限制，过大的 JPEG 会被拒绝。处理或取消后，应用清理自己的临时输出；清理失败保持可见。取消已打开的相机后，需等其结果返回才能再次选择附件。冷启动清理未完成拍摄，不恢复上传权限。[相机决定](../../.agents/notes/implemented/architecture/2026-09-27-android-camera-attachments.zh.md)拥有临时文件、回调生命周期及独立验收范围。

从其他 Android 应用向伴随端分享文本、照片或文件，选择已配对 Host 和普通 Session，在 **接收分享** 卡片核对后选择 **添加到草稿**。新的待确认分享会收起输入键盘，便于核对目标。确认将完整批次追加到当前草稿，发送仍需单独操作。添加后若本地保存失败，只需重试保存输入，无需再次导入。已中断且尚未添加的内容需要显式重新分享。[分享决定](../../.agents/notes/implemented/architecture/2026-09-28-android-share-intake.zh.md)拥有来源限制、确认与恢复语义。

[丢确认场景](../web/tests/android-prompt-retry.e2e.ts)在真实 Host 准入后暂缓返回结果并终止 Android 进程。显式重试使用已保存的请求身份；已有日志回执时则直接清理待确认项，不再调用 prompt。两条路径都在再次进程重启后保留新文本。

文件页提供与工件页共用的资源预览；工件页投影当前持久 `deliverables/presented` 声明。读取采用 Session 作用域的 `workspaceFiles/stat` 和 `readBytes`，窗口为 64 KiB，内容预算为 8 MiB。已知更大的文件只显示 256 字节前缀。显式重试续接已接受的同版本字节；版本变化会丢弃前缀并要求重新读取。UTF-8 文本、按签名识别的图片及未知二进制均为惰性呈现，并另有文本和像素预算。[资源决策](../../.agents/notes/implemented/architecture/2026-09-27-android-current-resource-reading.zh.md)拥有限制与退出语义；[安装应用场景](../web/tests/android-resource-adoption.e2e.ts)覆盖空文件、中文文件名、有界预览、中断和当前交付引用。

资源读取完成后，选择 **保存完整文件**，通过 Android 系统选择器创建文档。保存字节是该次完整读取的快照，包含零字节内容。取消选择器不写入；资源或 Host 退役使待处理选择失效。写入失败会尝试删除新建目标，清理失败另行提示。部分预览不能使用此快照保存操作。[保存决策](../../.agents/notes/implemented/architecture/2026-09-27-android-complete-resource-save.zh.md)拥有结果生命周期与清理规则；[系统选择器场景](../web/tests/android-resource-save.e2e.ts)独立核验保存字节。

文件与 Artifact 预览还提供 **下载到此设备**、**暂停下载**、**继续下载**及 **保存已下载文件…**。再次打开同一资源时只恢复已有本地进度；继续网络读取始终需要显式操作，并重新核对 Host 版本。完整下载通过系统选择器保存，无需将整个文件保留在内存。确认 **移除本地下载** 只删除该资源的本地缓存内容与进度，Host 文件及已导出文件保持不变。下载失败保留已提交前缀；文件变化或本地下载不可读时，需移除后重新开始。[应用接入决定](../../.agents/notes/implemented/architecture/2026-09-27-android-persistent-download-adoption.zh.md)拥有这些控件及其验证边界。

Session 页可显式加载较早历史，并使用 Web v1 格式复制或打开查看位置。打开时必须匹配当前已信任 Host，保留待发送输入，并定位持久锚点；不会新建 Session 或提交 prompt。分页使用初始日志截止点并保留并行实时记录，取消或迟到响应不能跨越观察代际。默认每次请求 50 条消息，最多保留 8 MiB 序列化记录；读取失败或达到上限时明确提示并允许手动重试。[查看位置决策](../../.agents/notes/implemented/architecture/2026-09-26-android-native-view-location.zh.md)拥有生命周期与限制；[原生场景](../web/tests/android-view-location.e2e.ts)检查 88 轮 Host Session 的较早锚点及 Web 兼容的复制结果。

选择 **复制查看位置链接**，复制指向第一条可见持久记录的 Android 链接；既有复制操作仍输出原始 Web 载荷。打开新链接后，应用通过当前所选可信 Host 直接导航，无需再次确认。Host 不匹配、读取能力不可用，或正在处理分享、附件、发送时，应用显示失败；解决后需显式选择 **重试打开**。**停止定位** 会终止本次跳转，保留已经打开的 Session。[深链接决定](../../.agents/notes/implemented/architecture/2026-09-28-android-view-deep-links.zh.md)拥有 URI 格式、启动等待、查询归属与恢复规则。

Session 列表显示加载中、空列表和失败状态。刷新与重试都是显式读取；请求串行执行，取消后回到空闲，失败时保留最近成功的列表、固定诊断分类及 Gateway 拒绝 envelope。[列表恢复场景](../web/tests/android-session-list.e2e.ts)只断开自己的 Host 端口转发，恢复后手动重试，再撤销设备授权。打开 Session 前，发送与停止按钮保持禁用。

已保存 Host 选择器显示当前 Host 及其端点。添加另一 Host 保留已有条目；切换只恢复所选主体的输入。旧模型退出以及目录同时提交凭据与选择期间，业务控件保持隐藏。重新配对同一 Host 键会替换授权。[目录决策](../../.agents/notes/implemented/architecture/2026-09-26-android-saved-host-catalog.zh.md)拥有原子采纳、取消和失败语义；[双 Host 场景](../web/tests/android-host-roster.e2e.ts)核验同 id Session 隔离及当前 Host 请求分发。Host 任务继续运行，旧授权需操作员撤销。

目录不存在时提供旧原生凭据文件的显式导入，并保留原文件；不导入旧 Link 授权，也不在目录失败后回退。目录格式损坏、密文被篡改或 Keystore 密钥缺失时，应用保留文件，要求显式备份重建后才能再次配对。读取不初始化缺失密钥。[恢复场景](../web/tests/android-credential-recovery.e2e.ts)只修改隔离验收存储。硬件密钥永久失效仍未通过资格验收。

同一个内存 Session 所有者重连时发送最后保留的序号。连续增量保留较早页面；完整窗口重叠时只保留一致的前缀，游标失去覆盖时则替换为权威最新窗口。快照头必须匹配所选 Session；矛盾记录或字节上限失败保留已显示内容并停止自动恢复。新模型及进程重启不携带游标。[游标场景](../web/tests/android-cursor-resume.e2e.ts)连接真实 Host 验证覆盖与失去覆盖两种逻辑流中断；该场景不验收物理断网或前台恢复。

Session、Workspace 和交互观察只在传输故障或已分类的暂时性 Host 故障后重连。撤销、权限、兼容性、未知拒绝、无效响应及证书失败会停止自动恢复。审批页呈现拒绝，保留失败的答案供显式重试，并在事件客户端未就绪时禁用回答。恢复不会重放业务修改。模拟器场景关闭并停止应用，在不同进程中恢复加密身份而不增加授权，随后验证录制的 Question 及文件分页。

进程存活期间，伴随端在后台保留健康的 Push 观察，并在 Android 允许时呈现本地审批或 Question 通知。返回前台时，正常结束或临时失败的观察可以重新启动一次；永久失败和已退休模型保持停止。旋转保留生产流，每条通知只消费一次。点击通知打开当前应用，不选择其他 Host 或 Session，也不回答审批。[Push 恢复决定](../../.agents/notes/implemented/architecture/2026-09-28-android-push-foreground.zh.md)拥有恢复、最佳努力呈现及验证边界。FCM 投递、进程死亡后投递、真机后台限制及精确通知目标导航仍未通过资格验收。

缺少通知权限时，应用在每个进程中最多请求一次，包括尚未配对时；是否显示弹窗由 Android 决定。拒绝后，**应用通知已关闭** 提供本应用的 **打开通知设置** 入口。返回时刷新系统开关，不重新配对或重放已消费通知。旋转保留请求历史。[通知权限决定](../../.agents/notes/implemented/architecture/2026-09-28-android-notification-permission.zh.md)拥有请求准入、设置失败及验证边界。应用级开关不能证明通知频道可用或通知必达，拒绝历史也不跨进程死亡持久化。

| 文件 | 职责 |
|---|---|
| `contract/src/main/kotlin/ai/deepseek/dsh/contract/RemoteFailureClass.kt` | 镜像 TypeScript union 的封闭呈现类枚举 |
| `contract/src/main/kotlin/ai/deepseek/dsh/contract/RemoteFailureClasses.kt` | 已分类码镜像；未收录码解析为 `UNKNOWN` |
| `contract/src/test/kotlin/ai/deepseek/dsh/contract/EnvelopeSchemaTest.kt` | 真实 payload 的 schema 校验、镜像漂移与词汇子集检查 |
| `contract/src/test/resources/generated/` | TypeScript 权威的已提交投影 |
| `core/src/main/kotlin/ai/deepseek/dsh/companion/` | 迁入的领域：Lite 折叠、传输分类、诊断、支持导出 |
| `core/src/main/kotlin/ai/deepseek/dsh/link/` | 迁入的 Link 栈：Noise 通道、签名、pinning、请求快照 |
| `app/src/main/kotlin/ai/deepseek/dsh/companion/` | 迁入的 Compose 外壳：MainActivity、聊天屏、通知、Keystore cipher |
| `support/link-fixture-host.mjs` | 模拟器 lane 的 Host 侧 Link 夹具：经 pinning TLS 配对一台设备、校验 Ed25519 请求签名，并以分类的 `gateway/permission-denied` 信封拒绝 `workspaceFiles/read`；随库提交的 `fixture-host-cert.pem`/`fixture-host-key.pem` 是一次性本地回环夹具凭证，不是产品机密 |

应用将下载存储绑定到当前已验证的 Host 主体，并使用独立的 Android Keystore 密钥。限制为 64 KiB 窗口、每文件 1 GiB，以及最多保留 128 个下载的共享 2 GiB 加密缓存，并预留检查点空间。达到限制时拒绝写入；显式移除释放容量。资源替换与 Host 退役先等待传输及导出清理，再释放存储独占锁。[检查点决定](../../.agents/notes/implemented/architecture/2026-09-27-android-download-checkpoints.zh.md)拥有持久格式；[接入决定](../../.agents/notes/implemented/architecture/2026-09-27-android-persistent-download-adoption.zh.md)拥有应用生命周期与缓存限制。

<a id="local-support-export"></a>
## 本地支持导出

支持导出将当前 Native Gateway 传输所有权与历史 Link 观察分别标记。HTTP 回调计数与 mux 订阅属于客户端代次，模型重连计数保留各自生命周期。刷新失败后，协议事实与配对角色仍是最近已知观察，不能保证健康或授权。能力字段使用固定白名单。[诊断决策](../../.agents/notes/implemented/architecture/2026-09-27-android-native-gateway-diagnostics.zh.md)拥有这些规则；[已安装应用场景](../web/tests/android-native-diagnostics.e2e.ts)验证既有扫描器流程。

## 模型体验

伴随端展示 Host 持有的 Session 事件，通过当前 Gateway 返回显式的人类答案。它不在本地执行模型，也不增加独立的对话记录。无密钥验收场景回放录制的模型输出，不代表真实提供方已通过验收。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

`:app:assembleDebug` 要求经 `DSH_ANDROID_SCANNER_DIRECTORY`/`DSH_ANDROID_SCANNER_SOURCE` 传入支持扫描器 AAR 及已核验回执。[扫描器源码与 Android 构建器](../../native/support-scanner/README.zh.md)从精确的已提交源码生成资源。本机候选验收匹配扫描器与应用的 source/tree 身份、已安装 APK 与 JNI 哈希以及嵌入规则摘要。AAR 重复构建使用独立工作/输出目录，共享依赖缓存；已安装扫描器准入和当前 Native Gateway 支持导出在[实施状态](../../IMPLEMENTATION_STATUS.md)中分别记录证据。这不证明干净机器或跨平台可复现构建、发布签名或物理设备资格。

外壳已消费 Gateway 失败契约：拒绝异常原样携带失败信封（code、message、结构化 details）自单次调用结果与流失败帧透出，呈现侧经共享 `RemoteFailureClasses` 镜像分类——已知类别给出类别文案与下一步动作，词汇表之外的码保持不透明诊断（`GatewayFailurePresentation.kt`，由 `GatewayFailurePresentationTest` 与 `LinkClientTest` 的信封保留用例覆盖）。

[旧 Link 夹具](support/link-fixture-host.mjs)保留为历史协议测试，不能验收当前应用。当平台缺少 Ed25519 密钥生成时，应用使用捆绑的 `org.conscrypt:conscrypt-android`。实际 Native Remote 验收使用出厂 Host 组合和隔离的 Android 模拟器应用；摄像头扫描、物理设备、发布签名和平台互操作仍未通过资格验收。

后台下载调度、自动缓存淘汰、断电持久性、物理设备及第三方 SAF 提供方资格，以及全平台 File/Artifact 描述符验收仍开放。未接入当前应用的 Lite Handoff 辅助类保留为历史运行时传输测试，不用于查看位置 Handoff。浏览器深链接分发、HTTPS App Links、跨平台分享路由及 Swift 查看位置采用仍未通过验收；原生读取通过不代表所有标签页均已兼容。
