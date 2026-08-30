# DSH Android 伴侣

[English](README.md) | 中文

Android 伴侣（原生化方案第 52、60 章）：`core` 今天是纯 JVM 领域模块，Compose 界面随后在其上生长。

## 目录

| 路径 | 是什么 |
| --- | --- |
| [`core/src/main/kotlin/ai/deepseek/dsh/link/LinkContracts.kt`](core/src/main/kotlin/ai/deepseek/dsh/link/LinkContracts.kt) | 生成的契约模型，由 `pnpm run gen-link-contracts` 同步、`verify-link-contracts` 字节门禁 |
| [`core/…/companion/DomainFold.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/DomainFold.kt) | 第 62 章领域状态折叠的 Kotlin 半边：与 TypeScript、Swift 回放同一份一致性 fixtures，折叠结果完全一致 |
| [`core/…/companion/NeumorphicTokens.kt`](core/src/main/kotlin/ai/deepseek/dsh/companion/NeumorphicTokens.kt) | 仅简约拟态的视觉基线（第 60 章）：单一风格、双色调浮起表面 |
| [`core/src/test/resources/`](core/src/test/resources/) | 测试回放的同步黄金 fixtures 与一致性场景 |

## 构建与测试

[Android Kotlin](../.github/workflows/android-kotlin.yml) 车道在 Ubuntu 上运行 `gradle test`（JDK 17、Gradle 8.14、不提交 wrapper）；本地任何 Gradle 8.14+ 配 JDK 17 工具链即可。

## 已知限制与延后工作

- **尚无应用模块**——`core` 之上的 Compose 界面随伴侣面到来；视觉基线目前只是 tokens。
- **仅 JsonElement 解码**——生成模型不带序列化注解；折叠层手工解析 JSON 树，完整线缆客户端随 Compose 模块到来。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
