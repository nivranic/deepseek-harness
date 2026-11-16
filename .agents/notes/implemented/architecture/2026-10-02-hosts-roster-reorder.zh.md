# Agent Note：§28 名册的已保存 Host 手动重排

Status: implemented

[English](2026-10-02-hosts-roster-reorder.md) | 中文

## 问题

§28 已保存 Host 名册严格按最近连接优先排序，客户端无法自行编排。名册是置顶板而非日志：用户最常使用的主机未必是最近连接的那台。重命名 note 曾把手动重排留作待办（"与最近优先不变量冲突"）。

## 决策

- `SavedHost` 增加可选 `order`：客户端选择的位置，在被移走前覆盖新近度排序，与 `customName` 一样跨重连存活。`sortRows` 先按 `order`（`order ?? +Infinity`），有序块内及其后按最近连接降序。
- `SavedHostsStore.moveHost(hostId, direction)` 将该行与相邻行交换，随后给呈现列表的每一行打上显式 `order` —— 一次移动即整册进入手动模式，编排因此是全量且稳定的，而非部分有序。边界与未知目标不改动、不通知、返回 `false`。
- `record()` 保存 `order` 的方式与 `customName` 完全一致：描述事实随新生成刷新，行保持手动位置；从未移动过的新行按新近度落在有序块之后。`rename()` 在原地重写时携带 `order`。
- `parseRow` 在 `order` 存在时校验其为有限数，重排前的持久化行原样解析，损坏值随其所在行丢弃。
- `ConnectionHandle.moveSavedHost(hostId, direction)` 与 `renameSavedHost` 同构：名册缝，无连接效应。每行新增 上移 / 下移 动作（`data-host-move-up` / `data-host-move-down`），首/末位置禁用；section 由 map 下标传入 `first`/`last`。
- 证明：单元套件覆盖存储语义（相邻交换+全行打戳、跨存储生命周期持久化、边界/未知静默、编排经受刷新/重命名/无序到达仍存活、解析准入）、区块呈现（边界按钮禁用、点击经注入动作换序、据发布名册重渲）、插件接线进入持久化名册。`hosts-settings.e2e.ts` 扩展真实浏览器车道：上移使外部 Host 居前、边界按钮禁用且 `dsh-saved-hosts.v1` 出现 `"order"` 戳；下移恢复新近度序；golden 增 Reorder 行。

## 备选方案

- **拖拽：** 仅指针可用，键盘与开关辅助成本更高，超出本区块所需；相邻移动可组合出任意编排。
- **只给交换对打戳：** 名册仍部分有序，后续与新近度行的交错存在歧义；一次移动显式化整个列表，与全行可观察的 store 一致。
- **重连时把行移到最前（record）：** 会静默摧毁编排；`record` 保存 `order` 的理由与保存 `customName` 相同。

## 后果

- 首次手动移动固定所有行的位置；之后新增的行在下次移动重新打戳前按新近度排在有序块之后。
- cordis inspect 目录（`dsh-cordis-client-runner`）已再生成，携带 `moveSavedHost`、`moveHost` 与 `SavedHost.order`；ui-settings-hosts README 的限制条目已改写。

## 开放工作

- 编排按 profile 存于浏览器 localStorage；无跨设备、跨载体同步。
- 名册上限保持 8，戳保持稠密；无需稀疏 order 压缩。
