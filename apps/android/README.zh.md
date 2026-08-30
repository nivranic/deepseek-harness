# DSH Android 伴侣

[English](README.md) | 中文

Android 伴侣（原生化方案第 52、60 章）：`core` 是纯 JVM 领域与线缆模块，`app` 是其上的 Compose 七标签面——先配对，后在简约拟态基线下呈现会话/审批/计划/工具/文件/工件/子代理。

## 目录

| 路径 | 是什么 |
| --- | --- |
| [`core/src/main/kotlin/ai/deepseek/dsh/link/LinkContracts.kt`](core/src/main/kotlin/ai/deepseek/dsh/link/LinkContracts.kt) | 生成的契约模型，由 `pnpm run gen-link-contracts` 同步、`verify-link-contracts` 字节门禁 |
| [`core/…/companion/DomainFold.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/DomainFold.kt) | 第 62 章领域状态折叠的 Kotlin 半边：与 TypeScript、Swift 回放同一份一致性 fixtures，折叠结果完全一致；工件面板按 Lite 词汇消费 artifact/created 与 artifact/status（第 56 章） |
| [`core/…/companion/LiteFold.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteFold.kt) | Lite 行为规范折叠的 Kotlin 半边（第 33/34/63 章）：与 TypeScript 参考折叠、Swift Lite 折叠回放同一份 lite-conformance fixtures——取消保留前缀、断流保留部分文本、工具按 id 配对——内嵌宿主运行时阶段的地基 |
| [`core/…/companion/LiteToolRegistry.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteToolRegistry.kt) | Lite 静态工具注册表（第 36 章）：编译期捆绑 web_search/url_fetch/image_inspect/attachment_read/artifact_create/calculator，run_tests 经 LITE_REQUIRES_FULL_RUNTIME 交接，未知名称返回 null 绝不动态分发 |
| [`core/…/companion/LiteLoop.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteLoop.kt) | Lite 循环驱动器（第 34 章）：经 LiteProviding 缝驱动 prompt→流块→工具分发（查注册表，交接名停而不执行）→message/turn 完成；取消折 turn/cancelled，抛错按 provider/network 分流折入错误——ScriptedLiteProvider 替身可测 |
| [`core/…/companion/LiteStores.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteStores.kt) | Lite 持久化：`LiteSession` 事件溯源 journal（重放经 LiteFold 复原全量状态）、`LiteFileSessionStore` 每 `<id>.litejournal 追加式 JSON 行原子替换、`LiteFileArtifactStore` 资源通道 `<id>.artifact` 原子写（第 11/56 章） |
| [`core/…/companion/LiteChat.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/LiteChat.kt) 及 [`app/…/LiteChatScreen.kt`](app/src/main/kotlin/ai/deepseek/dsh/companion/LiteChatScreen.kt) | Lite 聊天面：`send()` 驱动一回合并把回合结果事件记入 journal 持久化、重启经 journal 重放恢复；Compose 面渲染 LiteDomainState——会话行/流式部分/工具行/工件引用/交接横幅（镜像 Apple LiteChatView，阶段最后一步） |
| [`core/…/companion/NeumorphicTokens.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/NeumorphicTokens.kt) | 仅简约拟态的视觉基线（第 60 章）：单一风格、双色调浮起表面 |
| [`core/…/link/LinkWire.kt`](core/src/main/kotlin/ai/deepseek/dsh/link/LinkWire.kt) 及同族 | 线缆客户端半边：直通 JSON 值与信封、JDK 提供方的 Ed25519 签名、叶子证书的 SPKI 钉扎、`LinkClient` 的 pair/describe/call/stream——对着真实本地 HTTP 服务器测试 |
| [`core/…/companion/CompanionModels.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/CompanionModels.kt) | 视图模型——会话折叠/发送/取消、交互收件箱、带 UTF-16 分页读取的文件浏览、子代理列表——各自驱动 FakeWire 可测的 `WireDriving` 缝 |
| [`core/…/companion/FileChanges.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/FileChanges.kt) | 工具轨迹到只读文件变更的投影（第 55 章首版）：write/edit/str_replace_editor 的已完成调用各成一 hunk，+N/−M 行数与增删行在工具标签折叠展开 |
| [`core/…/companion/CompanionPush.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/CompanionPush.kt) | 第 70 章最小推送链路：`$events` 转发折为仅携带引用数据的推送（审批等待/提问等待/任务完成），设备端本地化标题，本地通知呈现，中继（APNs/FCM）延后 |
| [`app/`](app/src/main/kotlin/ai/deepseek/dsh/companion/MainActivity.kt) | Compose 壳：配对屏、六标签脚手架、来自 core tokens 的简约拟态主题 |
| [`core/src/test/resources/`](core/src/test/resources/) | 测试回放的同步黄金 fixtures、一致性场景与钉扎证书 |

## 构建与测试

[Android Kotlin](../.github/workflows/android-kotlin.yml) 车道在 Ubuntu 上运行 `gradle test` 与 `:app:assembleDebug`（JDK 17、Gradle 8.14、不提交 wrapper、用 runner 的 Android SDK）；本地任何 Gradle 8.14+ 配 JDK 17 工具链加 Android SDK 即可。

## 已知限制与延后工作

- **生命周期感知收集**——各标签以 `collectAsStateWithLifecycle` 收集模型的 StateFlow，停止态暂停收集，不在后台空烧。
- **握手级钉扎延后**——`LinkPinning` 校验叶子证书的 SPKI 指纹，但接入 TLS 握手要随应用模块的 OkHttp 栈到来；此处的 JDK `HttpClient` 不做钉扎。签名私钥本身经 `CredentialsCipher` 缝只在 AndroidKeyStore AES/GCM 封存下落盘。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
