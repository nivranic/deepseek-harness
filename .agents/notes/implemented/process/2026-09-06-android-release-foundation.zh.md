# Agent Note: 可重复的 Android release 构建输入

Status: implemented

[English](2026-09-06-android-release-foundation.md) | 中文

## Problem

外部提供的 Gradle 版本和 debug APK 不能证明优化后的 release bundle 如何构建。JVM 测试也无法发现 Android SDK 兼容性故障或收缩后缺失的类。

## Decision

[Android 项目](../../../../apps/android/README.zh.md) 提交 Gradle 8.14 wrapper 和官方分发 SHA-256。Android CI 与 Kotlin 安全分析均在 JDK 17 下调用该 wrapper，并安装精确的编译 SDK。编译和目标级别均为 API 36，最低 API 33 保持受支持。[编译器与安全分析决策](2026-09-06-android-codeql-inputs.zh.md) 继续负责 Kotlin/AGP 配对和提取要求。

Release 构建使用 R8、Android 默认优化规则和资源收缩。固定版本的 bundletool 验证生成的 AAB。Workflow 拒绝 JAR 签名条目，并要求非空 R8 mapping，随后保留两个文件及 SHA-256 checksum。上传位于验证成功之后，不使用签名凭据。

Release 签名默认为 `unsigned`。`keystore` 模式接收环境提供的完整文件路径、store 密码、别名和 key 密码。配置阶段拒绝未知模式、不完整输入、非绝对或不可读文件，以及向 unsigned 构建提供签名字段。构建脚本不输出凭据值，也不将其放入进程参数。Gradle 负责实际密钥校验和签名；签名产物仍需独立的证书和安装证据。

[AAB 清单扫描器](../../../../scripts/release/android_sbom.py) 调用项目的 AGP protobuf 读取器解析实际 bundle。内嵌产物摘要选择精确的 Maven 输入，POM 继承提供许可证声明。每个打包文件都有摘要，原生库要求精确的 AAR 归属，已验证的 R8 mapping 与 DEX marker 将类绑定到 Maven/项目输入或类级合成记录。原样 Java 类资源也必须匹配其 Maven 字节。重新验证会重复输入收集，并比较完整的 CycloneDX 文档和清单回执。编译器/扫描器身份及证据不依赖宿主绝对路径；输出目录只能新建。

[候选生产者](../../../../docs/development/release-candidate.zh.md#android-production) 从留存的 unsigned AAB 派生可安装的 release APK，避免另行重建签名 release。DEX 与 native 摘要必须一致，生成的公开证书标识仅用于临时模拟器的密钥。原生库对齐、真实设备运行时、配对 UI、已安装字节与完整卸载均为必需观察。Hosted runner 保护排除持久开发设备；私有文件删除后才写入成功证据。实际 workflow 全集共同检查 action 修订与上游固定版本登记。

## Alternatives considered

扫描器在计算工具摘要前解析操作者选定的绝对 Java 与 Android SDK 路径，与 Node 可执行文件的解析一致。工具链管理器可以通过别名提供这些位置。Bundle、mapping、Maven 缓存与项目类输入仍拒绝链接；统一解析所有输入会丢失这一区别。

- 由 runner 安装 Gradle 会使本地构建依赖未记录的可执行文件。
- Debug 装配没有覆盖 release 构建所执行的收缩和 bundle 路径。
- 未签名 bundle 构建成功不能替代已安装 release 应用或已签名分发的验收。
- 在签名配置不全时回退到 unsigned 输出，会掩盖签名请求失败。
- 单独的 Gradle 解析报告不能证明打包文件字节、转换后的类归属或留存的 R8 mapping。只计算非空 SBOM 组件数量不能证明清单完整。

## Consequences

首屏验证选择 Google 的 API 36 `google_apis_ps16k` x86_64 镜像，并在启动 instrumentation 前读取运行设备的 `ro.build.version.sdk` 与 `getconf PAGE_SIZE`。固定的 emulator action 接受该 16 KiB 镜像标识；Google SDK 索引中存在该镜像，并不能单独证明 action 的输入验证支持它。镜像名称或编译成功不能证明设备的 API 与页大小。观察器拒绝不匹配和查询失败，仅保留设备数值属性，并拒绝覆盖已有回执。Workflow 测试执行实际启动命令，证明 API 35、4 KiB 页或 adb 失败都会阻止 instrumentation。这份 debug 首屏证据与 release 安装和原生库对齐验证仍分别验收。

Wrapper 验证下载的分发包，CI 通过 Gradle setup action 检查其 JAR。构建输入已固定，但不承诺产物逐字节可重现。Debug instrumentation、release 设备启动、生产签名、包级 SBOM 和候选 provenance 仍是各自独立的证据要求。R8 mapping 与对应的精确 AAB 一起留存，两者均不自动晋级。

现有候选完整性决策继续有效：[平台验证](2026-09-06-candidate-artifact-integrity.zh.md) 要求绑定源码的完整回执。Android 生产者仅在实际打包、清单与设备观察均成功后装配该回执。合成拒绝测试和本地 AAB 检查不能替代 hosted 设备验收或完整四平台候选。

扫描器测试覆盖损坏的内嵌元数据、依赖图与许可证故障、原生库/类资源变更、mapping 完整性和证据遗漏。实际 release 测试通过 AGP、R8、dexdump 及完整的 CycloneDX 1.6 schema 生成并重验 bundle 清单。仅支持 base 模块、对转换资源仅做文件级摘要仍是明确限制；扫描器不会根据文件名推断法律许可或资源输入归属。
