# DSH Android 伴侣

[English](README.md) | 中文

Android 伴侣（原生化方案第 52、60 章）：`core` 是纯 JVM 领域与线缆模块，`app` 是其上的 Compose 六标签面——先配对，后在简约拟态基线下呈现会话/审批/计划/工具/文件/子代理。

## 目录

| 路径 | 是什么 |
| --- | --- |
| [`core/src/main/kotlin/ai/deepseek/dsh/link/LinkContracts.kt`](core/src/main/kotlin/ai/deepseek/dsh/link/LinkContracts.kt) | 生成的契约模型，由 `pnpm run gen-link-contracts` 同步、`verify-link-contracts` 字节门禁 |
| [`core/…/companion/DomainFold.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/DomainFold.kt) | 第 62 章领域状态折叠的 Kotlin 半边：与 TypeScript、Swift 回放同一份一致性 fixtures，折叠结果完全一致 |
| [`core/…/companion/NeumorphicTokens.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/NeumorphicTokens.kt) | 仅简约拟态的视觉基线（第 60 章）：单一风格、双色调浮起表面 |
| [`core/…/link/LinkWire.kt`](core/src/main/kotlin/ai/deepseek/dsh/link/LinkWire.kt) 及同族 | 线缆客户端半边：直通 JSON 值与信封、JDK 提供方的 Ed25519 签名、叶子证书的 SPKI 钉扎、`LinkClient` 的 pair/describe/call/stream——对着真实本地 HTTP 服务器测试 |
| [`core/…/companion/CompanionModels.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/CompanionModels.kt) | 视图模型——会话折叠/发送/取消、交互收件箱、文件浏览、子代理列表——各自驱动 FakeWire 可测的 `WireDriving` 缝 |
| [`app/`](app/src/main/kotlin/ai/deepseek/dsh/companion/MainActivity.kt) | Compose 壳：配对屏、六标签脚手架、来自 core tokens 的简约拟态主题 |
| [`core/src/test/resources/`](core/src/test/resources/) | 测试回放的同步黄金 fixtures、一致性场景与钉扎证书 |

## 构建与测试

[Android Kotlin](../.github/workflows/android-kotlin.yml) 车道在 Ubuntu 上运行 `gradle test` 与 `:app:assembleDebug`（JDK 17、Gradle 8.14、不提交 wrapper、用 runner 的 Android SDK）；本地任何 Gradle 8.14+ 配 JDK 17 工具链加 Android SDK 即可。

## 已知限制与延后工作

- **无生命周期桥的状态持有**——模型暴露 StateFlow，各标签以 `collectAsState` 收集；随打磨轮接入后台感知的 `collectAsStateWithLifecycle`。
- **握手级钉扎延后**——`LinkPinning` 校验叶子证书的 SPKI 指纹，但接入 TLS 握手要随应用模块的 OkHttp 栈到来；此处的 JDK `HttpClient` 不做钉扎。签名私钥本身经 `CredentialsCipher` 缝只在 AndroidKeyStore AES/GCM 封存下落盘。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
