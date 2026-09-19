# Agent Note: Android core 与 app 模块迁入契约构建

Status: implemented

[English](2026-09-19-android-core-app-migration.md) | 中文

## 问题

Upstream-First 的 Android 线在新 `apps/android` Gradle 构建上只有 `contract` 模块（Kotlin 失败分类列）。历史 companion 实现——23 个 `core` 领域文件、23 个 `core` 测试类、10 个 `app` 外壳文件——仍在旧的 `android-application-source` 工作树里，Phase 10 的"在新契约上落薄壳"没有可依赖的迁移表面。

## 当前上游边界

历史工作树以自己的 `dsh-android-companion` 根构建 `:core` 与 `:app`，从不消费共享 Remote 失败词汇表；新树有词汇表却没有外壳。两棵树单独都无法产出经契约分类 Gateway 失败的设备构建。

## 决策

把 `core` 与 `app` 模块原样迁入 `apps/android`，而不是重写：领域代码（Lite 折叠、Link/Noise 栈、handoff、支持导出、诊断）行为完整且带有测试语料；Upstream-First 方案的平台立场是共享契约上的薄设备壳，不是重实现。`settings.gradle.kts` 以 `:contract`、`:core`、`:app` 组合，两个仓库块都加入 `google()`；根 `build.gradle.kts` 以 `apply false` 声明 Android 插件（Kotlin 2.2.21、AGP 8.10.1、Compose 插件），与历史树一致。`product-version.properties` 原样迁入；app 模块仍从中读取版本身份。

## 备选方案

立即按新契约重写领域折叠被否决：把迁移正确性与重新设计耦合成双重风险，并废弃 23 个通过的测试类。等扫描器链就绪再迁移被否决：`:core` 是纯 JVM，现在就可独立验证。

## 契约

在 `apps/android` 下 `gradlew :contract:test :core:test` 在 JVM 上运行契约 schema 测试与迁入的领域测试（不需要 Android SDK）。`:app` 用 Android SDK（`ANDROID_HOME`）完成配置；`:app:assembleDebug` 由 `verifyScannerResources` 门禁——需要支持扫描器 AAR（从 `native/support-scanner` 经 Go + NDK 构建）及其回执，通过 `DSH_ANDROID_SCANNER_DIRECTORY`/`DSH_ANDROID_SCANNER_SOURCE` 传入。该门禁是历史供应链控制，原样保留。

## 持久化

无 Session 或存储改动。`core` 在本构建上不持有设备端持久状态；其 stores 与导出代码仅在 JVM 测试中运行。

## 安全

扫描器门禁、签名模式规则（`DSH_ANDROID_SIGNING_*`）与应用来源/树 SHA 占位符从历史模块原样迁入。未新增任何 keystore 材料、凭据或遥测路径。

## 兼容性

Kotlin 2.2.21 与 Gradle 8.14 与历史构建一致；契约模块的 Kotlin/JVM 工具链（17）不变。迁入模块尚未消费 `:contract`——分类接线随 Gateway 接线增量落地。

## 失败处理

`:core:test` 失败是普通领域回归。缺扫描器环境时 `:app:assembleDebug` 在 `verifyScannerResources` 失败并报 "Cannot query the value of this provider because it has no value available"——这是设计内的大声失败，不是迁移缺陷。

## 测试

本机（Windows 宿主，Android SDK 在 `E:/Android_Studio_SDK`）：`gradlew.bat :core:test` —— BUILD SUCCESSFUL，37 个测试类；`gradlew.bat :app:tasks --all` —— 配置成功解析 AGP 8.10.1 与 Compose 插件；`gradlew.bat :app:assembleDebug` —— 恰好在扫描器门禁失败，记录于 `.artifacts/android-app-assemble.log`。

## 推行

仅源码树；未发布产物。模拟器/设备 lane 与扫描器 AAR 构建在后续增量落地。

## 回滚

移除 `include(":core")`/`include(":app")` 与 Android 插件声明；删除 `apps/android/core`、`apps/android/app`、`apps/android/gradle.properties`、`apps/android/product-version.properties`。

## 后果

Android 线现在在新构建上拥有完整模块拓扑，扫描器 AAR 链是"源码迁入"到"外壳编译 + 安装"之间的唯一门禁。分类镜像保持仅在 contract 模块，直到外壳的 Gateway 接线消费它。
