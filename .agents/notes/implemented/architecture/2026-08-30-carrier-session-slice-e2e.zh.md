# Agent Note: 载体级会话切片 e2e

Status: implemented

[English](2026-08-30-carrier-session-slice-e2e.md) | 中文

## Problem

Phase 1 的两份笔记延后了一个验收项：证明真实会话栈——随产品发布的 SessionController 与 Remote 流面——可以经真实 TLS 载体触达，而不是经由绑定在载体测试工装上的探针服务。在它跑通之前，"Native Access + Existing Gateway" 只在载体套件内对测试自有 Remote、在组合 e2e 内对不带载体的桌面网关分别证明过。

## Decision

`apps/cli/tests/link-session-slice.e2e.ts` 以 link 各行的持久状态钉入测试 home 的方式启动随产品发布的 base + desktop 组合，然后在真实线缆上走完 LLM 无关的验收核心：`remote` 设置开关经实时桥接绑定真实载体；一台真实 Ed25519 设备经配对接入完成配对；已配对设备经载体共享 `/api` 链调用 `session/list` 并拿到组合的真实会话行；`$events` Remote 流以 NDJSON 打开（在响应头处断言后拆除——Remote 流不会自行结束）；由刚配对的控制者签名的交互应答在分发之前被以 `forbidden`/`approval-disabled` 拒绝，因为独立的审批开关是关的——方案"能看到提示绝不等于能审批"的规则在 Allowlist 层执行，而非业务层。把开关拨回即解除载体绑定。

## Consequences

远程切片的会话、跟随与审批授权验收现在跑在用户实际发布的组合上，且该测试就是 Apple 与 Kotlin 伴侣端状态机要对齐的一致性目标——它在真实线缆上断言的一切，正是 `dsh-link-client` 与 `SharedAppleRemoteCore` 所实现的。prompt 与 cancel 刻意不在其中：它们需要模型轮次，属于快照工装的回放机制而非组合启动；是否引入回放 profile 组合是另一个独立决策。

## Alternatives considered

在本增量中改由 Swift 核心的测试驱动同一序列被否——本机与 CI 都还没有编译车道。扩展 `desktop-composition.e2e.ts` 而非新建文件也在考虑之列：组合 e2e 断言的是冷启花名册，在其中绑定真实 TLS 监听并配对会把它的启动期断言与载体生命周期噪声耦合；切片测试以两个额外的配置钉子拥有自己的启动。
