# Agent Note: 工具前询问决策可携带 §37 风险档位

Status: implemented

[English](2026-10-04-approval-ask-risk.md) | 中文

## 问题

第 37 节剩余开放子句点名了最后一类未分级的询问者：hook 来源的审批询问。`tools/pre-execute` 监听器返回 `{ kind: 'ask' }`（Claude Code 桥正是这样翻译 hook 的 `permissionDecision: 'ask'`）时，产生的审批请求只有 `toolName`/`callId`/`reason` 而无风险档位，因此 §38 面板对每一条 hook 来源询问都隐藏 Risk 行。审批 seam 本身已能接受、持久化并渲染档位——gen-30 交付了 `approval/asked` 的持久 `risk` 成员、冻结 v0 清单表条目、从严载荷校验与面板行——但没有任何工具层询问者能提供它。

## 决策

分级通道严格沿本节的所有权规则：Host 层分级，Client 只展示。`PreToolDecision` 的 `ask` 成员新增可选 `risk` 字段，类型为本地封闭字面量联合（`ToolAskRisk = 'low' | 'moderate' | 'high' | 'critical'`），`serviceAsk` 条件展开转发进 `approval.request`——持久事件与面板经 gen-30 已交付的机制直接渲染。与 `ApprovalRisk` 的结构同一性让该值原样透传，与 gen-30 的 `ApprovalSandboxMode` 镜像同构。

验证：`packages/core/tools/tests/tools.spec.ts` ask-routing 块——转发用例附加 `risk: 'high'` 并断言它落在 `approval/request` 载荷上；新增伴随用例断言询问者未分级时请求完全省略 `risk` 键（条件展开而非 `undefined` 成员）。core/tools 车道 12 文件/391 测试绿；`gen-cordis-catalog` 再生成内嵌 `PreToolDecision` 声明（`risk?: ToolAskRisk`）后 tool-cordis 11 绿；`docs/subsystems/tools{.md,.zh.md}` type-equiv 块手工镜像；persistence-catalog 与 doc-graphs 核验未过期；仓库 typecheck 与 lint 0/0；traceability §37 尾句改写、candidateEvidence 6→8。

## 备选方案

首版尝试从 `dsh-user-approval` 具名 type-only 导入 `ApprovalRisk`，被 typert host 面分析器拒绝（`type symbol unknown has no declaration`）——本文件长期的 `import type {}` 正是为了激活服务声明合并而不把该包声明拖进面，镜像联合由此成为既定形状。向 Claude Code hook 方言编造 `permissionRisk` 字段被否决：两个参考 schema 都没有该字段，codec 将解析一个无人能发送的字段——死的 wire 表面。在工具注册表上加档位字段同样被否决：规格把 §37 阶梯锚定在 Commands，工具不是命令。

## 后果

hook 来源询问自此可端到端分级：Host 侧 pre-execute 询问者返回 `{ kind: 'ask', risk: 'high' }` 即可让档位进入 wire 请求、持久 `approval/asked` 事件与 §38 面板 Risk 行，无需任何进一步改动。Claude Code 桥不转发（其方言无档位字段），CC 桥转发的询问保持如实未分级 Risk 行——面板按设计隐藏缺失行，沿 gen-28 裁定。内嵌 api-catalog 声明与两处 type-equivalence 文档块现已承载加宽后的联合。

## 开放跟进

当前没有已出货的 pre-execute 询问者分级档位；采纳属于 guard 类插件或讲更丰富方言的未来桥。审批表面的真实多设备验收仍开放。
