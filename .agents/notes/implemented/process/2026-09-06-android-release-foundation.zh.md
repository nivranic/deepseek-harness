# Agent Note: 可重复的 Android release 构建输入

Status: implemented

[English](2026-09-06-android-release-foundation.md) | 中文

## Problem

外部提供的 Gradle 版本和 debug APK 不能证明优化后的 release bundle 如何构建。JVM 测试也无法发现 Android SDK 兼容性故障或收缩后缺失的类。

## Decision

[Android 项目](../../../../apps/android/README.zh.md) 提交 Gradle 8.14 wrapper 和官方分发 SHA-256。Android CI 与 Kotlin 安全分析均在 JDK 17 下调用该 wrapper，并安装精确的编译 SDK。编译和目标级别均为 API 36，最低 API 33 保持受支持。[编译器与安全分析决策](2026-09-06-android-codeql-inputs.zh.md) 继续负责 Kotlin/AGP 配对和提取要求。

Release 构建使用 R8、Android 默认优化规则和资源收缩。固定版本的 bundletool 验证生成的 AAB。Workflow 拒绝 JAR 签名条目，并要求非空 R8 mapping，随后保留两个文件及 SHA-256 checksum。上传位于验证成功之后，不使用签名凭据。

Release 签名默认为 `unsigned`。`keystore` 模式接收环境提供的完整文件路径、store 密码、别名和 key 密码。配置阶段拒绝未知模式、不完整输入、非绝对或不可读文件，以及向 unsigned 构建提供签名字段。构建脚本不输出凭据值，也不将其放入进程参数。Gradle 负责实际密钥校验和签名；签名产物仍需独立的证书和安装证据。

## Alternatives considered

- 由 runner 安装 Gradle 会使本地构建依赖未记录的可执行文件。
- Debug 装配没有覆盖 release 构建所执行的收缩和 bundle 路径。
- 未签名 bundle 构建成功不能替代已安装 release 应用或已签名分发的验收。
- 在签名配置不全时回退到 unsigned 输出，会掩盖签名请求失败。

## Consequences

Wrapper 验证下载的分发包，CI 通过 Gradle setup action 检查其 JAR。构建输入已固定，但不承诺产物逐字节可重现。Debug instrumentation、release 设备启动、生产签名、包级 SBOM 和候选 provenance 仍是各自独立的证据要求。R8 mapping 与对应的精确 AAB 一起留存，两者均不自动晋级。

现有候选完整性决策继续有效：[平台验证](2026-09-06-candidate-artifact-integrity.zh.md) 仍要求绑定源码的完整回执。这些 Android 构建产物本身不能满足该回执。
