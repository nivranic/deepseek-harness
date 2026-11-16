# Agent Note: loader-composition e2e 转绿——同意点与激活顺序确定性

Status: implemented

[English](2026-10-08-loader-composition-e2e.md) | 中文

## Problem

loader-composition e2e（`packages/session/session-telemetry-otel/tests/loader-composition.e2e.ts`，宿主配置 `vitest.e2e.config.ts`）自引入起 3/4 红，被逐代报告当作开放通道携带。两个成因，一个已知一个直到本代才定位：(a) fixture driver 从不设置 `DSH_TELEMETRY_CONSENT`，而 shipped headless profile 把每个遥测类门在 `process.env.DSH_TELEMETRY_CONSENT === '1'` 之后（`packages/bundle/base/cordis.patch.yml`），采集器零记录；(b) 在 win32 的 tsx 源码启动形态下，fixture 的 `.sessions` 目录从不物化——会话静默地从未到达 jsonl 后端。

## Decision

1. driver fixture 设置 `DSH_TELEMETRY_CONSENT = '1'`——e2e 由此行使 §44 运行时接缝实际出货的同意门。
2. 持久化缺失的根因是 loader 激活顺序竞态，以子进程内时间线定位：同组条目并发启动（`vendor/loader/src/config/group.ts` 的 `Promise.allSettled`），win32+tsx 下 agent-loop 的 config agent 比 session-persistence-jsonl 后端早约 840ms 创建。`createStoredSession` 当时的 `ctx.get('sessionPersistence') === undefined`，会话留在内存、后端事件监听静默 no-op——干净退出、零写入。fixture 用仓库既有行级 `inject` 机制钉序（`agent-loop` 声明 `inject: [sessionPersistence]`，与 shipped headless bundle 的 `headlessStartup` 同型）：fiber 保持 PENDING 直至后端激活。生产 profile 不受影响——其 agent 在 boot 后经 registry 工厂创建，从不与后端竞速。

## Alternatives considered

- **driver 里显式等待后端就绪（延时/重试）**：拒绝——用墙钟希望糊住顺序；inject 依赖把需求说成状态。
- **改 `createStoredSession` 等待或稍后重解持久化**：拒绝——生产从不观察该竞态（registry 建 agent），为 fixture 的平台时序软化接缝会放宽产品行为。
- **fixture 指向绝对 session root**：无关——什么 root 都没写；句柄从未存在。

## Consequences

e2e 4/4 通过、包套件保持全绿（72/72）。`.sessions` overlay 在 win32+tsx 下物化，遥测捕获按同意开启断言，§44 台账的 loader-composition 尾句以交付叙述闭项、两个 fixture 文件入证据。诊断同时浮出一个同型通道保持开放：`packages/context/time-context/tests/time-context.e2e.ts` 用同样的 `.sessions` overlay 模式并呈同型平台时序红——同类、别包，本代不触碰。

## Open follow-ups

- time-context e2e 的同型竞态（其 fixture 需要同样的 inject 钉序或等效确定性顺序）。
- loader 组合的 Linux 与构建 lib 启动形态未在本机复验（win32+src 是红宿主）；CI 覆盖 Linux 腿。
