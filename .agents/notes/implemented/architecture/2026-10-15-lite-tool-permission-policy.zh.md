# Agent Note: Lite 工具调用在派发前过一道声明事实权限门

Status: implemented

[English](2026-10-15-lite-tool-permission-policy.md) | 中文

## Problem

§31 要求 Lite 运行时拥有自己的权限策略，但 Lite 循环的 ToolCall 分支只按目录在不在就派发：bundled-fallback 名直通执行器零门禁，未知的 fallback 名 fold 了 `tool/call` 后永挂 `phase="running"`——无结果、无错误，turn 完成了却对丢弃的调用只字不提。策略该读的声明事实——`ToolDescriptor.risk` 与 `permissions`——contract 层已解析、`LiteToolCatalog` 已持有，但无人消费。

## Decision

策略是每调用恰咨询一次的单一决策点。`LiteToolPermissionPolicy.decide(name)` 回答 `AllowLocal`、`Handoff(reason)`、`Unknown` 三者之一；`LiteLoopDriver` 以构造参数接入、默认 `LiteToolPermissionPolicies.defaultPolicy(toolCatalog)`，置于尾随 lambda 执行器参数之前——既有调用面零变化。默认门梯只读存在处的宿主声明事实：HOST_DECLARED 名在声明非 lite、本机无 bundled 执行面、声明风险为 high/critical、或声明 permissions 非空（Lite 无设备准入满足它们）时交接；否则放行本地执行。BUNDLED_FALLBACK 名保持 bundled capability 判定、不设风险门——该名域无宿主风险事实，编造档位正是 §37 禁止的猜。词汇复用 `ToolRisk` 档与 `ToolDescriptor.permissions`，零平行权限模型（§72）。`Unknown` 名现在 fold 一条显式失败的 `tool/result`（既有事件形态、`ok=false`、点名未知工具）且 turn 照常完成；fold 与 journal 词汇零改动，handoff 事件保持固定 `requiresFullRuntime` capability 字段，下游词汇零漂移。

## Alternatives considered

在 `LiteChat.send` 于 turn 之后门控被否决：执行已经发生，权限门只在派发点有意义。对 bundled-fallback 名设风险门被否决：这些工具无宿主声明风险事实，机上自定档位就是 §32/37 禁止的移动端猜测。把风险档自动映射成交互审批档在本增量被否决：循环尚无审批面、规格优先级附录明言内置工具执行延后 P2，且交接完整运行时已把高风险调用路由到持有升级面的地方。

## Consequences

Lite 运行时现在拥有权限策略（§31 四件套完成其三：目录、persona、策略；`runtimeMode = lite` 公开仍开放），且策略与目录的执行面语义一致——声明名无 bundled 执行器在两种读法下都交接，第一轮实现的分叉由该门收口。未知工具调用以 fold 可展示的显式失败收尾而非静默悬挂。单往返零变化：执行器结果仍不回喂模型，与规格 P2 延后一致。

## Open follow-ups

`runtimeMode = lite` 公开、交互审批档（`ask` 决策与 §38 审批面）、工具结果回喂模型（规格 P2 延后）、app 层运行时接线、本地/宿主工具名对齐保持开放。
