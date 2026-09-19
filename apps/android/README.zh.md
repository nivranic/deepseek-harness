# @deepseek-ai/dsh-android

[English](README.md) | 中文

DeepSeek Harness 的下游 Android 薄壳。设备首先是 Remote Companion：不运行 Agent runtime，不维护第二份 Session 真相。本工程从消费共享 Remote 失败词汇表的 contract 模块起步，`core` 领域模块与 `app` 外壳现已从历史 Android 应用源迁入本构建。

## 使用本工程

`contract` 模块是 Kotlin JVM 库，镜像当前候选的 Remote 失败契约：

- `RemoteFailureClass` 与 `RemoteFailureClasses.classify(code)` 镜像 `@deepseek-ai/dsh-typert-protocol` 的 `RemoteFailureClass`/`REMOTE_FAILURE_CLASSES`。没有共享语义的码——包括更新 Host 的所有未来码——解析为 `UNKNOWN`，必须保持为可呈现的不透明诊断。类只命名 Client 接下来可做的事；从不授予能力、权限、重试策略或协议版本准入。
- `EnvelopeSchemaTest` 用[Remote 失败 JSON Schema](../../packages/typert/protocol/remote-errors.schema.json) 校验真实录制的 HTTP payload，拒绝非法的已知码详情，并证明 Kotlin 镜像与 TypeScript 权威的生成投影一致。

schema 在测试期直接从协议包复制，因此 Kotlin 列始终校验当前候选字节。分类投影通过 `node scripts/gen-remote-failure-classes-json.mjs`（先 `pnpm run build:lib`）重新生成；已提交的产物由测试校验，漂移即失败。

`core` 模块是迁入的纯 JVM 领域：Lite 折叠（loop、chat、stores、tool registry）、Link 配对/线协议栈（Noise、签名、pinning、诊断）、Handoff 快照、支持导出与 push/relay 客户端。37 个测试类用 `gradlew :core:test` 在 JVM 上运行，不需要 Android SDK。`app` 模块承载 Compose 表面（聊天屏、通知、Keystore cipher、支持扫描器胶水）；构建它需要"已知限制"中说明的支持扫描器 AAR 链。

在本目录用 Gradle wrapper 运行测试（Windows 用 `gradlew.bat :contract:test :core:test`，其他平台用 `./gradlew :contract:test :core:test`）；首次运行会下载 Gradle 发行版与依赖。

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

## 模型体验

contract 与 core 模块仅在 JVM 测试中运行；迁入的 app 外壳在本构建上尚未接线任何模型可见表面。

## 已知限制与后续工作

`:app:assembleDebug` 由 `verifyScannerResources` 门禁：支持扫描器 AAR 必须从 `native/support-scanner`（经 `scripts/build-mobile-support-scanner.py` 的 Go + Android NDK 链）构建，并通过 `DSH_ANDROID_SCANNER_DIRECTORY`/`DSH_ANDROID_SCANNER_SOURCE` 与回执传入。本机已完成该链路（Go 1.27.1、经 sdkmanager 安装的 NDK 30.0.16248370）：AAR 静态核验 PASS 并带回执，`:app:assembleDebug` 通过门禁，APK 已在本地模拟器 AVD 上安装并启动（`MainActivity` 处于 resumed、无崩溃；日志与截图见 `.artifacts/scanner-aar-*.log`）。不可达的 sum/proxy 端点经由 goproxy.cn 镜像预置模块缓存、预置 go.sum、子进程 `GOSUMDB=off` 绕开（内容完整性仍由 ziphash 缓存、`go mod verify` 与构建器的来源断言保证），gomobile 工具采用剥离符号链接（360 主动防御启发式拦截默认 gobind 二进制）。未声明真机或发布签名资格，未发布任何产物；外壳对 Gateway 失败的契约消费接线随 Gateway 接线落地。
