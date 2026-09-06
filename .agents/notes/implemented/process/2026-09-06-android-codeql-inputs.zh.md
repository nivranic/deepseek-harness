# Agent Note: 对齐 Android 编译输入并保留显式通知目标

Status: implemented

[English](2026-09-06-android-codeql-inputs.md) | 中文

## Problem

CodeQL 2.26.4 无法使用实际解析的 Kotlin 标准库提取通知中的 `MainActivity::class.java` intrinsic。早于该标准库的 Kotlin 编译器还会在共享传输代码中留下提取错误。Gradle 编译成功本身不能证明安全分析完整。

## Decision

[Android 构建](../../../../apps/android/build.gradle.kts) 将 JVM、Android 和 Compose Kotlin 插件与 Kotlin 标准库统一为 2.2.21，并使用 AGP 8.10.1。该配对遵循 [Android Kotlin 支持表](https://developer.android.com/build/kotlin-support)；[AGP 8.10](https://developer.android.com/build/releases/past-releases/agp-8-10-0-release-notes) 要求 JDK 17 与 Gradle 8.11.1 或更新版本，因此现有 Gradle 8.14 runner 仍受支持。

[PushNotifications](../../../../apps/android/app/src/main/kotlin/ai/deepseek/dsh/companion/PushNotifications.kt) 使用公开的 `javaObjectType` 映射。`MainActivity` 是引用类，因此它与 `java` 返回相同的 Activity 类。`Intent(Context, Class)` 构造器仍选择显式 component，PendingIntent 保留 `FLAG_IMMUTABLE` 和 `FLAG_UPDATE_CURRENT`。

[通知 instrumentation](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/PushNotificationTargetTest.kt) 检查已经发布的 Android 通知，并使用原 `MainActivity::class.java` 映射查询其已有 immutable PendingIntent。不同 component 必须没有匹配的 token。测试清理自己的通知而不点击它们。

## Alternatives considered

- 仅对齐编译器仍留下通知 intrinsic 提取错误。
- 硬编码 component 类名会失去编译器检查的引用。
- Suppress 发现项或忽略提取诊断不能证明分析完整。

## Consequences

Android main 源码选择与 security-extended 查询集保持完整。必须在编译成功之外单独检查提取诊断；其余安全发现项仍需遵循[候选扫描策略](2026-09-05-candidate-security-scans.zh.md) 修复或提供审查证据。本决策不豁免 Noise 密码学发现项。
