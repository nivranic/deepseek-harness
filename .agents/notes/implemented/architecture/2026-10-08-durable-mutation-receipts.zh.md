# Agent Note: fork 与 command execute 收据成为耐久会话事实

Status: implemented

[English](2026-10-08-durable-mutation-receipts.md) | 中文

## 问题

clientMutationId 结算（前两个增量）把收据保存在 Host 进程内 Map，到达已重启 Host 的重发会铸出第二个子会话或重跑 handler。prompt 车道的收据能跨重启存活，正因为它们是会话事件；开放设计裁定点名的正是 fork 与 execute 的这个耐久归属。

## 决策

收据现在是会话事实，进程内 Map 已移除。execute：`command/run` 携带 id 作审计线索，`command/done` 恰在结算走 settle 路径时携带它——带 id 的 done 就是收据；抛错与中止的结算不写 id，其重发重跑，崩溃残留的悬空 run 永不是收据。重发检查经 session-projection 投影单元查询（状态按会话键控、有界 1024 逐最旧、冷会话从日志 hydrate 重建），重放记录的 commandId 与 result——不重入 handler、不追加事件。fork：source 会话新增 log-only 事件 `session/forked` 携带 `{ clientMutationId, childSessionId }`——child id 正是重发要重放的——在子会话发布后追加；fork 现在先经 resolveAgent 激活（rename 同款先例），因为向冷 source 追加需要活会话。收据键域 per-session：扫描只读会话自有事件，fork 子会话继承的祖先收据永不命中。

## 备选方案

保留进程 Map 作耐久事实前的快路径被拒绝——一事实一家；两个存储恰在耐久收据所针对的重启边界上可能分歧。为旧构建兼容给新事件标 `ignorable` 被拒绝：`Session.append` 没有该参数，且 pre-release 立场认可 fail-closed 日志。子会话侧收据归属在查找上落败（重发知道 source 与 id，不知道 child）。

## 后果

persistence catalog、冻结 v0 清单、载荷校验器及其 fixture 随类型同步（gen-30 惯例面）；session-format 家族套件保持全绿（801 测试）。SDK 快照无需刷新：没有任何录制场景提交 id，任何期望输出里的事件都不携带新成员——可选成员按构造缺席，该声称是零漂移、由 CI 中不变的期望输出验证。Android 与 Apple link 契约只枚举 remote 投影子集（command 事件不在其中投影），无原生镜像变更。

## 开放事项

多版本互通矩阵照旧开放；未来发布可把收据保留窗口钉到 1024 条回放窗之外作为产品决定。
