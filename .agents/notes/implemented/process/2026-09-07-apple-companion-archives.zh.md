# Agent Note: Apple Companion 归档证据

Status: implemented

[English](2026-09-07-apple-companion-archives.md) | 中文

## Problem

模拟器构建成功不能标识供分发的设备可执行文件。Mac Direct Host 目标也缺少内嵌运行时，因此归档其外壳不能证明 Full 运行时候选成立。

## Decision

[归档 workflow](../../../../.github/workflows/apple-archives.yml) 选择精确的干净提交，并按 Release 配置归档现有 iOS 设备及通用 macOS Companion scheme。Xcode 签名被禁用，内嵌 provisioning profile 被拒绝。仓库拥有的产品标识、归档元数据、可执行文件平台加载命令与架构集合必须一致。保留的 ZIP 会被解压，其普通文件字节、Unix 权限与内部符号链接必须匹配原始归档清单。

归档报告绑定源码、生产器输入、工具链及文件摘要，但与已验证的 [RC 平台回执](2026-09-06-candidate-artifact-integrity.zh.md) 明确区分。该报告不包含启动、分发导出或 Full 运行时生产。iOS 模拟器不能替代设备归档的启动验证。这些检查扩展了[应用发布标识](2026-09-05-product-release-identity.zh.md)和 [Xcode 外壳装配](../architecture/2026-08-30-xcode-app-shells.zh.md)；这些决策仍拥有各自职责。[Direct Host 隔离决策](../architecture/2026-08-31-macos-direct-host.zh.md)仍约束其目标。

## Alternatives considered

Python 标准库 `plistlib` 读取 XML 和二进制归档元数据，包括 JSON 无法表示的日期。只有 `ApplicationProperties` 被投影为 JSON；原始 plist 字节仍保留在归档清单中。读取器不通过 `plutil` 转换整个归档 plist。

- 将模拟器 App 用作设备归档，会把验收绑定到不同的可执行平台。
- 把 Direct Host 外壳列为 Full 产物，会宣称其目标尚未包含的运行时功能。
- 为获得归档而加入签名凭据，会将构建验证耦合到外部生产操作。归档生成既不需要签名秘密，也不需要商店访问；链接器产生的 ad hoc 代码签名不属于生产签名。

## Consequences

独立 workflow 可暴露归档故障，运行时监督、签名安装与完整 RC 生产器仍作为独立工作推进。其 GitHub 只读权限与构建成功后上传条件不授予分发权限。实际归档验收依赖 macOS/Xcode 执行；解析器与文件系统拒绝测试可在其他宿主运行，其中 POSIX 符号链接在 Linux 和 macOS 验证。SBOM 归属、扩展属性、签名设备启动及 Full 运行时不属于该归档清单的验证范围。
