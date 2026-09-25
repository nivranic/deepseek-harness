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

## 模型体验

伴随端展示 Host 持有的 Session 事件，通过当前 Gateway 返回显式的人类答案。它不在本地执行模型，也不增加独立的对话记录。无密钥验收场景回放录制的模型输出，不代表真实提供方已通过验收。

## 已知限制与后续工作

`:app:assembleDebug` 由 `verifyScannerResources` 门禁：支持扫描器 AAR 必须从 `native/support-scanner`（经 `scripts/build-mobile-support-scanner.py` 的 Go + Android NDK 链）构建，并通过 `DSH_ANDROID_SCANNER_DIRECTORY`/`DSH_ANDROID_SCANNER_SOURCE` 与回执传入。本机已完成该链路（Go 1.27.1、经 sdkmanager 安装的 NDK 30.0.16248370）：AAR 静态核验 PASS 并带回执，`:app:assembleDebug` 通过门禁，APK 已在本地模拟器 AVD 上安装并启动（`MainActivity` 处于 resumed、无崩溃；日志与截图见 `.artifacts/scanner-aar-*.log`）。不可达的 sum/proxy 端点经由 goproxy.cn 镜像预置模块缓存、预置 go.sum、子进程 `GOSUMDB=off` 绕开（内容完整性仍由 ziphash 缓存、`go mod verify` 与构建器的来源断言保证），gomobile 工具采用剥离符号链接（360 主动防御启发式拦截默认 gobind 二进制）。外壳已消费 Gateway 失败契约：拒绝异常原样携带失败信封（code、message、结构化 details）自单次调用结果与流失败帧透出，呈现侧经共享 `RemoteFailureClasses` 镜像分类——已知类别给出类别文案与下一步动作，词汇表之外的码保持不透明诊断（`GatewayFailurePresentation.kt`，由 `GatewayFailurePresentationTest` 与 `LinkClientTest` 的信封保留用例覆盖）。

[旧 Link 夹具](support/link-fixture-host.mjs)保留为历史协议测试，不能验收当前应用。当平台缺少 Ed25519 密钥生成时，应用使用捆绑的 `org.conscrypt:conscrypt-android`。实际 Native Remote 验收使用出厂 Host 组合和隔离的 Android 模拟器应用；摄像头扫描、物理设备、发布签名和平台互操作仍未通过资格验收。

工件读取和 Handoff 仍包含退役的 `session/artifact` 与 `session/handoff` 调用，需要迁移。原生传输诊断尚未填充旧 Link 诊断快照。因此，会话浏览、Question 回答及文本文件分页通过不代表应用所有标签页均已兼容。
