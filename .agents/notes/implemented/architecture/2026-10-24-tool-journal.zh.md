# Agent Note: 回合的工具行进入 journal——chapter 64 在写面上的重裁

Status: implemented

[English](2026-10-24-tool-journal.md) | 中文

- Date: 2026-10-24
- Class: architecture
- Scope: `apps/android/core`（`LiteChat.kt`）、`apps/android/core` 测试（`LiteChatViewModelTest.kt`）

## Problem

chapter 64 的回合结局忠实规则把工具行完全挡在 journal 外：`send()` 持久化 prompt 与回合结局事件，而调用与结果行只活在进程内存的 fold 里。重启重放会话却丢失每一条工具行——gen-63 把它记为当时既定 Behavior-Spec 决策的诚实代价，§31 把工具行 journal 持久化留作该决策背后的开放项。

## Decision

在写面上重裁 chapter 64（已记录拆二的 A 半）：journal 现在保存回合完整的折叠面。回合终结事件落定后，`send()` 从 fold 把本回合工具行重建为规范事件、record 在 prompt 与结局事件之间——每个 completed 或 failed 行落它的 `tool/call`+`tool/result` 对（结果的 `ok` 从折叠 phase 读出），每个新 artifact 落 `artifact/created`+`artifact/status` 对，而仍处 `running` 的行（回合死在执行中途——handoff 标记或被取消的回合）只落 `tool/call`，让重启重放出诚实的中断态。重建序（先工具行、后 artifact 对）重放出同一折叠态——fold 对两族独立聚合。词汇保持闭集——`tool/call`、`tool/result`、`artifact/created`、`artifact/status` 本就是 fold 事件；journal 只是开始记录它们，零新 tag、三方 fixture 互验不动。原始 delta 照旧不入。B 半——把重放 journal 的工具行跨重启喂进请求历史——保持开放：`seedJournal` 仍只播种渲染面、导出仍读活 fold，与从前完全一致。

## 备选方案（已否决）

- 经驱动器新事件回调实时记录：事件缝能携带 artifact 对与其结果行的原始交错序，但 fold 对两族独立聚合，重建序重放全同——新缝只会给写路径加一个它不需要的面。
- 把折叠聚合持久化为新 journal 行形态：journal 是 fold 重放的事件流；序列化聚合需要自己的重放路径和新词汇，违背闭集规则。
- 整项推迟到 B 半一起：写面才是决策的实质——行一旦持久化，B 是有自身风险（历史导出正确性）的读侧变更，拆二正是为了让决策落在自己的证据上。

## Consequences

- `LiteChatViewModelTest` 七处 journal 序列断言翻转（执行、拒绝、handoff、handoff 后正常回合、双回合历史、重放态 emission）：每个到达过工具调用的回合现在携带其行，重启后重放态携带 completed 调用行——重裁的可见效果被钉住。`:core:test` 保持 85 套件 / 612 测试（零新测试方法；翻转的断言即契约）。
- 重启渲染面免费获得工具行：`seedJournal` 把 journal 经 fold 重放，fold 本就消费这些事件——本半零 `seedJournal` 改动。
- 请求历史仍只骑活 fold：重启的会话显示其工具行但尚未把它们喂给下一请求——B 半的范围，本 note 不变。
- debug APK 漂移（`5b996719 → 69e9f027`，core 主源集变更）；androidTest APK 逐字节复现 `e0d3214b`（零 androidTest 输入变更）。
