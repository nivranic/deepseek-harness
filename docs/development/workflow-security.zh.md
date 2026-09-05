# Workflow 依赖与 token 策略

[English](workflow-security.md) | 中文

## Summary

GitHub Actions workflow 使用已记录的上游 commit SHA 和显式 token 权限。仓库验证器检查每个 workflow，包括本地 reusable callee，然后 static 与 hygiene 检查才接受候选。本参考覆盖 Action 引用和 `GITHUB_TOKEN`；scanner、产物完整性与生产发布审批分别由其他所有者负责。

## Table of Contents

- [不可变 Action 引用](#immutable-action-references)
- [Token 权限](#token-permissions)
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

[Workflow 安全决策](../../.agents/notes/implemented/process/2026-09-05-workflow-security.zh.md) 记录所有权和取舍。[GitHub 安全使用参考](https://docs.github.com/en/actions/reference/security/secure-use) 说明不可变 Action 引用及 job 级权限增加。
