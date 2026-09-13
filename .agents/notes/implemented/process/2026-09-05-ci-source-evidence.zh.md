# Agent Note: 候选检查与实际 CI 源码回执

Status: implemented

[English](2026-09-05-ci-source-evidence.md) | 中文

## 问题

Workflow 的候选 `head_sha` 不代表实际执行的 PR merge checkout。旧 attempt 的成功或包含可选 job 的 workflow 级结果，也不能证明当前必要检查通过。

## 决策

必要检查从现有 CI aggregate 与 native workflow 所有者派生。源码 producer job 在验证前记录实际 checkout、tree、原始 Git parents、workflow digest、candidate 和 producer attempt。原始 commit header 在 shallow checkout 中仍保留 parent identity。回执只保留源码与执行 metadata。

求值器要求当前必要 verdict 和一致的干净源码回执。收集器通过历史 runner、时间和 step 相等性解析 source producer 的实际执行 attempt，因为 GitHub 可能把未重新执行的 job 复制到局部重跑并赋予新 job ID 和 attempt。实际重新执行的 producer 必须提供自己的回执。旧 PASS 不能替代更新的失败。[参考文档](../../../../docs/development/workflow-security.zh.md#candidate-source-evidence) 拥有命令与字段说明。[Workflow 权限](2026-09-05-workflow-security.zh.md)、[串行 CI 参考](2026-07-21-serial-cross-platform-ci-reference.zh.md) 和 [failover](2026-07-26-ci-failover-runbook.zh.md) 保留独立职责。

## 考虑过的替代方案

- 只使用 workflow `head_sha` 会遗漏实际 merge checkout 及其 tree。
- 要求回执 attempt 等于 workflow 的最新 attempt，会拒绝有效的局部重跑。
- 重新实现 CI job matrix 会重复 aggregate 所有者；独立观测结果继续与该 verdict 分开。

## 后果

Workflow 修改后必须重新生成 required-check 投影。缺失或过期回执不能产生 PASS。离线拒绝 fixture 覆盖 identity、attempt、必要 job 与源码 drift；Git fixture 覆盖 shallow parents 和 dirty 输入。在线收集器分页读取全部结果，核验 Git metadata，并在准入前复查最新 run、job 和 artifact identity。刷新失败会使旧输出失效。源码文件摘要与 GitHub 报告的 ZIP digest 分别保留；传输层委托受维护的 GitHub CLI 解压 ZIP。回执是未签名观测，不证明认证 provenance 或 branch protection。
