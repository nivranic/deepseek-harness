---
description: "使用固定的 Gitleaks 规则准入不可变本地支持文档，并在取消时等待扫描结束。"
kind: "package-library"
---

# Support scanner

[English](README.md) | 中文

## Summary

调用者可以完全在内存中扫描一个有界诊断文档，并且只取得已准入的准确字节。每个操作先检查真实 canary，再使用固定的 Gitleaks 默认规则扫描文档。取消会等待扫描结束并拒绝部分结果。[Android companion](../../apps/android/README.zh.md#local-support-export)消费 JNI 库；Swift 绑定仍需独立接入。

## Table of Contents

- [使用库](#use-the-library)
- [理解实现](#understand-the-implementation)
- [验证](#verification)
- [构建 Android 资源](#build-android-resources)
- [构建 Apple 资源](#build-apple-resources)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-the-library"></a>
## 使用库

[NewOperation](scanner.go) 复制输入并验证调用者提供的字节与时间限制。在 UI 线程之外运行操作；只有 `approved` 结果提供文档字节及其摘要。任何拒绝都表示没有可用输出。`Cancel` 等待运行中的操作结束，而扫描完成后、交付前的取消由原生导出器负责。

生产者必须在准入前序列化全部文档字段，并原样交付 `Result.Data()`。扫描器不验证诊断字段归属，也不证明应用健康。[Support Bundle 计划](../../docs/plans/2026-09-08-support-bundle.zh.md)定义这些生产者与平台要求。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

库通过独立配置解析器编译内嵌上游规则，并在其隔离 Go 运行时中禁用扫描器日志。源码审阅例外与行内放行注释不能豁免文档发现。Canary 与最终文档使用独立 detector；由于上游 API 可能无错误地返回部分发现，操作会在检测结束后检查取消状态。[导出决策](../../.agents/notes/implemented/architecture/2026-09-08-local-runtime-support-export.zh.md)负责隐私与生命周期理由。

</details>

<a id="verification"></a>
## 验证

使用 Go 1.27.1 和受支持的 C 编译器，在此目录运行：

```sh
go mod verify
go test -race -count=1 -timeout=60s -v ./...
go vet ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 ./...
```

[CI 工作流](../../.github/workflows/ci.yml)要求扫描器竞争检测、Go CodeQL 分析和可达依赖漏洞检查。未解决的 CodeQL 发现和不完整的提取均由共享[安全证据验证器](../../scripts/release/security_evidence.py)拒绝验收。Govulncheck 拒绝从本库可达的脆弱调用；模块级提示本身不证明调用路径。安全修复后的依赖要求模块使用 Go 1.26 或更高版本。

<a id="build-android-resources"></a>
## 构建 Android 资源

[Python 构建入口](../../scripts/build-mobile-support-scanner.py)使用 [build.json](build.json) 中的工具版本生成 AAR 和 `scanner.json`。在仓库根目录使用 Python 3.10 或更高版本运行。源码提交必须包含与正在运行的构建器完全相同的文件；已编辑或未提交的构建器不能为旧提交生成资源。

| 参数 | 必需输入 |
|---|---|
| `--source-sha` | 完整小写 Git commit SHA |
| `--go` | 固定 Go 可执行文件的绝对路径 |
| `--android-sdk`、`--android-ndk`、`--java-home` | 已安装的 SDK、固定 NDK 和 Java 17 目录 |
| `--cache` | 私有 Go 模块与编译缓存目录 |
| `--work-dir`、`--output` | 新建且相互分离的工作与产物目录；产物目录不能包含缓存 |

构建将已提交的扫描器文件读入带版本的本地模块代理，并将下载后的源码字节与 Git 比较。外部模块继续由 Go 校验和数据库验证。两个 JNI 库保留模块版本与校验和，排除从构建目录推断的 VCS 标识，并通过 ELF 架构和 16 KiB 对齐检查。R8 保留规则保护生成的 Java 入口。AAR 的 `assets/dsh-support-scanner/` 包含源码与模块清单、模块许可证、Go 许可证及 NDK 声明；归档顺序和时间戳统一规范化。

[移动扫描器工作流](../../.github/workflows/mobile-support-scanner.yml)在 Linux 上构建这些资源，并在上传前对两个原生库运行 govulncheck。库保留原生符号表以支持包与符号分析；消费方组装应用时必须保留这些字节。其 `BUILT` 回执证明静态打包检查通过。原生执行、应用接入和实际 16 KiB 页设备验收仍是独立要求。

<a id="build-apple-resources"></a>
## 构建 Apple 资源

[Apple 构建入口](../../scripts/build-apple-support-scanner.py)复用相同的 Go/gomobile 版本与源码检查，并使用 [apple-build.json](apple-build.json) 中的 Xcode/部署标识。它要求 macOS，以及显式的 `--source-sha`、`--go`、`--developer-dir`、`--cache`、`--work-dir` 和 `--output` 输入。工作与输出目录必须新建且相互分离；缓存必须位于产物目录之外。编译输出、framework 布局和校验异常保留在私有工作日志中；公开失败信息不包含诊断细节。

输出 ZIP 包含 `SupportScanner.xcframework`、源码/模块清单与许可证。对于 iOS 设备 arm64、模拟器 arm64/x86_64 和 macOS arm64/x86_64，生产者移除 universal 容器，并将准确的归档切片强制链接到最小检查程序。Go 的可执行文件读取器检查各架构链接后的模块图；manifest 保留归档、Go object 和检查程序摘要。每项索引必须声明准确的平台二进制路径；只准入生成的 Mac framework 版本链接。静态 framework 的 plist 版本属于规范化包元数据；不可变源码标识由 manifest 拥有。Apple SDK 是构建输入，不作为内容重新分发。

[原生验证器](../../scripts/verify-apple-support-scanner.py)比较归档字节与编译使用的 framework，在 macOS 和自有 iOS 模拟器上执行 Swift 绑定探针，并记录已链接二进制摘要。工作流在发布库前检查这些已链接二进制的漏洞。库的 `BUILT` 状态不能证明原生执行或应用导出；验收顺序由 [Apple 接入计划](../../docs/plans/2026-09-10-apple-support-scanner.zh.md)拥有。

## Model Experience

无。该库准入本地诊断字节。

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Apple 应用尚未内嵌此库，也未通过它提供支持导出操作。Android 消费方的采集缺口见其[导出约定](../../apps/android/README.zh.md#local-support-export)。Go 测试不能证明 Android/iOS 绑定、原生取消、打包或保存字节行为。
- 已准入只表示固定默认规则未报告发现。生产者字段选择与应用标识仍是独立要求。
- 库在隔离 Go 运行时中拥有 Gitleaks 日志与配置。其他 Go 消费方不得重新配置该上游共享状态。
- 期限会拒绝准入，但不会中断单次正则调用；只有有界扫描停止后，取消才返回。

### Dev Note

<details>
<summary>维护者工作上下文</summary>

无。

</details>
