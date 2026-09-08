# Agent Note: 本地运行时支持导出必须使用扫描后的不可变字节

Status: implemented

[English](2026-09-08-local-runtime-support-export.md) | 中文

## Problem

运行时失败可能导致 Web UI 无法打开。原生诊断必须在这种状态下仍可使用，同时不复制凭据、连接地址、原始输出或会话内容。进程成功退出不能证明扫描器检查了最终保存文档，缺失的生产者也不能证明应用健康或权限。

## Decision

[Mac 运行时导出器](../../../../apps/apple/Sources/DirectHostRuntime/RuntimeSupportExporter.swift)获取实际管理器状态与应用级生命周期计数的值快照。重复发布健康状态不会增加转换计数。计数在无符号 32 位表示上限处饱和，并披露饱和状态。产品元数据从应用 bundle 中选择并验证；任意字典字段均不进入编码文档。

导出器准备一个有界 UTF-8 JSON 值，根据保留的标识核验内嵌扫描器与许可证，并在私有临时目录中扫描。默认规则、脱敏及禁用放行注释/忽略文件均显式指定。文档准入前必须先检出并脱敏合成凭据。扫描器退出状态必须与报告内容一致；最终报告缺失、畸形、过大、为链接或包含发现项时均拒绝交付。只有准确的已准入字节才能构造原生 FileDocument。成功交付前完成临时目录清理；清理失败会阻止交付。

现有父管道 [Host 管理器](2026-08-31-macos-direct-host.zh.md)提供独立的固定扫描调用，只允许 canary/export 标签与有界时间。它组装所有扫描参数和路径，不暴露任意 argv 或 shell 命令。取消和超时关闭父管道并等待 helper 退出。应用保留待完成的导出任务，并在正常退出时等待。应用突然终止会在没有 Swift 回调的情况下关闭管道，使 helper 可以回收扫描器进程组。

[候选生产器](../../../../scripts/produce-mac-host.ts)准备固定的扫描器与许可证，验证原生架构和最低系统版本，并在封装应用前分别记录获取时与 ad-hoc 签名后的可执行文件摘要。原生 UI 通过生产对话框保存 ready、stopped 和启动失败文档。[独立验证器](../../../../scripts/release/support_exports.py)拒绝未知字段和矛盾观测，复核签名后的扫描器，并在发布摘要和已准入副本前重新扫描真实保存字节。其准入范围始终只覆盖运行时诊断。

## Alternatives considered

**原始日志脱敏。** 未知消息可能包含新的敏感字段。状态和计数的封闭投影可以阻止这些消息进入序列化。

**仅发布信息的摘要。** 构建标识和 CI 状态不能描述当前已停止或失败的应用。原生操作读取运行中的管理器，且不依赖 Web UI。

**第二个遥测 coordinator。** 其共享 handoff cursor 会影响已有后端，并创建匿名身份。原生生命周期计数不需要会话回放或外部遥测 sink。

**仅应用回调。** 突然终止会绕过 Swift 清理。复用现有父管道 helper 可以扩展其进程组生命周期管理，而不创建另一业务 Gateway 或 Harness 启动器。

## Consequences

连接、协议、角色、capability、更新、原生崩溃记录和会话诊断均明确标为未采集。运行时 ready 描述管理器经过认证的本地 Web 健康观测，不代表 provider 可用或完整发布准入。Windows、原生移动端生产者及移动端离线扫描仍由[完整 Support Bundle 计划](../../../../docs/plans/2026-09-08-support-bundle.zh.md)独立推进。

[源码扫描决策](../process/2026-09-05-candidate-security-scans.zh.md)继续拥有固定获取与源码例外；这些例外不能放行支持导出中的发现项。[产物完整性决策](../process/2026-09-06-candidate-artifact-integrity.zh.md)继续拥有完整 RC 准入。helper 突然终止、detached 工具进程组和 PTY 所有权不属于本导出的清理保证，仍会阻止 Full Host no-orphan 准入。

Swift 所有者本地夹具固定 stopped、ready 和 failed 状态的完整序列化字段。原生测试覆盖污染元数据、真实扫描器准入、报告失败、不可变交付、取消和超时清理。POSIX 测试执行 helper 的固定参数、发现项退出码、强制扫描器关闭及应用突然终止。原生编译和保存对话框行为需要 Apple 与 Mac 候选车道；仅 Windows/Linux 解析器和资源测试不能证明这些结果。
