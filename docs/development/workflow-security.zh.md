# Workflow 依赖、token 与源码策略

[English](workflow-security.md) | 中文

## Summary

GitHub Actions workflow 使用已记录的上游 commit SHA、显式 token 权限和源码回执。Static 与 hygiene 检查验证 workflow 策略及生成的 required-check metadata。[安全扫描](security-scanning.zh.md)、产物完整性与生产发布审批分别由其他所有者负责。

## Table of Contents

- [不可变 Action 引用](#immutable-action-references)
- [Token 权限](#token-permissions)
- [候选源码证据](#candidate-source-evidence)
- [验证与限制](#validation-and-limits)
- [Dev Note](#dev-note)

-----

<a id="immutable-action-references"></a>
## 不可变 Action 引用

[action-pins.json](../../release/action-pins.json) 记录每个选定 Action、请求的 revision、所属仓库和核验后的完整 commit SHA。Workflow `uses` 字段消费这些 SHA，注释保留可读版本。可变 tag、短 SHA 或未登记的完整 SHA 均无法通过验证。更新固定版本时，必须在 Action 所属仓库核验，并同时审查 registry 与消费者的修改。

本地 reusable workflow 解析到 `.github/workflows` 下的现有文件，验证器也会检查这些文件。外部 reusable workflow 与 step Action 遵循相同的已登记 SHA 规则。已检查的必要文件清单拒绝空集合或被缩减的 workflow 集合。

-----

<a id="token-permissions"></a>
## Token 权限

Workflow 默认权限是只含 `read` 或 `none` 的显式映射。Job 未自行声明映射时继承默认权限。可写 job 必须精确匹配 [workflow-security.json](../../release/workflow-security.json) 中记录的权限集合和 environment，并保留例外理由。缺失、扩张或未使用的例外均验证失败。Checkout step 设置 `persist-credentials: false`。

现有 preview job 拥有其 PR 写权限。现有受保护发布 job 保留命名 environment 和最小 OIDC 或 Pages 权限。此策略不启用 workflow、不派发 job、不修改 branch protection、不授予 registry 访问，也不授权发布。GitHub App 与外部服务凭证继续保留各自的 scope 和审批所有者。

-----

<a id="candidate-source-evidence"></a>
## 候选源码证据

[required-checks.generated.json](../../release/required-checks.generated.json) 从 workflow 所有者派生 CI aggregate 依赖和 Apple/Android 必要 verdict。`pnpm run gen-required-checks` 刷新生成物；`pnpm run verify-required-checks` 在 static 与 hygiene 检查中拒绝 drift。CI aggregate 继续拥有其依赖的 verdict，独立 Windows coverage 和 observational 结果分别保留。

每个源码 producer job 在 immutable install 后、验证前运行 [write-ci-source.ts](../../scripts/write-ci-source.ts)，并把 `source.json` 保留为 `ci-source-<runId>-<attempt>`。回执包含 candidate、实际 checkout、Git tree 与 parents、workflow digest、run/attempt/event 和 dirty 标记。Checkout 输入变化使 job 失败。回执不含 author、workspace path、credential 或业务 payload。

[求值器](../../scripts/release/ci-evidence.ts) 选择最新 run，要求必要 job 成功，并把源码 metadata 绑定到 producer 的实际执行 attempt。它拒绝缺失或不匹配的证据、dirty 或不同 tree、无关 commit，以及 workflow 之间不一致的执行 SHA。待完成的必要 job 保持 pending。

在 PATH 中提供已认证的 GitHub CLI，再运行 `pnpm run collect-ci-evidence --repo owner/repository --sha <full-sha> --output <evidence.json>`。[收集器](../../scripts/release/ci-collector.ts) 读取该不可变候选的 workflow 定义，分页读取 runs/jobs/artifacts，并通过 Git commit API 独立核验上传的 tree 与 parent 字段。局部重跑可能复制成功 job 并分配新的 ID 和 attempt：匹配 runner、执行时间和全部 step 结果，才能识别拥有源码 artifact 的原始执行。实际重新执行的 producer 不能复用旧回执。

返回前，收集器再次检查最新 run、job verdict 和 artifact identity。发生变化则收集失败，必须重新调用。输出分别保留源码文件 SHA-256 和 GitHub 报告的压缩包 digest；CLI 不独立计算下载 ZIP 的摘要。收集失败会使原 PASS 文件失效，FAIL 或 PENDING 返回非零退出码。收集操作只读，不配置 branch protection，也不把未签名回执认证为 provenance。

-----

<a id="validation-and-limits"></a>
## 验证与限制

在仓库根目录运行：

```sh
pnpm run verify-workflow-security
```

验证器解析 YAML 的 job 与 step 字段，不在任意文本中搜索 `uses`。它拒绝畸形 workflow/policy 输入，报告违规项且不修改文件。Static 与 hygiene 聚合执行同一入口；聚焦测试通过可执行文件验证接纳和拒绝输入。

已记录 SHA 固定的是选定 Action revision。它不审计 Action 源码、不固定 Action 发起的传递下载、不冻结 hosted runner image，也不建立产物 provenance。离线验证器检查输入与已审查 registry 的一致性，不重复上游 GitHub 查询。依赖扫描、SBOM 生成、secret scanning、签名和候选晋级仍需额外证据。

-----

<a id="dev-note"></a>
## Dev Note

[CI 源码证据决策](../../.agents/notes/implemented/process/2026-09-05-ci-source-evidence.zh.md) 记录 candidate 与 producer attempt 的所有权。

[Workflow 安全决策](../../.agents/notes/implemented/process/2026-09-05-workflow-security.zh.md) 记录所有权和取舍。[GitHub 安全使用参考](https://docs.github.com/en/actions/reference/security/secure-use) 说明不可变 Action 引用及 job 级权限增加。
