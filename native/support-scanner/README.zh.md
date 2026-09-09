---
description: "使用固定的 Gitleaks 规则准入不可变本地支持文档，并在取消时等待扫描结束。"
kind: "package-library"
---

# Support scanner

[English](README.md) | 中文

## Summary

调用者可以完全在内存中扫描一个有界诊断文档，并且只取得已准入的准确字节。每个操作先检查真实 canary，再使用固定的 Gitleaks 默认规则扫描文档。取消会等待扫描结束并拒绝部分结果。Swift/Kotlin 绑定与移动应用导出操作需要分别接入。

## Table of Contents

- [使用库](#use-the-library)
- [理解实现](#understand-the-implementation)
- [验证](#verification)
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
```

[CI 工作流](../../.github/workflows/ci.yml)要求扫描器竞争检测和 Go CodeQL 分析。未解决的发现和不完整的提取均由共享[安全证据验证器](../../scripts/release/security_evidence.py)拒绝验收。

## Model Experience

无。该库准入本地诊断字节。

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- 移动应用尚未内嵌此库，也未通过它提供支持导出操作。Go 测试不能证明 Android/iOS 绑定、原生取消、打包或保存字节行为。
- 已准入只表示固定默认规则未报告发现。生产者字段选择与应用标识仍是独立要求。
- 库在隔离 Go 运行时中拥有 Gitleaks 日志与配置。其他 Go 消费方不得重新配置该上游共享状态。
- 期限会拒绝准入，但不会中断单次正则调用；只有有界扫描停止后，取消才返回。

### Dev Note

<details>
<summary>维护者工作上下文</summary>

无。

</details>
