---
kind: upgrade-guide
description: "已发布的 code-runtime 家族包退役；官方 ptc-runtime 家族经 PTC mode 服务代码执行。"
---

# `dsh-code-runtime*` 家族退役；`dsh-ptc-runtime*` 承接代码执行

[English](guide.md) | 中文

## 变更

三个包 `@deepseek-ai/dsh-code-runtime`、`@deepseek-ai/dsh-code-runtime-worker-thread`、`@deepseek-ai/dsh-code-runtime-python` 从仓库移除，desktop bundle patch 不再挂载 `code-runtime` 行。该 seam 及其 worker 后端是官方 `ptc-runtime` 家族的源码重复（`dsh-code-runtime` 只是把 ptc-runtime 的 Service Definition 以 `ctx.codeRuntime` 名义再声明一遍，全仓无消费者），Python 包是无接线的协议库；官方 `@deepseek-ai/dsh-ptc-runtime` 家族经 `dsh-tools` 的 PTC mode 提供受支持的执行路径——沙箱 Node 提供方与实验性 CPython 提供方。

若你声明过任何 `dsh-code-runtime*` 包、注入或实现过 `ctx.codeRuntime` 服务、或 patch 过 `code-runtime` 条目 id，则受影响。

## 迁移

1. 在 `package.json` 中，把 `@deepseek-ai/dsh-code-runtime*` 依赖替换为 `@deepseek-ai/dsh-ptc-runtime`（进程提供方再加 `@deepseek-ai/dsh-ptc-runtime-node`）。
2. 在 overlay 或 `cordis.patch.yml` 层中，把条目 id `code-runtime` 替换为 `ptc-runtime`；base bundle 已挂载 `ptc-runtime` 与 `ptc-runtime-node`。
3. 把 `ctx.codeRuntime` 注入替换为 `dsh-tools` 的 PTC mode 面；不存在 `ctx.ptcRuntime.run` 的等价直调——模型署名的代码执行经 PTC 工具模式走。
4. 确认迁移生效：`pnpm install` 不再解析出退役名称，`pnpm run typecheck` 通过，挂载 `ptc-runtime-node` 的 profile 能启动且 PTC mode 应答代码执行轮次。
