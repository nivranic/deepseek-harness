# Agent Note: Lite 循环驱动器骨架

Status: implemented

[English](2026-08-30-lite-loop-driver.md) | 中文

## 问题

Lite 运行时已有行为规范折叠与静态工具注册表，但没有驱动器：没有东西向模型缝提交 prompt、流式消费响应、派发内置工具、发出终局事件——把词汇变成运行时的那个循环。

## 决策

`LiteLoopDriver`（MainActor）经三个缝驱动一个 prompt：`LiteProviding` actor（`stream(prompt:)` 产出 `LiteStreamChunk`——思考、文本、工具调用）、注册表门控的 `LiteToolExecuting` 闭包、以及既有的 `LiteFold`。思考与文本分块按流事件折叠；工具调用先查 `LiteToolRegistry`：有 `fallbackCapability` 则发 `handoff/requested` 并在不执行的情况下停止循环，未知名字只折叠调用但绝不派发，内置名字执行并折叠结果。终局事件严格按规范——累积文本的 `message/completed` 加 `turn/completed`；取消折叠 `turn/cancelled`（折叠层定稿已送达前缀）；流抛错折叠 `provider/error`。`ScriptedLiteProvider` 是无钥 mock：按 prompt 匹配的分块脚本加已提交 prompt 记录器。

## 后果

第 63 章的完整链——prompt、流式、工具调用、工具结果、完成——现在作为代码在端上执行，驱动器的测试用与一致性回放相同的模型断言所得 `LiteDomainState`，驱动行为由此钉在规范语义上而非临时期望。交接是诚实的：完整运行时工具绝不在本地执行，动态工具名绝不派发。Swift 在本机仍是已编写未编译（既有的 macOS 车道告解）。骨架刻意不含持久化、附件或真实提供方适配器——那些随需要它们的产品增量落地。

## 考虑过的替代方案

在注册表之外派发工具被否决——第 36 章的规则是只有应用内置静态工具可执行，驱动器正是规则咬合的地方。交接后继续运行被否决——标记意味着完整 harness 接管工作；越过去折叠会谎报状态。现在就写真实 HTTP 提供方被否决——脚本化缝保持循环无钥可测；适配器随真实模型路由到来。
