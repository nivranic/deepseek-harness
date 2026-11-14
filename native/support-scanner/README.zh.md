---
description: "使用固定版本的 Gitleaks 规则扫描不可变移动端支持文档，并核验 Android 构建出处。"
kind: "package-library"
---

# 支持扫描器

[English](README.md) | 中文

## 摘要

原生调用方可在内存中扫描有界诊断文档，并且只能取得获准文档的原始字节。库使用固定版本的 Gitleaks 规则，检查真实 canary，并等待取消完成后才返回。[Android 伴随端](../../apps/android/README.zh.md#local-support-export)消费 JNI 库。此 Go 模块拥有独立的依赖校验和，与 Node 原生 workspace 无关。

## 目录

- [使用库](#use-the-library)
- [验证源码](#verify-the-source)
- [构建 Android 资源](#build-android-resources)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发笔记](#dev-note)

-----

<a id="use-the-library"></a>
## 使用库

`NewOperation` 复制文档并校验字节与时间限制。扫描与等待取消必须在 UI 线程之外执行。只有 `approved` 结果包含字节；交付时必须保持 `Result.Data()` 不变。`Cancel` 等待正在运行的扫描，应用导出器则拥有准入与交付之间的取消。扫描器不能证明文档字段所有权、应用身份或 Host 健康。

<a id="verify-the-source"></a>
## 验证源码

源码门禁需要 Node、Python 3.10 或更高版本，以及 [build.json](build.json) 指定的精确 Go 编译器。执行文件不在 `PATH` 时，使用 `DSH_SCANNER_GO` 与 `DSH_SCANNER_PYTHON` 指定路径。在仓库根目录运行：

```sh
pnpm run test:support-scanner
```

门禁检查自身拒绝控制、Python 源码/产物/构建器测试、Go 模块完整性、Go 行为测试与 `go vet`。缺失测试所有者、测试集为空或全部跳过、Go 编译器不同均会被拒绝。结果单独报告跳过的 Python 测试。`GOPROXY` 可指定公共模块镜像；门禁强制执行 `sum.golang.org` 校验和只读模块解析，不继承绕过校验或替换 workspace/模块的环境设置。此门禁不执行竞态分析，也不构建 AAR。

<a id="build-android-resources"></a>
## 构建 Android 资源

[Python 入口](../../scripts/build-mobile-support-scanner.py)接受以下输入。所指定源码提交必须包含与正在执行的构建器完全一致的文件；未提交的构建器修改不能构建旧源码身份的产物。

| 参数 | 输入 |
|---|---|
| `--source-sha` | 完整的小写 Git 提交 SHA |
| `--go`、`--android-sdk`、`--android-ndk`、`--java-home` | 符合已提交策略与 Java 17 要求的已安装工具链路径 |
| `--cache` | 位于产物目录之外的私有 Go 依赖与编译缓存 |
| `--work-dir`、`--output` | 新建且彼此独立的工作目录和产物目录 |
| `--module-proxy` | 可选的不含凭据的 HTTPS 依赖代理；默认 `https://proxy.golang.org` |

构建器通过私有模块代理物化已提交的扫描器字节，并对照 Git 核验。选择其他 HTTPS 代理时，外部模块仍保留校验数据库验证。写入 AAR 与回执前，构建器核验两个 JNI 架构、16 KiB ELF 对齐、生成的 Java 入口、R8 规则、原生模块身份、私有路径排除和许可证材料。工具输出保留在私有工作目录。`BUILT` 回执描述静态打包结果，不证明已安装执行或同候选应用验收。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

库使用私有配置实例解析嵌入的上游规则，并在隔离的 Go runtime 中关闭扫描器日志。环境配置与行内允许注释不能豁免发现。Canary 与文档扫描使用独立检测器。由于被中断的检测器可能返回部分发现，检测结束后仍会检查取消。[构建出处决策](../../.agents/notes/implemented/process/2026-09-27-native-scanner-source-and-build-provenance.zh.md)拥有源码身份与验证策略。

</details>

<a id="model-experience"></a>
## 模型体验

无。库只准入本地诊断字节。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

文档获准只表示固定版本规则未报告发现；生产者的隐私规则仍不可少。超时会拒绝准入，但不能中断一次正则表达式调用，因此取消必须等待有界扫描结束。库在隔离的 Go runtime 中拥有 Gitleaks 日志与配置；其他 Go 消费方不得重新配置该共享状态。

源码检查不能验收当前提交的 AAR、可复现应用构建、原生取消、发布签名、物理设备、16 KiB 设备或 Apple 绑定。Android 构建配置记录其当前消费的外部扫描器；替换产物需要单独核验的构建与已安装应用证据。Windows 源码门禁将不支持的目录符号链接测试报告为跳过。竞态和可达依赖漏洞分析需要另外执行。

<a id="dev-note"></a>
### 开发笔记

无。
