---
kind: upgrade-guide
description: "已发布包 @deepseek-ai/dsh-workflow-worker-thread 退役；沙箱化的官方引擎 @deepseek-ai/dsh-workflow-ptc 服务全部 workflow engine 消费者。"
---

# `dsh-workflow-worker-thread` 退役；`dsh-workflow-ptc` 承接引擎

[English](guide.md) | 中文

## 变更

worker-thread 工作流引擎包 `@deepseek-ai/dsh-workflow-worker-thread` 从仓库移除，desktop bundle patch 也不再携带其（本就禁用的）`workflow-worker-thread` 行。该包是官方引擎 `@deepseek-ai/dsh-workflow-ptc` 的 fork，仓内没有任何启用挂载：base bundle 挂载 `workflow-ptc`，desktop 组合禁用整个 workflow 家族，`dsh` CLI 声明过该依赖但从未使用。

若你在自己的 profile 或安装中声明过 `@deepseek-ai/dsh-workflow-worker-thread`，或 overlay patch 了 `workflow-worker-thread` 条目 id，则受影响。

## 迁移

1. 在你的 `package.json` 中，把依赖 `@deepseek-ai/dsh-workflow-worker-thread` 替换为 `@deepseek-ai/dsh-workflow-ptc`。
2. 在 overlay 或 `cordis.patch.yml` 层中，把条目 id `workflow-worker-thread` 替换为 `workflow-ptc`。引擎注册同一个 `ctx.workflowEngine` 服务，该服务的消费者无需改动。
3. 若你依赖 worker-thread 隔离的具体参数（`disposeGraceMs`、线程内 vm 执行），注意 `workflow-ptc` 在带文件策略的沙箱进程中运行工作流代码；没有引擎选项会迁移携带。
4. 确认迁移生效：`pnpm install` 不再解析出退役名称，`pnpm run typecheck` 通过，挂载 `workflow-ptc` 的 profile 能启动且 workflow 工具应答。
