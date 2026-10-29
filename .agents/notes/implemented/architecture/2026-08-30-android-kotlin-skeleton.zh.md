# Agent Note: Android Kotlin 骨架与车道

Status: implemented

[English](2026-08-30-android-kotlin-skeleton.md) | 中文

## 问题

第 62 章的一致性承诺点名三种语言，但 Kotlin 腿只以 `generated/` 下的生成文本存在——从未编译、从未测试，且带着从未被消费者抓到的生成缺陷。第 52 章的 Android 伴侣则完全没有模块。

## 决策

`apps/android` 以 Gradle 工程开张，唯一模块 `core` 是纯 JVM Kotlin：契约模型由漂移门禁同步（`gen-link-contracts`/`verify-link-contracts` 扩展了 `apps/android/core` 下的 Kotlin 源、fixture 与一致性目的地）；Kotlin 领域状态折叠逐字镜像 TypeScript 参考与 Swift 折叠——同样的逐标签中文摘要、同样的整型数字去 `.0` 渲染、同样的图片收集与工具配对——并回放每一份黄金场景；`NeumorphicTokens` 以纯常量钉住第 60 章仅简约拟态的视觉基线，供未来的 Compose 模块读取。解码用 kotlinx-serialization 的无注解 `JsonElement` 树解析，运行时 jar 无需编译插件，生成模型保持纯净。车道（`android-kotlin.yml`）在 ubuntu-latest 上以 JDK 17 / Gradle 8.14 运行 `gradle test`，不提交 wrapper。

## 后果

生成 Kotlin 的首个消费者抓到两个字节门禁永远看不见的发射缺陷：枚举成员之间缺逗号；const 字段的尾注释吞掉随其后的分隔逗号——这段文本从未解析成功过。修复后车道全绿：四份一致性场景折叠一致，第 62 章的三语言保证（TypeScript、Swift、Kotlin——同 fixtures、同领域状态）三条腿全部机器验证。Compose 界面随后在 `core` 之上生长。

## 考虑过的替代方案

发射 `@Serializable` 注解被否决——它会把生成模型的每个消费者绑到序列化编译插件上，而折叠并不需要。提交 Gradle wrapper 被否决——setup-gradle action 固定并缓存版本，评审里不进二进制 jar。
