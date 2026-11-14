# Agent Note：各写通道的重试结算被逐道钉死

Status: implemented

[English](2026-10-06-mutation-idempotency-lanes.md) | 中文

## Problem

第 17 节要求状态变更请求携带 `clientMutationId`，使 Host 能识别断网重试后的重复请求。对全部变更面的逐文件测绘发现：库中不存在通用 `clientMutationId` 字段；识别由各机制分治实现——requestId/rpcId 收据（session prompt 的三重检查、跨重启的子代理 prompt 收据）、revision 比较交换（renameAt、goal、交互答复）、turn 定向取消（cancelTurn、interruptTurnByParent）、一次性配对码与 nonce 重放地板（device-trust）、首答定局（interaction）。测绘的 27 条通道中 20 条已有直接的重试结算断言；7 条没有：其中 2 条完全没有幂等锚点（session fork 每次铸新 child id；commands execute 每次铸新 command id，重试会二次执行 handler），另 5 条结算合理（接受型 no-op、末次胜出、稳定 not-found）但没有车道测试钉住该行为。

## Decision

用直接测试钉死每条通道现状的重试结算，而非发明协议字段。fork 与 command-execute 的测试显式断言重试副作用——第二个独立子会话、第二对命令事件——并在用例注释里点名开放设计裁定：为这两条通道采纳客户端变更身份（返回既有 child、只执行一次）是会改变 wire 表面的产品决策，不是测试能补的缺口。其余五例钉住既有语义：重复 cancel 被接受且不产生第二次 turn 结算、重复无条件 rename 追加两条 title 事件且后 seq 胜出、重复模型选择对下次装配只结算一次、重复设备改名落到末次值且不动授权、重复 workspace 删除/归档映射到与 unknown-id 路径相同的稳定失败。

## Alternatives considered

现在就给 fork 与 command execute 加可选 requestId（镜像 prompt 通道的收据模式）能满足 §17 字面，但它把 wire 表面与持久化决策（fork 收据存哪、重试返回什么）提前定死，而规格并未钉住这些；记录开放裁定并钉住今日行为让 seam 保持诚实。跳过弱通道测试（「代码里显而易见」）被否——测绘本身就发现结算逻辑散布在五种机制里，未被钉住的行为会漂移。

## Consequences

每条 §17 写通道现在都有直接结算断言；traceability remaining 把 fork 与 command-execute 的变更身份记为开放设计裁定。未来若为这两条通道采纳 client-mutation 身份，必须在同一变更里更新这些钉子——那正是评审对话该发生的时候。生产代码零改动。

## Open follow-ups

fork/execute 的 clientMutationId 采纳裁定（wire 表面、收据持久化、重试返回形态）仍开放；多版本互通类照旧开放。
