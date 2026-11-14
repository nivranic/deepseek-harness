# Agent Note: time-context e2e 获得同一激活顺序钉序

Status: implemented

[English](2026-10-08-time-context-e2e.md) | 中文

## Problem

`packages/context/time-context/tests/time-context.e2e.ts` 在 win32+tsx 下以 `ENOENT ... .sessions` 失败——与 loader-composition e2e 在 gen-45 之前的形态同型：fixture overlay 禁用 headless runner、在 `agent-loop` 行内联声明 agent、并把 `session-persistence-jsonl` 指向 `root: './.sessions'`。Loader 同组并发激活下 config agent 可能先于 jsonl 后端创建，会话持有 undefined 持久化句柄，所有写入静默 no-op。

## Decision

fixture 的 `agent-loop` 行声明 `inject: [sessionPersistence]`——与 loader-composition fixture 及 shipped headless bundle（对 `headlessStartup`）相同的行级钉序。config agent 的 fiber 保持 PENDING 直至持久化后端激活，会话获得可持久化句柄，`.sessions` overlay 物化。恰一个 fixture 文件、零生产代码。

## Alternatives considered

- **在 e2e driver 里等待或重试**：与 gen-45 同理拒绝——墙钟希望而非陈述依赖。
- **软化 `createStoredSession` 稍后重解持久化**：拒绝——生产 agent 由 registry 在 boot 后创建，从不与后端竞速。

## Consequences

e2e 在 `vitest.e2e.config.ts` 下 1/1 通过、包套件保持 53/53 全绿。§44 台账原以「另道开放」记录该同族竞态的句子改为记录闭项并内联 fixture 路径。激活顺序竞态族现有两个 fixture 实例以同一行钉序闭项；今后任何禁用 headless runner 并在 jsonl 持久化 overlay 上内联声明 agent 的 fixture 应一开始就带钉序。

## Open follow-ups

- Linux 与构建 lib 启动形态未在本机复验（win32+src 是红宿主）；CI 覆盖 Linux 腿。
