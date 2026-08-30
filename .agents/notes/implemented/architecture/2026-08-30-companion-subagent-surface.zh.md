# Agent Note: CompanionUI 子代理面

Status: implemented

[English](2026-08-30-companion-subagent-surface.md) | 中文

## 问题

Phase 2 的模块清单包含 Subagent，宿主也已拥有所需部件：带 `@Remote('list')`（直读持久子目录）的 `subagents` Remote 命名空间，以及 `session/follow` 的子代理地址（`{kind:'subagent', parentSessionId, childSessionId, mode}`）。但远程允许清单没有子代理端点，契约表没有目录词汇，伴侣端也没有界面。接线这个面还逼出一处线缆形状修正：会话 view model 此前以扁平参数字段发送 `session/prompt`、`session/cancel`、`session/follow`，而宿主的会话动词都收单一 `request` 对象参数——一个被 FakeWire 不校验放过潜在错配。

## 决策

`subagents/list` 进入 observer 允许清单；`dsh-link-contracts` 以扁平 `LinkSubagentEntry`（child 与 diagnostic 行共用一个结构：kind 常量、id、activity、hasChildren、mode、可选 label 与 reason）加 `LinkSubagentCatalog` 建模目录，fixture 钉住真实 `SubagentListEntry`/`SubagentCatalog` 类型。伴侣端 `SubagentsViewModel` 载入打开会话的子代理，`SubagentsView` 是第六个标签页（标签、模式、运行状态、诊断）；点击子代理经 `RemoteSessionViewModel.openSubagent` 在同一 follow 流上打开其只读时间线——发送持久父子地址并记住它，断流重连按地址重订。会话 view model 的线缆形状修正为宿主描述符：`session/prompt` 与 `session/cancel` 携带 `{request: {…}}`，`session/follow` 携带 `{request: {address: {…}}}` 且无 cursor（协议在每次订阅重放完整快照，而领域状态折叠本就从快照整体重建状态）；FakeWire 现在记录流 payload，地址形状由断言钉住。

## 后果

Phase 2 模块清单在伴侣端齐了（会话、审批/提问、plan/todo/goal、工具、文件、子代理），会话动词的真实线缆形状由测试而非假设钉住。desktop-composition e2e 证明 `subagents/list` 经已发布桥应答（未知父级给出空目录——合法应答而非错误）。Swift 在本机仍是已编写未编译；解码正确性由契约 fixture 承载。子代理后续动词（`subagents/prompt`、interrupt）暂不入允许清单——它们是 controller 级变更，留给后续增量连同策略评审一起落地。

## 考虑过的替代方案

把目录展平成两个数组（子代理与诊断）被否决——线缆携带的是一个有序 entries 数组，扁平 entry 结构保住了它。独立的子代理时间线 view model 被否决：follow 折叠与会话无关，复用 `RemoteSessionViewModel` 加地址参数零成本且只保一份折叠。现在就把 `subagents/prompt` 加进允许清单被否决——Phase 2 的面是观察性的；变更动词应随其自身的策略评审落地。
