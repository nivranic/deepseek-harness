# Agent Note: 不可变 workflow Action 与显式 token 权限

Status: implemented

[English](2026-09-05-workflow-security.md) | 中文

## 问题

可变 Action tag 会改变已审查 workflow 实际执行的代码。继承的可写 token 与持久化 checkout 凭证也会把权限暴露给不需要它的操作。发布清单无法在候选变化时机械拒绝这两种情况。

## 决策

每个外部 Action 引用使用在所属仓库查询后记录的完整 commit SHA。YAML 语义验证器检查所有 job/step 引用和必要 workflow 文件。Workflow 默认权限显式只读；可写 job 匹配已审查的权限/environment 例外。Checkout 凭证不持久化。同一验证器在 static 与 hygiene 聚合执行；[参考文档](../../../../docs/development/workflow-security.zh.md) 拥有字段和命令说明。

策略保留独立发布决策，包括 [Python 发布](2026-08-11-python-publication-workflow.zh.md) 和[文档发布](2026-07-13-documentation-site-projection.zh.md)。它限制 `GITHUB_TOKEN` 使用，不取代受保护 environment，也不取代 GitHub App 与外部服务凭证的 scope。

## 考虑过的替代方案

- 版本 tag 更易读，但会移动；不可变引用旁的可读注释保留版本语境。
- 仓库级可写 token 给无关 job 不必要的权限。Job 级例外同时说明权限及需要该权限的操作。
- 文本搜索无法可靠区分可执行 YAML 字段、注释和 shell-script 字符串。解析可以识别所属 job 与 step。
- 每次离线检查都查询上游 revision，会让源码准入依赖可变网络状态。已审查 pin 保留查询结果，更新时再有意重新查询。

## 后果

Action 更新需要审查 registry 与 workflow 的共同变化。移除可写 job 时也要移除其例外，防止过期权限仍可被复用。受保护 environment 的变化在 workflow 和策略中都可见。

聚焦测试与可执行验证器必须拒绝可变/未登记版本、缺失 workflow、畸形输入、隐式或宽泛权限、checkout 持久化，以及写权限例外的变化。固定版本不审计传递 Action 行为、不取代 scanner，也不证明产物 provenance；这些仍属于发布工程检查。
