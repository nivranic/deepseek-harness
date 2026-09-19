# Agent Note: 将下游平台能力收敛到官方 upstream

Status: proposed

[English](2026-09-14-upstream-first-convergence.md) | 中文

## Problem

下游实现与当前 upstream 都包含 Desktop 生命周期、API、Client 和持久化工作。整体导入下游代码会恢复平行 owner，并可能错误解释已发布的 Session 数据。历史平台回执指向较旧的源码提交，不能验证新组合。

## Proposal

以已固定的官方提交作为隔离候选基线，在迁入前审查每项下游能力。[任务能力清单](../../../../CUSTOM_CAPABILITY_INVENTORY.json)维护来源提交、处置分类和待审内容；[执行计划](../../../../docs/plans/2026-09-14-upstream-first.zh.md)维护顺序。

官方 [Desktop 决定](../../implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)继续约束 Electron、内置 runtime、profile 归属、framing 和更新。Windows/macOS 使用同一个应用。Native Companion 贡献平台集成和展示，不拥有 Agent 或 Session 真源。

现有 Typert Gateway、ConnectionController 和 Session Controller Client 分别拥有 RPC、连接 generation 和 Client 状态。Remote 传输必须保留本地浏览器信任策略。Host service 拥有交互决议、mutation 去重、设备授权和能力声明。

## Persistence and compatibility

[已发布格式迁移决定](../../implemented/architecture/2026-08-31-released-session-format-migrations.zh.md)继续作为依据。旧 SQLite Session generation 与下游版本化设置必须先具备显式转换设计和隔离 fixture，才能操作用户数据。保留旧 generation，其存在不表示支持 fallback 或降级。

产品版本、API 协议版本与 Session writer 版本保持独立。Native Client 消费生成的 Remote 数据，不解析 Session 磁盘格式。历史兼容回执不能满足候选矩阵。

## Alternatives considered

**将全部下游代码合并到 upstream。** 分支在数百个变更路径上重叠，包含独立 Desktop 和持久化实现。仅解决文本冲突不能证明归属或数据兼容正确。

**继续在旧 Goal 工作树开发。** 这会保留旧 API 和存储假设，并增加以后必须迁移的代码。旧分支应作为能力审查来源保留。

**丢弃所有下游能力。** Device Trust、Native secure storage、诊断和 support 工具可能仍有价值。能力清单显式保留这些决定，不自动导入旧架构。

## Acceptance criteria

Gate 0 要求固定 upstream SHA、完整工作树快照、已审查的补丁处置和可执行迁移计划。后续验收要求单一 Desktop、共享 Host/API 归属、显式数据转换、跨语言兼容，以及绑定来源的平台证据。现有源码测试不能替代应用、设备、签名或发布验证。

## Risks

重新接入可能遗漏有价值的下游行为；每项清单在采用、适配、迁移、明确排除或隔离实验前保持未完成。转换行为验证前，禁止候选启动器打开历史产品数据。来源分支或 dirty 文件变化时需要刷新快照。

引用的两项官方决定继续有效，未被取代：本提案约束下游选择和迁入，不改写其 runtime 或已发布数据规则。本提案不归档任何历史 Agent Note。
