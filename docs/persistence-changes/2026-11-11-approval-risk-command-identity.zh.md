---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-11-approval-risk-command-identity

[English](2026-11-11-approval-risk-command-identity.md) | 中文

## 概述

为持久的 approval 与 command 审计事件新增可选的询问风险档位、结构化提权事实和命令重试身份字段。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-11-approval-risk-command-identity
baseline: false
changes:
  - root: "event:approval/asked"
    previous: "2026-09-11-initial"
    after: "7d4b2813a6fc075ed8cbe9a03c0fbe67eaf081a30d3adee73f0f5a47dd8d3a16"
    decision: same-version
  - root: "event:command/done"
    previous: "2026-09-11-initial"
    after: "628f22307154a28661a0e4b2390b8a07709c56d1da1d8f2b09fd62719678e116"
    decision: same-version
  - root: "event:command/run"
    previous: "2026-09-11-initial"
    after: "5fa0af5a3f663880a31ade24fa0bcf9d6b18a416ac4d934487661ed207dec538"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

两处变更都只是为既有事件添加可选属性。早于这些字段的读取方会忽略它们，缺失保持变更前语义：不展示风险档位、不渲染提权事实、命令执行没有进程内重试收据。写入方仅在调用方提供对应字段时才写入，因此任一代产生的会话都保持有效。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/interaction/user-approval/tests/approval.spec.ts：33 个测试通过（覆盖 risk/escalation 审计字段与可缺字段省略）。pnpm exec vitest run packages/interaction/commands：55 个测试通过（覆盖 clientMutationId 重试身份的写入）。pnpm exec vitest run packages/session/session-format-v0-to-v1/tests/validation.spec.ts：20 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
